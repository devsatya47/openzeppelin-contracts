import { config } from './config';
import { db } from './db/client';
import { runMigrations } from './db/migrate';
import { createApp } from './app';
import { expireStaleOrders } from './routes/orders';

runMigrations(db);

const app = createApp();
app.listen(config.port, () => {
  console.log(`curated-source API listening on http://localhost:${config.port}`);
});

// Release checkout reservations that were never paid.
setInterval(() => {
  try {
    const n = expireStaleOrders();
    if (n) console.log(`Expired ${n} unpaid reservation(s)`);
  } catch (err) {
    console.error('Failed to expire stale orders', err);
  }
}, 60_000).unref();
