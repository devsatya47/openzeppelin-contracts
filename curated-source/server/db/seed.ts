/**
 * npm run seed — rebuilds the database with demo data.
 * WARNING: deletes the existing database file and generated uploads. Refuses to run in production without --force.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

if (config.isProd && !process.argv.includes('--force')) {
  console.error('Refusing to wipe the database in production. Re-run with --force if you are sure.');
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.databasePath + suffix, { force: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
for (const f of fs.readdirSync(config.uploadDir)) if (f !== '.gitkeep') fs.rmSync(path.join(config.uploadDir, f), { force: true });

// The database client opens the file on import, so load it only after the old file is gone.
const { db } = await import('./client');
const { runMigrations } = await import('./migrate');
const { seedDemo } = await import('./demo');

runMigrations(db);
await seedDemo();
