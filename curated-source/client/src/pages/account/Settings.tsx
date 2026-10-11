import { useState, type FormEvent, type ReactNode } from 'react';
import { Page } from '../../components/Layout';
import { ErrorNote, Field, Notice, SectionHeading } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { COUNTRIES } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import type { User } from '../../lib/types';

/** Shared submit/feedback handling for each settings card. */
function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const submit = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await fn();
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, submit };
}

function Card({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="card grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_1.4fr]">
      <div>
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2 text-sm text-mute">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

export default function Settings() {
  useDocumentTitle('Account settings');
  const { user, setSession } = useAuth();
  const staff = user?.role === 'subadmin' || user?.role === 'superadmin';
  const minLength = staff ? 12 : 8;
  const hasPassword = user?.passwordSet !== false;
  const connected = [user?.connected?.google && 'Google', user?.connected?.facebook && 'Facebook'].filter(Boolean).join(' and ');

  const [profile, setProfile] = useState({ name: user?.name ?? '', country: user?.country ?? 'US' });
  const [emailForm, setEmailForm] = useState({ newEmail: '', currentPassword: '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const p = useForm();
  const e = useForm();
  const w = useForm();

  if (!user) return null;

  return (
    <Page className="py-12">
      <SectionHeading eyebrow="Your account" title="Account settings" />
      <div className="max-w-4xl space-y-6">
        <Card title="Profile" description="Your name as galleries see it on orders, and your country for shipping estimates.">
          <form
            className="space-y-5"
            onSubmit={p.submit(async () => {
              const r = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: profile });
              setSession(null, r.user);
            })}
          >
            <Field label="Full name">
              <input value={profile.name} onChange={(ev) => setProfile({ ...profile, name: ev.target.value })} className="field" required minLength={2} autoComplete="name" />
            </Field>
            <Field label="Country">
              <select value={profile.country} onChange={(ev) => setProfile({ ...profile, country: ev.target.value })} className="field">
                {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </Field>
            <ErrorNote error={p.error} />
            {p.done && <Notice tone="ok">Profile saved.</Notice>}
            <button className="btn-outline btn-sm" disabled={p.busy}>Save profile</button>
          </form>
        </Card>

        {connected && (
          <Notice>You can also sign in with {connected}.</Notice>
        )}

        <Card title="Email address" description="Used to sign in and for messages about your orders. Use an address you check regularly.">
          <form
            className="space-y-5"
            onSubmit={e.submit(async () => {
              const r = await api<{ user: User }>('/auth/change-email', { body: emailForm });
              setSession(null, r.user);
              setEmailForm({ newEmail: '', currentPassword: '' });
            })}
          >
            <p className="text-sm text-mute">Current: <span className="text-bone">{user.email}</span></p>
            {!hasPassword && <p className="text-sm text-warn">Set a password below first. Changing your email needs it.</p>}
            <Field label="New email">
              <input type="email" value={emailForm.newEmail} onChange={(ev) => setEmailForm({ ...emailForm, newEmail: ev.target.value })} className="field" required autoComplete="email" />
            </Field>
            <Field label="Current password">
              <input type="password" value={emailForm.currentPassword} onChange={(ev) => setEmailForm({ ...emailForm, currentPassword: ev.target.value })} className="field" required autoComplete="current-password" />
            </Field>
            <ErrorNote error={e.error} />
            {e.done && <Notice tone="ok">Email updated. Use it the next time you sign in.</Notice>}
            <button className="btn-outline btn-sm" disabled={e.busy}>Change email</button>
          </form>
        </Card>

        <Card
          title={hasPassword ? 'Password' : 'Set a password'}
          description={
            hasPassword
              ? `At least ${minLength} characters${staff ? ' for admin accounts' : ''}. A long passphrase from a password manager is best. Changing it signs you out on every other device.`
              : `You signed up with ${connected || 'a social account'}. Add a password if you'd also like to sign in with your email (at least ${minLength} characters).`
          }
        >
          <form
            className="space-y-5"
            onSubmit={w.submit(async () => {
              if (pw.newPassword !== pw.confirm) throw new Error('The new passwords do not match');
              const r = await api<{ token: string; user: User }>('/auth/change-password', {
                body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword },
              });
              setSession(r.token, r.user);
              setPw({ currentPassword: '', newPassword: '', confirm: '' });
            })}
          >
            {hasPassword && (
              <Field label="Current password">
                <input type="password" value={pw.currentPassword} onChange={(ev) => setPw({ ...pw, currentPassword: ev.target.value })} className="field" required autoComplete="current-password" />
              </Field>
            )}
            <Field label="New password">
              <input type="password" value={pw.newPassword} onChange={(ev) => setPw({ ...pw, newPassword: ev.target.value })} className="field" required minLength={minLength} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <input type="password" value={pw.confirm} onChange={(ev) => setPw({ ...pw, confirm: ev.target.value })} className="field" required minLength={minLength} autoComplete="new-password" />
            </Field>
            <ErrorNote error={w.error} />
            {w.done && <Notice tone="ok">Password saved. Other devices have been signed out.</Notice>}
            <button className="btn-gold btn-sm" disabled={w.busy}>{hasPassword ? 'Change password' : 'Set password'}</button>
          </form>
        </Card>
      </div>
    </Page>
  );
}
