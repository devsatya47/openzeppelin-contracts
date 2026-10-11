import { Router } from 'express';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { galleries, users, type Role } from '../db/schema';
import { currentUser, hashPassword, requireAuth, signToken, verifyPassword } from '../lib/auth';
import { permissionsFor } from '../lib/rbac';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors';
import { audit } from '../lib/audit';
import { POLICIES_VERSION } from '../lib/legal';

export const authRouter = Router();

const STAFF_ROLES: Role[] = ['subadmin', 'superadmin'];
const email = z.string().trim().toLowerCase().email();
/** Staff accounts guard the whole marketplace, so they need longer passwords. */
const passwordFor = (role: Role) =>
  STAFF_ROLES.includes(role)
    ? z.string().min(12, 'Admin passwords must be at least 12 characters').max(128)
    : z.string().min(8, 'Passwords must be at least 8 characters').max(128);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password: z.string().min(8).max(128),
  country: z.string().trim().length(2).toUpperCase().default('US'),
});

function profile(userId: number) {
  const user = db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, country: users.country, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get()!;
  const gallery =
    db
      .select({ id: galleries.id, name: galleries.name, slug: galleries.slug, status: galleries.status })
      .from(galleries)
      .where(eq(galleries.ownerId, userId))
      .get() ?? null;
  return { ...user, gallery, permissions: permissionsFor(user.role) };
}

const lockedMessage = (until: string) =>
  `Too many failed sign-in attempts. This account is locked until ${new Date(until).toUTCString()}. Contact support if you need help.`;

authRouter.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  const exists = db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).get();
  if (exists) throw conflict('An account with this email already exists');
  const created = db
    .insert(users)
    .values({ name: body.name, email: body.email, country: body.country, passwordHash: await hashPassword(body.password) })
    .returning({ id: users.id })
    .get();
  req.user = { id: created.id, email: body.email, name: body.name, role: 'buyer' };
  audit(req, 'user.register', 'user', created.id, { acceptedPolicies: POLICIES_VERSION });
  res.status(201).json({ token: signToken(created), user: profile(created.id) });
});

authRouter.post('/login', async (req, res) => {
  const body = z.object({ email, password: z.string() }).parse(req.body);
  const user = db.select().from(users).where(eq(users.email, body.email)).get();

  // A locked account rejects every attempt, even with the right password, until the lock expires.
  if (user?.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) throw new HttpError(423, lockedMessage(user.lockedUntil));

  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    if (user) {
      const failures = user.failedLoginCount + 1;
      if (failures >= config.maxFailedLogins) {
        const until = new Date(Date.now() + config.loginLockHours * 3_600_000).toISOString();
        db.update(users).set({ failedLoginCount: 0, lockedUntil: until }).where(eq(users.id, user.id)).run();
        audit(req, 'user.locked', 'user', user.id, { failures, until });
        throw new HttpError(423, lockedMessage(until));
      }
      db.update(users).set({ failedLoginCount: failures, lockedUntil: null }).where(eq(users.id, user.id)).run();
    }
    throw unauthorized('Invalid email or password');
  }
  if (user.status !== 'active') throw unauthorized('This account has been suspended');
  if (user.failedLoginCount || user.lockedUntil) {
    db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id)).run();
  }
  res.json({ token: signToken(user), user: profile(user.id) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: profile(currentUser(req).id) });
});

authRouter.patch('/me', requireAuth, (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(2).max(80).optional(), country: z.string().trim().length(2).toUpperCase().optional() })
    .parse(req.body);
  db.update(users).set(body).where(eq(users.id, currentUser(req).id)).run();
  res.json({ user: profile(currentUser(req).id) });
});

/** Re-checks the signed-in user's current password before a sensitive change. */
async function confirmPassword(userId: number, password: string) {
  const row = db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).get();
  if (!row || !(await verifyPassword(password, row.passwordHash))) throw badRequest('Your current password is incorrect');
}

authRouter.post('/change-email', requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string(), newEmail: email }).parse(req.body);
  const user = currentUser(req);
  await confirmPassword(user.id, body.currentPassword);
  const taken = db.select({ id: users.id }).from(users).where(and(eq(users.email, body.newEmail), ne(users.id, user.id))).get();
  if (taken) throw conflict('Another account already uses this email');
  db.update(users).set({ email: body.newEmail }).where(eq(users.id, user.id)).run();
  audit(req, 'user.email_changed', 'user', user.id, { from: user.email, to: body.newEmail });
  res.json({ user: profile(user.id) });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const body = z.object({ currentPassword: z.string(), newPassword: passwordFor(user.role) }).parse(req.body);
  await confirmPassword(user.id, body.currentPassword);
  if (body.currentPassword === body.newPassword) throw badRequest('Choose a password you have not used here before');
  const changedAt = new Date().toISOString();
  db.update(users)
    .set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: changedAt, failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id))
    .run();
  audit(req, 'user.password_changed', 'user', user.id);
  // Every other session is now invalid; hand this one a fresh token so the user stays signed in here.
  res.json({ token: signToken(user), user: profile(user.id) });
});
