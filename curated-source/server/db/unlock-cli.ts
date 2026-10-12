// npm run unlock-user -- someone@example.com
// Clears a sign-in lock, e.g. when the only Super-Admin has been locked out (run from Render's Shell tab).
import { eq } from 'drizzle-orm';
import { db } from './client';
import { runMigrations } from './migrate';
import { users } from './schema';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run unlock-user -- <email>');
  process.exit(1);
}
runMigrations(db);
const user = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
if (!user) {
  console.error(`No account found for ${email}`);
  process.exit(1);
}
db.update(users).set({ lockedUntil: null, failedLoginCount: 0 }).where(eq(users.id, user.id)).run();
console.log(`Unlocked ${email}`);
