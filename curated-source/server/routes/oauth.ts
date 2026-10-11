/**
 * "Continue with Google / Facebook" using the OAuth 2.0 authorization-code flow.
 *
 *   GET /api/auth/oauth/:provider/start?next=/path   → redirect to the provider's sign-in page
 *   GET /api/auth/oauth/:provider/callback           → provider redirects back here with ?code&state
 *
 * On success the browser lands on /auth/complete#token=…, where the web app stores the session.
 * The token travels in the URL fragment, which browsers never send to servers or put in logs.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response as ExpressResponse } from 'express';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword, signToken } from '../lib/auth';
import { audit } from '../lib/audit';
import { POLICIES_VERSION } from '../lib/legal';

export const oauthRouter = Router();

export type Provider = 'google' | 'facebook';
type Profile = { id: string; email: string | null; emailVerified: boolean; name: string };

const STATE_COOKIE = 'cs_oauth';
const STAFF = new Set(['subadmin', 'superadmin']);

/** Outbound HTTP to the providers; replaced in tests. */
let http: typeof fetch = (...args) => fetch(...args);
export const setOAuthHttp = (fn: typeof fetch) => {
  http = fn;
};

export function enabledProviders(): Provider[] {
  const out: Provider[] = [];
  if (config.oauth.google.clientId && config.oauth.google.clientSecret) out.push('google');
  if (config.oauth.facebook.appId && config.oauth.facebook.appSecret) out.push('facebook');
  return out;
}

const origin = (req: Request) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
const redirectUri = (req: Request, p: Provider) => `${origin(req)}/api/auth/oauth/${p}/callback`;
/** Only same-site paths, so the flow can't be abused as an open redirect. */
const safeNext = (n: unknown) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n.slice(0, 300) : '/gallery');

function readStateCookie(req: Request): { state: string; next: string; provider: string } | null {
  const raw = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const fail = (res: ExpressResponse, message: string) => res.redirect(`/login?error=${encodeURIComponent(message)}`);

oauthRouter.get('/:provider/start', (req, res) => {
  const provider = req.params.provider as Provider;
  if (!enabledProviders().includes(provider)) return void fail(res, 'This sign-in option is not available yet.');
  const state = crypto.randomBytes(24).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ state, provider, next: safeNext(req.query.next) })).toString('base64url');
  res.cookie(STATE_COOKIE, payload, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 10 * 60_000, path: '/api/auth/oauth' });

  const url =
    provider === 'google'
      ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
      : new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', provider === 'google' ? config.oauth.google.clientId : config.oauth.facebook.appId);
  url.searchParams.set('redirect_uri', redirectUri(req, provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', provider === 'google' ? 'openid email profile' : 'email,public_profile');
  if (provider === 'google') url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

async function json(r: Response) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Provider error ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body as any;
}

async function fetchProfile(req: Request, provider: Provider, code: string): Promise<Profile> {
  if (provider === 'google') {
    const token = await json(
      await http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.oauth.google.clientId,
          client_secret: config.oauth.google.clientSecret,
          redirect_uri: redirectUri(req, 'google'),
          grant_type: 'authorization_code',
        }),
      }),
    );
    const info = await json(
      await http('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } }),
    );
    return { id: String(info.sub), email: info.email ?? null, emailVerified: info.email_verified === true, name: info.name || info.email || 'Collector' };
  }
  const q = new URLSearchParams({
    client_id: config.oauth.facebook.appId,
    client_secret: config.oauth.facebook.appSecret,
    redirect_uri: redirectUri(req, 'facebook'),
    code,
  });
  const token = await json(await http(`https://graph.facebook.com/v19.0/oauth/access_token?${q}`));
  // appsecret_proof proves the request comes from our server, not a stolen token elsewhere.
  const proof = crypto.createHmac('sha256', config.oauth.facebook.appSecret).update(token.access_token).digest('hex');
  const info = await json(
    await http(
      `https://graph.facebook.com/v19.0/me?${new URLSearchParams({ fields: 'id,name,email', access_token: token.access_token, appsecret_proof: proof })}`,
    ),
  );
  // Facebook only returns confirmed email addresses.
  return { id: String(info.id), email: info.email ?? null, emailVerified: !!info.email, name: info.name || 'Collector' };
}

/** Finds the account for this social identity, linking or creating one as needed. */
async function resolveUser(req: Request, provider: Provider, p: Profile) {
  const column = provider === 'google' ? users.googleSub : users.facebookId;
  const linked = db.select().from(users).where(eq(column, p.id)).get();
  if (linked) return { user: linked, created: false };

  if (!p.email) throw new Error('We need your email address. Please allow email access, or sign up with your email instead.');
  if (!p.emailVerified) throw new Error('Your email address is not verified with this provider. Please sign up with your email instead.');
  const email = p.email.toLowerCase();

  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    if (STAFF.has(existing.role)) throw new Error('Admin accounts must sign in with email and password.');
    db.update(users)
      .set(provider === 'google' ? { googleSub: p.id } : { facebookId: p.id })
      .where(eq(users.id, existing.id))
      .run();
    audit(req, 'user.oauth_linked', 'user', existing.id, { provider });
    return { user: { ...existing }, created: false };
  }

  const created = db
    .insert(users)
    .values({
      email,
      name: p.name.slice(0, 80),
      // No usable password until the user sets one in Account settings.
      passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex')),
      passwordSet: false,
      ...(provider === 'google' ? { googleSub: p.id } : { facebookId: p.id }),
    })
    .returning()
    .get();
  audit(req, 'user.register', 'user', created.id, { provider, acceptedPolicies: POLICIES_VERSION });
  return { user: created, created: true };
}

oauthRouter.get('/:provider/callback', async (req, res) => {
  const provider = req.params.provider as Provider;
  const saved = readStateCookie(req);
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });

  if (req.query.error) return void fail(res, 'Sign-in was cancelled.');
  if (!enabledProviders().includes(provider) || !saved || saved.provider !== provider || saved.state !== req.query.state) {
    return void fail(res, 'Your sign-in session expired. Please try again.');
  }
  if (typeof req.query.code !== 'string') return void fail(res, 'Sign-in was cancelled.');

  try {
    const profile = await fetchProfile(req, provider, req.query.code);
    const { user } = await resolveUser(req, provider, profile);
    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      return void fail(res, `This account is locked until ${new Date(user.lockedUntil).toUTCString()}.`);
    }
    if (user.status !== 'active') return void fail(res, 'This account has been suspended.');
    const fragment = new URLSearchParams({ token: signToken(user), next: saved.next });
    res.redirect(`/auth/complete#${fragment}`);
  } catch (err) {
    const message = err instanceof Error && !err.message.startsWith('Provider error') ? err.message : 'We could not complete sign-in. Please try again.';
    if (!(err instanceof Error) || err.message.startsWith('Provider error')) console.error(`OAuth ${provider} failed`, err);
    fail(res, message);
  }
});
