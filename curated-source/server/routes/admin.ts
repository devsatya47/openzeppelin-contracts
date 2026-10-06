import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import {
  auditLogs,
  categories,
  disputes,
  escrowTransactions,
  galleries,
  GALLERY_STATUS,
  listings,
  ORDER_STATUS,
  orders,
  payouts,
  ROLES,
  users,
} from '../db/schema';
import { currentUser, requirePermission } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { slugify } from '../lib/util';
import { galleryBalance } from '../lib/escrow';
import { withListings } from './orders';

export const adminRouter = Router();
adminRouter.use(requirePermission('admin:access'));

const sum = (col: SQL | any) => sql<number>`coalesce(sum(${col}), 0)`;

adminRouter.get('/overview', (_req, res) => {
  const gmv = db
    .select({ gmv: sum(orders.totalCents), fees: sum(orders.commissionCents) })
    .from(orders)
    .where(inArray(orders.status, ['in_escrow', 'dispatched', 'delivered', 'released', 'disputed']))
    .get();
  const held = db
    .select({ v: sum(orders.totalCents) })
    .from(orders)
    .where(inArray(orders.status, ['in_escrow', 'dispatched', 'delivered', 'disputed']))
    .get();
  const ordersByStatus = db.select({ status: orders.status, n: count() }).from(orders).groupBy(orders.status).all();
  const c = (q: any) => q.get()?.n ?? 0;
  res.json({
    gmvCents: gmv?.gmv ?? 0,
    commissionCents: gmv?.fees ?? 0,
    escrowHeldCents: held?.v ?? 0,
    users: c(db.select({ n: count() }).from(users)),
    activeListings: c(db.select({ n: count() }).from(listings).where(eq(listings.status, 'active'))),
    pendingGalleries: c(db.select({ n: count() }).from(galleries).where(eq(galleries.status, 'pending'))),
    pendingCategories: c(db.select({ n: count() }).from(categories).where(eq(categories.status, 'pending'))),
    openDisputes: c(db.select({ n: count() }).from(disputes).where(eq(disputes.status, 'open'))),
    pendingPayouts: c(db.select({ n: count() }).from(payouts).where(inArray(payouts.status, ['requested', 'approved']))),
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o.n])),
  });
});

/* ---------- Vendors ---------- */

adminRouter.get('/galleries', requirePermission('vendor:moderate'), (req, res) => {
  const status = z.enum(GALLERY_STATUS).optional().parse(req.query.status || undefined);
  const rows = db
    .select({
      gallery: galleries,
      owner: { id: users.id, name: users.name, email: users.email },
      listingCount: sql<number>`(select count(*) from listings l where l.gallery_id = ${galleries.id})`,
    })
    .from(galleries)
    .innerJoin(users, eq(users.id, galleries.ownerId))
    .where(status ? eq(galleries.status, status) : undefined)
    .orderBy(sql`${galleries.status} = 'pending' desc`, desc(galleries.createdAt))
    .all();
  res.json({ galleries: rows.map((r) => ({ ...r.gallery, owner: r.owner, listingCount: r.listingCount })) });
});

adminRouter.patch('/galleries/:id', requirePermission('vendor:moderate'), (req, res) => {
  const body = z
    .object({ status: z.enum(GALLERY_STATUS).optional(), featured: z.boolean().optional(), reviewNote: z.string().trim().max(1000).optional() })
    .parse(req.body);
  const g = db.select().from(galleries).where(eq(galleries.id, Number(req.params.id))).get();
  if (!g) throw notFound('Gallery not found');
  const updated = db.update(galleries).set(body).where(eq(galleries.id, g.id)).returning().get();
  audit(req, body.status ? `gallery.${body.status}` : 'gallery.update', 'gallery', g.id, { from: g.status, ...body });
  res.json({ gallery: updated });
});

/* ---------- Taxonomy ---------- */

adminRouter.get('/categories', requirePermission('taxonomy:moderate'), (_req, res) => {
  const rows = db
    .select({
      category: categories,
      suggestedBy: users.name,
      listingCount: sql<number>`(select count(*) from listings l where l.category_id = ${categories.id})`,
    })
    .from(categories)
    .leftJoin(users, eq(users.id, categories.suggestedById))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
  res.json({ categories: rows.map((r) => ({ ...r.category, suggestedBy: r.suggestedBy, listingCount: r.listingCount })) });
});

adminRouter.post('/categories', requirePermission('taxonomy:moderate'), (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(2).max(60), parentId: z.number().int().positive().nullable().default(null), description: z.string().trim().max(400).default('') })
    .parse(req.body);
  const slug = slugify(body.name);
  if (db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).get()) throw conflict('A category with this name already exists');
  const c = db.insert(categories).values({ ...body, slug, status: 'approved' }).returning().get();
  audit(req, 'category.create', 'category', c.id, body);
  res.status(201).json({ category: c });
});

adminRouter.patch('/categories/:id', requirePermission('taxonomy:moderate'), (req, res) => {
  const body = z
    .object({
      status: z.enum(['approved', 'rejected']).optional(),
      name: z.string().trim().min(2).max(60).optional(),
      description: z.string().trim().max(400).optional(),
      sortOrder: z.number().int().optional(),
    })
    .parse(req.body);
  const c = db.select().from(categories).where(eq(categories.id, Number(req.params.id))).get();
  if (!c) throw notFound('Category not found');
  const updated = db.transaction((tx) => {
    const patch: Partial<typeof categories.$inferInsert> = { ...body };
    // Approving a suggestion gives it a clean, canonical slug when available.
    if (body.status === 'approved' && c.status === 'pending') {
      const clean = slugify(body.name ?? c.name);
      if (!tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, clean)).get()) patch.slug = clean;
    }
    if (body.status === 'rejected') {
      if (c.parentId == null) throw badRequest('Root categories cannot be rejected');
      // Works filed under a rejected suggestion fall back to its parent so they remain discoverable.
      tx.update(listings).set({ categoryId: c.parentId }).where(eq(listings.categoryId, c.id)).run();
    }
    return tx.update(categories).set(patch).where(eq(categories.id, c.id)).returning().get();
  });
  audit(req, body.status ? `category.${body.status}` : 'category.update', 'category', c.id, { from: c.status, ...body });
  res.json({ category: updated });
});

/* ---------- Orders & disputes ---------- */

adminRouter.get('/orders', requirePermission('order:read_all'), (req, res) => {
  const status = z.enum(ORDER_STATUS).optional().parse(req.query.status || undefined);
  const rows = db.select().from(orders).where(status ? eq(orders.status, status) : undefined).orderBy(desc(orders.createdAt)).limit(200).all();
  res.json({ orders: withListings(rows) });
});

adminRouter.get('/disputes', requirePermission('dispute:resolve'), (req, res) => {
  const status = z.enum(['open', 'resolved_release', 'resolved_refund']).optional().parse(req.query.status || undefined);
  const rows = db
    .select({ dispute: disputes, order: orders, openedBy: users.name, gallery: galleries.name })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .innerJoin(users, eq(users.id, disputes.openedById))
    .innerJoin(galleries, eq(galleries.id, orders.galleryId))
    .where(status ? eq(disputes.status, status) : undefined)
    .orderBy(sql`${disputes.status} = 'open' desc`, desc(disputes.createdAt))
    .all();
  const withL = withListings(rows.map((r) => r.order));
  res.json({ disputes: rows.map((r, i) => ({ ...r.dispute, order: withL[i], openedBy: r.openedBy, gallery: r.gallery })) });
});

/* ---------- Payouts ---------- */

adminRouter.get('/payouts', requirePermission('audit:read'), (_req, res) => {
  const rows = db
    .select({ payout: payouts, gallery: galleries.name, galleryId: galleries.id })
    .from(payouts)
    .innerJoin(galleries, eq(galleries.id, payouts.galleryId))
    .orderBy(sql`${payouts.status} in ('requested','approved') desc`, desc(payouts.createdAt))
    .all();
  res.json({ payouts: rows.map((r) => ({ ...r.payout, gallery: r.gallery })) });
});

const PAYOUT_FLOW: Record<string, string[]> = { requested: ['approved', 'rejected'], approved: ['paid', 'rejected'] };

adminRouter.patch('/payouts/:id', requirePermission('payout:process'), (req, res) => {
  const body = z.object({ status: z.enum(['approved', 'paid', 'rejected']), note: z.string().trim().max(500).optional() }).parse(req.body);
  const p = db.select().from(payouts).where(eq(payouts.id, Number(req.params.id))).get();
  if (!p) throw notFound('Payout not found');
  if (!PAYOUT_FLOW[p.status]?.includes(body.status)) throw badRequest(`Cannot move a ${p.status} payout to ${body.status}`);
  const updated = db
    .update(payouts)
    .set({ status: body.status, note: body.note ?? p.note, processedById: currentUser(req).id, processedAt: new Date().toISOString() })
    .where(eq(payouts.id, p.id))
    .returning()
    .get();
  audit(req, `payout.${body.status}`, 'payout', p.id, { amountCents: p.amountCents, galleryId: p.galleryId });
  res.json({ payout: updated, balance: galleryBalance(p.galleryId) });
});

/* ---------- Listings moderation ---------- */

adminRouter.patch('/listings/:id', requirePermission('listing:moderate'), (req, res) => {
  const body = z.object({ featured: z.boolean().optional(), status: z.enum(['active', 'archived']).optional() }).parse(req.body);
  const l = db.select().from(listings).where(eq(listings.id, Number(req.params.id))).get();
  if (!l) throw notFound('Listing not found');
  if (body.status && ['reserved', 'sold'].includes(l.status)) throw conflict('Listing has an open order');
  const updated = db.update(listings).set(body).where(eq(listings.id, l.id)).returning().get();
  audit(req, 'listing.moderate', 'listing', l.id, body);
  res.json({ listing: updated });
});

/* ---------- Users (super-admin) ---------- */

adminRouter.get('/users', requirePermission('user:manage'), (req, res) => {
  const q = z.string().trim().max(80).optional().parse(req.query.q || undefined);
  const rows = db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, country: users.country, createdAt: users.createdAt })
    .from(users)
    .where(q ? or(like(users.name, `%${q}%`), like(users.email, `%${q}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(200)
    .all();
  res.json({ users: rows });
});

adminRouter.patch('/users/:id', requirePermission('user:manage'), (req, res) => {
  const body = z.object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'suspended']).optional() }).parse(req.body);
  const target = db.select().from(users).where(eq(users.id, Number(req.params.id))).get();
  if (!target) throw notFound('User not found');
  if (target.id === currentUser(req).id) throw forbidden('You cannot change your own role or status');
  if (body.role === 'seller' && !db.select({ id: galleries.id }).from(galleries).where(eq(galleries.ownerId, target.id)).get()) {
    throw badRequest('Sellers need a gallery — ask the user to complete onboarding');
  }
  const updated = db.update(users).set(body).where(eq(users.id, target.id)).returning({ id: users.id, role: users.role, status: users.status }).get();
  audit(req, 'user.update', 'user', target.id, { from: { role: target.role, status: target.status }, to: body });
  res.json({ user: updated });
});

/* ---------- Audit trail ---------- */

adminRouter.get('/audit', requirePermission('audit:read'), (req, res) => {
  const q = z
    .object({
      entityType: z.string().max(40).optional(),
      action: z.string().max(60).optional(),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const where = and(
    q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
    q.action ? like(auditLogs.action, `${q.action}%`) : undefined,
  );
  const pageSize = 50;
  const rows = db
    .select({ log: auditLogs, actor: users.name, actorRole: users.role })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(pageSize)
    .offset((q.page - 1) * pageSize)
    .all();
  const total = db.select({ n: count() }).from(auditLogs).where(where).get()?.n ?? 0;
  res.json({ logs: rows.map((r) => ({ ...r.log, actor: r.actor, actorRole: r.actorRole })), total, page: q.page, pageSize });
});

adminRouter.get('/ledger', requirePermission('audit:read'), (_req, res) => {
  const rows = db
    .select({ tx: escrowTransactions, reference: orders.reference })
    .from(escrowTransactions)
    .innerJoin(orders, eq(orders.id, escrowTransactions.orderId))
    .orderBy(desc(escrowTransactions.id))
    .limit(200)
    .all();
  res.json({ ledger: rows.map((r) => ({ ...r.tx, orderReference: r.reference })) });
});
