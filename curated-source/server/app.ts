import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { authenticate } from './lib/auth';
import { POLICIES_VERSION } from './lib/legal';
import { renderShell } from './lib/seo';
import { errorHandler, notFoundHandler } from './lib/errors';
import { authRouter } from './routes/auth';
import { enabledProviders, oauthRouter } from './routes/oauth';
import { catalogRouter } from './routes/catalog';
import { ordersRouter } from './routes/orders';
import { vendorRouter } from './routes/vendor';
import { adminRouter } from './routes/admin';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        },
      },
    }),
  );
  app.use(compression());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use(authenticate);
  // Sign-in protection per IP address: failed sign-ins only (successes don't count), blocked for the lock period.
  api.post(
    '/auth/login',
    rateLimit({
      windowMs: config.loginLockHours * 3_600_000,
      limit: config.maxFailedLoginsPerIp,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: `Too many failed sign-in attempts from this network. Please try again in ${config.loginLockHours} hours.` },
    }),
  );
  // Slow down mass sign-ups and password-change guessing.
  const writeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isProd ? 30 : 1000, standardHeaders: true, legacyHeaders: false });
  api.post(['/auth/register', '/auth/change-password', '/auth/change-email'], writeLimiter);
  api.get('/health', (_req, res) => void res.json({ ok: true, time: new Date().toISOString() }));
  api.get('/config', (_req, res) =>
    void res.json({
      commissionRate: config.commissionRate,
      policiesVersion: POLICIES_VERSION,
      maxPriceCents: config.maxPriceCents,
      showDemoLogins: config.showDemoLogins,
      oauthProviders: enabledProviders(),
    }),
  );
  api.use('/auth/oauth', oauthRouter);
  api.use('/auth', authRouter);
  api.use('/orders', ordersRouter);
  api.use('/vendor', vendorRouter);
  api.use('/admin', adminRouter);
  api.use('/', catalogRouter);
  api.use(notFoundHandler);

  app.use('/api', api);
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, fallthrough: false }));

  // Serve the built SPA when present (single-server deployment). Static hosts use dist/.htaccess instead.
  if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
    // Hashed bundles never change, so browsers may cache them for a year.
    app.use('/assets', express.static(path.join(config.distDir, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }));
    app.use(express.static(config.distDir, { maxAge: '1h', index: false }));
    // The page itself must always be revalidated so a new deploy is picked up straight away.
    app.get(/^(?!\/api|\/uploads|\/assets).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(renderShell(req));
    });
  }

  app.use(errorHandler);
  return app;
}
