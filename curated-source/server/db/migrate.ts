import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DB } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));

// Resolves the migrations folder both from source (server/db) and from the bundled build (build/server.js).
export function runMigrations(db: DB) {
  const folder = [path.join(here, 'migrations'), path.resolve('server/db/migrations')].find((p) =>
    fs.existsSync(path.join(p, 'meta', '_journal.json')),
  );
  if (!folder) throw new Error('Could not locate migrations folder');
  migrate(db, { migrationsFolder: folder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { db } = await import('./client');
  runMigrations(db);
  console.log('Migrations applied.');
}
