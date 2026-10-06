import { config } from './config';
import { db } from './db/client';
import { runMigrations } from './db/migrate';
import { createApp } from './app';
import { expireStaleOrders } from './routes/orders';
import { isDatabaseEmpty, seedDemo } from './db/demo';

runMigrations(db);

const app = createApp();
app.listen(config.port, () => {
  console.log(`curated-source API listening on http://localhost:${config.port}`);
  // Seed after listening so the platform health check passes while artwork renders (can take a minute).
  if (config.autoSeedDemo && isDatabaseEmpty()) {
    console.log('AUTO_SEED_DEMO: empty database, loading demo catalogue…');
    seedDemo().catch((err) => console.error('Demo seed failed', err));
  }
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
