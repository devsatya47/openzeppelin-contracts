import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, enquiries, ENQUIRY_STATUS, galleries, listingMedia, listings, orders, payouts, questions, users } from '../db/schema';
import { config } from '../config';
import { currentUser, requirePermission } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { storeMedia } from '../lib/images';
import { galleryBalance } from '../lib/escrow';
import { hydrateListings, mediaFor } from '../lib/listings';
import { slugify, uniqueSuffix } from '../lib/util';
import { audit } from '../lib/audit';
import { acceptTermsSchema, POLICIES_VERSION } from '../lib/legal';
import { withListings } from './orders';
import { dashboardUrl, onboardingUrl, paymentsEnabled, refreshGalleryAccount } from '../lib/payments';

export const vendorRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 12 } });

function myGallery(userId: number) {
  const g = db.select().from(galleries).where(eq(galleries.ownerId, userId)).get();
  if (!g) throw notFound('You have not set up a gallery yet');
  return g;
}

/** Onboarding: any buyer can open a gallery. It is reviewed by an admin before its works go public. */
vendorRouter.post('/apply', requirePermission('gallery:apply'), (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(80),
      tagline: z.string().trim().max(140).default(''),
      bio: z.string().trim().max(4000).default(''),
      location: z.string().trim().max(120).default(''),
      country: z.string().trim().length(2).toUpperCase().default('US'),
      acceptTerms: acceptTermsSchema,
    })
    .parse(req.body);
  const { acceptTerms: _accepted, ...fields } = body;
  const user = currentUser(req);
  if (db.select({ id: galleries.id }).from(galleries).where(eq(galleries.ownerId, user.id)).get()) {
    throw conflict('You already have a gallery');
  }
  const gallery = db.transaction((tx) => {
    const g = tx
      .insert(galleries)
      .values({ ...fields, ownerId: user.id, slug: `${slugify(fields.name)}-${uniqueSuffix()}` })
      .returning()
      .get();
    tx.update(users).set({ role: 'seller' }).where(eq(users.id, user.id)).run();
    return g;
  });
  req.user = { ...user, role: 'seller' };
  audit(req, 'gallery.apply', 'gallery', gallery.id, { name: gallery.name, acceptedSellerAgreement: POLICIES_VERSION });
  res.status(201).json({ gallery });
});

vendorRouter.use(requirePermission('listing:manage'));

vendorRouter.get('/gallery', (req, res) => {
  const g = myGallery(currentUser(req).id);
  res.json({ gallery: g, balance: galleryBalance(g.id) });
});

vendorRouter.patch('/gallery', (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      tagline: z.string().trim().max(140).optional(),
      bio: z.string().trim().max(4000).optional(),
      location: z.string().trim().max(120).optional(),
      country: z.string().trim().length(2).toUpperCase().optional(),
      coverUrl: z.string().startsWith('/uploads/').optional(),
      // A work from this gallery to feature as the page banner, or null to use the uploaded cover.
      bannerListingId: z.number().int().positive().nullable().optional(),
    })
    .parse(req.body);
  const g = myGallery(currentUser(req).id);
  if (body.bannerListingId) {
    const own = db.select({ id: listings.id }).from(listings).where(and(eq(listings.id, body.bannerListingId), eq(listings.galleryId, g.id))).get();
    if (!own) throw badRequest('Choose one of your own works for the banner');
  }
  const updated = db.update(galleries).set(body).where(eq(galleries.id, g.id)).returning().get();
  audit(req, 'gallery.update', 'gallery', g.id, body);
  res.json({ gallery: updated });
});

/** Drag-and-drop uploader endpoint: stores masters and auto-generates thumbnails. */
vendorRouter.post('/uploads', upload.array('files', 12), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('No files received');
  const media = [];
  for (const f of files) media.push(await storeMedia(f));
  res.status(201).json({ media });
});

const mediaSchema = z.object({
  kind: z.enum(['image', 'video']),
  url: z.string().startsWith('/uploads/'),
  thumbUrl: z.string().startsWith('/uploads/'),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
});

const listingFields = z.object({
  title: z.string().trim().min(2).max(140),
  artist: z.string().trim().min(2).max(120),
  year: z.number().int().min(1000).max(new Date().getFullYear() + 1).nullable().optional(),
  medium: z.string().trim().min(2).max(80),
  description: z.string().trim().max(6000).default(''),
  widthCm: z.number().positive().max(10000).nullable().optional(),
  heightCm: z.number().positive().max(10000).nullable().optional(),
  depthCm: z.number().positive().max(10000).nullable().optional(),
  // With price on request the price is optional (0 = not stated) and never shown publicly.
  priceCents: z
    .number()
    .int()
    .min(0)
    .max(config.maxPriceCents, `Prices are currently limited to $${(config.maxPriceCents / 100).toLocaleString('en-US')} per work`),
  shippingDomesticCents: z.number().int().min(0).max(100_000_00),
  shippingInternationalCents: z.number().int().min(0).max(100_000_00),
  originCountry: z.string().trim().length(2).toUpperCase().optional(),
  provenance: z.string().trim().max(4000).default(''),
  edition: z.string().trim().max(120).default('Unique work'),
  certificateOfAuthenticity: z.boolean().default(true),
  categoryId: z.number().int().positive().optional(),
  suggestedCategory: z.object({ parentId: z.number().int().positive(), name: z.string().trim().min(2).max(60) }).optional(),
  priceOnRequest: z.boolean().default(false),
  status: z.enum(['draft', 'active', 'hidden']).default('active'),
  media: z.array(mediaSchema).max(12).default([]),
});

const priceStated = (v: { priceOnRequest?: boolean; priceCents?: number }) => v.priceOnRequest || (v.priceCents ?? 0) >= 100;
const PRICE_MESSAGE = { message: 'Enter a price of at least $1, or choose price on request', path: ['priceCents'] };

const listingSchema = listingFields
  .refine((v) => v.categoryId || v.suggestedCategory, { message: 'Choose a category or suggest a new one', path: ['categoryId'] })
  .refine(priceStated, PRICE_MESSAGE);

/** Resolves the listing's category, creating a pending user-suggested subcategory when needed. */
function resolveCategory(userId: number, input: { categoryId?: number; suggestedCategory?: { parentId: number; name: string } }) {
  if (input.suggestedCategory) {
    const parent = db.select().from(categories).where(eq(categories.id, input.suggestedCategory.parentId)).get();
    if (!parent || parent.status !== 'approved') throw badRequest('Parent category not found');
    const existing = db
      .select()
      .from(categories)
      .where(and(eq(categories.parentId, parent.id), sql`lower(${categories.name}) = lower(${input.suggestedCategory.name})`))
      .get();
    if (existing && existing.status !== 'rejected') return { id: existing.id, created: false };
    const c = db
      .insert(categories)
      .values({
        parentId: parent.id,
        name: input.suggestedCategory.name,
        slug: `${slugify(input.suggestedCategory.name)}-${uniqueSuffix()}`,
        status: 'pending',
        suggestedById: userId,
      })
      .returning()
      .get();
    return { id: c.id, created: true };
  }
  const c = db.select().from(categories).where(eq(categories.id, input.categoryId!)).get();
  if (!c || c.status === 'rejected') throw badRequest('Category not found');
  return { id: c.id, created: false };
}

function replaceMedia(listingId: number, media: z.infer<typeof mediaSchema>[]) {
  db.delete(listingMedia).where(eq(listingMedia.listingId, listingId)).run();
  media.forEach((m, i) =>
    db.insert(listingMedia).values({ ...m, width: m.width ?? null, height: m.height ?? null, listingId, position: i }).run(),
  );
}

vendorRouter.get('/listings', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const rows = db
    .select()
    .from(listings)
    .where(eq(listings.galleryId, g.id))
    .orderBy(asc(listings.sortOrder), desc(listings.createdAt))
    .all();
  res.json({ listings: hydrateListings(rows) });
});

/** Saves the gallery's chosen order (ids first to last); it is also the order on the public gallery page. */
vendorRouter.put('/listings/order', (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(2000) }).parse(req.body);
  const g = myGallery(currentUser(req).id);
  const own = new Set(db.select({ id: listings.id }).from(listings).where(eq(listings.galleryId, g.id)).all().map((r) => r.id));
  if (ids.some((id) => !own.has(id)) || new Set(ids).size !== ids.length) throw badRequest('Unknown or repeated listing in the new order');
  db.transaction((tx) => {
    ids.forEach((id, i) => tx.update(listings).set({ sortOrder: i + 1 }).where(eq(listings.id, id)).run());
  });
  res.json({ ok: true });
});

vendorRouter.get('/listings/:id', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const l = db.select().from(listings).where(and(eq(listings.id, Number(req.params.id)), eq(listings.galleryId, g.id))).get();
  if (!l) throw notFound('Listing not found');
  const category = db.select().from(categories).where(eq(categories.id, l.categoryId)).get();
  res.json({ listing: { ...l, media: mediaFor(l.id), category } });
});

vendorRouter.post('/listings', (req, res) => {
  const body = listingSchema.parse(req.body);
  const user = currentUser(req);
  const g = myGallery(user.id);
  if (body.status === 'active' && !body.media.length) throw badRequest('Add at least one image to publish');
  const created = db.transaction(() => {
    const cat = resolveCategory(user.id, body);
    const { media, suggestedCategory: _s, categoryId: _c, ...fields } = body;
    // New works go to the top of the gallery's own ordering.
    const first = db.select({ min: sql<number | null>`min(${listings.sortOrder})` }).from(listings).where(eq(listings.galleryId, g.id)).get()?.min;
    const l = db
      .insert(listings)
      .values({
        ...fields,
        sortOrder: (first ?? 1) - 1,
        categoryId: cat.id,
        originCountry: fields.originCountry ?? g.country,
        galleryId: g.id,
        slug: `${slugify(`${body.title} ${body.artist}`)}-${uniqueSuffix()}`,
      })
      .returning()
      .get();
    replaceMedia(l.id, media);
    return { l, suggested: cat.created };
  });
  audit(req, 'listing.create', 'listing', created.l.id, { title: created.l.title, suggestedCategory: created.suggested });
  if (created.suggested) audit(req, 'category.suggest', 'category', created.l.categoryId, { name: body.suggestedCategory?.name });
  res.status(201).json({ listing: created.l, galleryStatus: g.status });
});

vendorRouter.patch('/listings/:id', (req, res) => {
  const user = currentUser(req);
  const g = myGallery(user.id);
  const existing = db.select().from(listings).where(and(eq(listings.id, Number(req.params.id)), eq(listings.galleryId, g.id))).get();
  if (!existing) throw notFound('Listing not found');
  if (['reserved', 'sold'].includes(existing.status)) throw conflict('Listings with an open order cannot be edited');
  const parsed = listingFields.partial().extend({ status: z.enum(['draft', 'active', 'hidden', 'archived']).optional() }).parse(req.body);
  // Only apply keys the client actually sent, so schema defaults never overwrite stored values.
  const body = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in (req.body ?? {}))) as typeof parsed;
  const updated = db.transaction(() => {
    const { media, suggestedCategory, categoryId, ...fields } = body;
    const patch: Partial<typeof listings.$inferInsert> = { ...fields };
    if (categoryId || suggestedCategory) patch.categoryId = resolveCategory(user.id, { categoryId, suggestedCategory }).id;
    if (media) replaceMedia(existing.id, media);
    if (patch.status === 'active' && !(media ?? mediaFor(existing.id)).length) throw badRequest('Add at least one image to publish');
    if (!priceStated({ priceOnRequest: patch.priceOnRequest ?? existing.priceOnRequest, priceCents: patch.priceCents ?? existing.priceCents })) {
      throw badRequest(PRICE_MESSAGE.message);
    }
    return db.update(listings).set(patch).where(eq(listings.id, existing.id)).returning().get();
  });
  audit(req, 'listing.update', 'listing', existing.id, { fields: Object.keys(body) });
  res.json({ listing: updated });
});

/**
 * Permanently deletes a work. Works with any order are kept, because orders, reviews and the escrow
 * ledger refer to them; the gallery can hide those instead.
 */
vendorRouter.delete('/listings/:id', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const existing = db.select().from(listings).where(and(eq(listings.id, Number(req.params.id)), eq(listings.galleryId, g.id))).get();
  if (!existing) throw notFound('Listing not found');
  const hasOrders = db.select({ id: orders.id }).from(orders).where(eq(orders.listingId, existing.id)).limit(1).get();
  if (hasOrders) throw conflict('This work has an order, so it must stay in your records. You can hide it instead.');
  const media = mediaFor(existing.id);
  db.transaction((tx) => {
    tx.update(galleries).set({ bannerListingId: null }).where(eq(galleries.bannerListingId, existing.id)).run();
    tx.delete(listings).where(eq(listings.id, existing.id)).run(); // media, questions and enquiries cascade
  });
  removeUnusedUploads(media.flatMap((m) => [m.url, m.thumbUrl]));
  audit(req, 'listing.delete', 'listing', existing.id, { title: existing.title });
  res.json({ ok: true });
});

/** Deletes uploaded files that no listing or gallery uses any more (best effort). */
function removeUnusedUploads(urls: string[]) {
  for (const url of new Set(urls)) {
    const stillUsed =
      db.select({ id: listingMedia.id }).from(listingMedia).where(sql`${listingMedia.url} = ${url} or ${listingMedia.thumbUrl} = ${url}`).limit(1).get() ||
      db.select({ id: galleries.id }).from(galleries).where(eq(galleries.coverUrl, url)).limit(1).get();
    if (stillUsed) continue;
    fs.promises.rm(path.join(config.uploadDir, path.basename(url)), { force: true }).catch(() => {});
  }
}

/** Private purchase enquiries for this gallery's works, newest first. */
vendorRouter.get('/enquiries', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const rows = db
    .select({
      id: enquiries.id,
      message: enquiries.message,
      status: enquiries.status,
      createdAt: enquiries.createdAt,
      buyerName: users.name,
      buyerEmail: users.email,
      buyerCountry: users.country,
      listingTitle: listings.title,
      listingSlug: listings.slug,
    })
    .from(enquiries)
    .innerJoin(users, eq(users.id, enquiries.buyerId))
    .innerJoin(listings, eq(listings.id, enquiries.listingId))
    .where(eq(enquiries.galleryId, g.id))
    .orderBy(desc(enquiries.id))
    .all();
  res.json({ enquiries: rows, unread: rows.filter((r) => r.status === 'new').length });
});

vendorRouter.patch('/enquiries/:id', (req, res) => {
  const { status } = z.object({ status: z.enum(ENQUIRY_STATUS) }).parse(req.body);
  const g = myGallery(currentUser(req).id);
  const updated = db
    .update(enquiries)
    .set({ status })
    .where(and(eq(enquiries.id, Number(req.params.id)), eq(enquiries.galleryId, g.id)))
    .returning({ id: enquiries.id })
    .get();
  if (!updated) throw notFound('Enquiry not found');
  res.json({ ok: true });
});

vendorRouter.get('/orders', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const rows = db.select().from(orders).where(eq(orders.galleryId, g.id)).orderBy(desc(orders.createdAt)).all();
  res.json({ orders: withListings(rows) });
});

vendorRouter.get('/analytics', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const sold = ['in_escrow', 'dispatched', 'delivered', 'released', 'disputed'] as const;
  const totals = db
    .select({
      orders: count(),
      gross: sql<number>`coalesce(sum(${orders.priceCents}), 0)`,
      net: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.commissionCents}), 0)`,
    })
    .from(orders)
    .where(and(eq(orders.galleryId, g.id), inArray(orders.status, [...sold])))
    .get();
  const monthly = db
    .select({ month: sql<string>`substr(${orders.createdAt}, 1, 7)`, gross: sql<number>`sum(${orders.priceCents})`, n: count() })
    .from(orders)
    .where(and(eq(orders.galleryId, g.id), inArray(orders.status, [...sold])))
    .groupBy(sql`substr(${orders.createdAt}, 1, 7)`)
    .all();
  const months: { month: string; grossCents: number; orders: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const m = monthly.find((x) => x.month === key);
    months.push({ month: key, grossCents: m?.gross ?? 0, orders: m?.n ?? 0 });
  }
  const inventory = db
    .select({ status: listings.status, n: count() })
    .from(listings)
    .where(eq(listings.galleryId, g.id))
    .groupBy(listings.status)
    .all();
  const views = db.select({ v: sql<number>`coalesce(sum(${listings.views}),0)` }).from(listings).where(eq(listings.galleryId, g.id)).get()?.v ?? 0;
  const top = db
    .select({ id: listings.id, title: listings.title, slug: listings.slug, views: listings.views, status: listings.status })
    .from(listings)
    .where(eq(listings.galleryId, g.id))
    .orderBy(desc(listings.views))
    .limit(5)
    .all();
  res.json({
    totals: { orders: totals?.orders ?? 0, grossCents: totals?.gross ?? 0, netCents: totals?.net ?? 0, views },
    conversionRate: views ? (totals?.orders ?? 0) / views : 0,
    monthly: months,
    inventory: Object.fromEntries(inventory.map((i) => [i.status, i.n])),
    topListings: top,
    balance: galleryBalance(g.id),
  });
});

vendorRouter.get('/payouts', (req, res) => {
  const g = myGallery(currentUser(req).id);
  res.json({
    payouts: db.select().from(payouts).where(eq(payouts.galleryId, g.id)).orderBy(desc(payouts.createdAt)).all(),
    balance: galleryBalance(g.id),
  });
});

const origin = (req: { protocol: string; get(h: string): string | undefined }) => `${req.protocol}://${req.get('host')}`;

/** The gallery's Stripe account status (refreshed from Stripe). */
vendorRouter.get('/stripe', async (req, res) => {
  const g = myGallery(currentUser(req).id);
  if (!paymentsEnabled()) return void res.json({ enabled: false });
  res.json({ enabled: true, ...(await refreshGalleryAccount(g)) });
});

/** Starts or continues Stripe's sign-up for the gallery (identity and bank details are entered on Stripe). */
vendorRouter.post('/stripe/onboard', requirePermission('payout:request'), async (req, res) => {
  const user = currentUser(req);
  const g = myGallery(user.id);
  if (g.status !== 'approved') throw forbidden('Your gallery must be approved before connecting payouts');
  try {
    const url = await onboardingUrl(g, user.email, origin(req));
    audit(req, 'gallery.stripe_onboard', 'gallery', g.id);
    res.json({ url });
  } catch (err) {
    // Stripe explains unsupported countries and similar problems in plain language.
    if (err && typeof err === 'object' && 'type' in err && String((err as { type: string }).type).startsWith('Stripe')) {
      throw badRequest((err as unknown as Error).message);
    }
    throw err;
  }
});

/** Opens the gallery's Stripe dashboard (payouts, bank account, tax forms). */
vendorRouter.post('/stripe/dashboard', requirePermission('payout:request'), async (req, res) => {
  res.json({ url: await dashboardUrl(myGallery(currentUser(req).id)) });
});

vendorRouter.post('/payouts', requirePermission('payout:request'), (req, res) => {
  if (paymentsEnabled()) throw badRequest('Your earnings are sent to your Stripe account automatically when each sale completes');
  const body = z
    .object({
      amountCents: z.number().int().min(1000, 'Minimum withdrawal is $10'),
      method: z.enum(['bank_transfer', 'wire', 'paypal']),
      destination: z.string().trim().min(4).max(120),
    })
    .parse(req.body);
  const g = myGallery(currentUser(req).id);
  if (g.status !== 'approved') throw forbidden('Your gallery must be approved before requesting payouts');
  const payout = db.transaction((tx) => {
    // Balance is checked inside the transaction so concurrent requests cannot overdraw.
    if (body.amountCents > galleryBalance(g.id).availableCents) throw badRequest('Amount exceeds available balance');
    return tx.insert(payouts).values({ ...body, galleryId: g.id }).returning().get();
  });
  audit(req, 'payout.request', 'payout', payout.id, { amountCents: payout.amountCents });
  res.status(201).json({ payout });
});

vendorRouter.get('/questions', (req, res) => {
  const g = myGallery(currentUser(req).id);
  const rows = db
    .select({
      id: questions.id,
      body: questions.body,
      answer: questions.answer,
      createdAt: questions.createdAt,
      asker: users.name,
      listingId: listings.id,
      listingTitle: listings.title,
      listingSlug: listings.slug,
    })
    .from(questions)
    .innerJoin(listings, eq(listings.id, questions.listingId))
    .innerJoin(users, eq(users.id, questions.askerId))
    .where(eq(listings.galleryId, g.id))
    .orderBy(sql`${questions.answer} is not null`, desc(questions.createdAt))
    .all();
  res.json({ questions: rows, unanswered: rows.filter((r) => !r.answer).length });
});

vendorRouter.post('/questions/:id/answer', (req, res) => {
  const body = z.object({ answer: z.string().trim().min(2).max(2000) }).parse(req.body);
  const g = myGallery(currentUser(req).id);
  const q = db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(listings, eq(listings.id, questions.listingId))
    .where(and(eq(questions.id, Number(req.params.id)), eq(listings.galleryId, g.id)))
    .get();
  if (!q) throw notFound('Question not found');
  db.update(questions).set({ answer: body.answer, answeredAt: new Date().toISOString() }).where(eq(questions.id, q.id)).run();
  audit(req, 'question.answer', 'question', q.id);
  res.json({ ok: true });
});

/** Category tree for the listing form, including the vendor's own pending suggestions. */
vendorRouter.get('/categories', (req, res) => {
  const user = currentUser(req);
  const rows = db
    .select()
    .from(categories)
    .where(sql`${categories.status} = 'approved' or (${categories.status} = 'pending' and ${categories.suggestedById} = ${user.id})`)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
  res.json({
    categories: rows
      .filter((c) => c.parentId == null)
      .map((c) => ({ ...c, children: rows.filter((x) => x.parentId === c.id) })),
  });
});
