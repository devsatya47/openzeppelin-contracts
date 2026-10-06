// npm run db:migrate
import { db } from './client';
import { runMigrations } from './migrate';

runMigrations(db);
console.log('Migrations applied.');
