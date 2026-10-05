import { Router } from 'express';
import { z } from 'zod';
import { and, asc, avg, count, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, galleries, listings, questions, reviews, users } from '../db/schema';
import { categoryWithDescendants, hydrateListing, hydrateListings, mediaFor } from '../lib/listings';
import { currentUser, requirePermission } from '../lib/auth';
import { can } from '../lib/rbac';
import { notFound } from '../lib/errors';
import { shippingFor } from '../lib/util';
import { audit } from '../lib/audit';

export const catalogRouter = Router();

const PUBLIC_STATUSES = ['active', 'reserved'] as const;
const publicListing = () => and(eq(galleries.status, 'approved'), inArray(listings.status, [...PUBLIC_STATUSES]));
const longestEdge = sql<number>`max(coalesce(${listings.widthCm}, 0), coalesce(${listings.heightCm}, 0))`;
const SIZE_BUCKETS = { small: [0, 50], medium: [50, 120], large: [120, 100000] } as const;

/** Category tree (approved only) with counts of publicly visible listings, rolled up to parents. */
catalogRouter.get('/categories', (_req, res) => {
  const cats = db.select().from(categories).where(eq(categories.status, 'approved')).orderBy(asc(categories.sortOrder), asc(categories.name)).all();
  const counts = db
    .select({ categoryId: listings.categoryId, n: count() })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(publicListing())
    .groupBy(listings.categoryId)
    .all();
  const allCats = db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all();
  const direct = new Map(counts.map((c) => [c.categoryId, c.n]));
  const total = (id: number): number =>
    (direct.get(id) ?? 0) + allCats.filter((c) => c.parentId === id).reduce((s, c) => s + total(c.id), 0);
  const node = (c: (typeof cats)[number]): any => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    count: total(c.id),
    children: cats.filter((x) => x.parentId === c.id).map(node),
  });
  res.json({ categories: cats.filter((c) => c.parentId == null).map(node) });
});

catalogRouter.get('/galleries', (req, res) => {
  const featuredOnly = req.query.featured === '1';
  const rows = db
    .select({
      id: galleries.id,
      name: galleries.name,
      slug: galleries.slug,
      tagline: galleries.tagline,
      location: galleries.location,
      coverUrl: galleries.coverUrl,
      featured: galleries.featured,
      listingCount: sql<number>`(select count(*) from listings l where l.gallery_id = ${galleries.id} and l.status in ('active','reserved'))`,
      rating: sql<number | null>`(select avg(rating) from reviews r where r.gallery_id = ${galleries.id})`,
    })
    .from(galleries)
    .where(and(eq(galleries.status, 'approved'), featuredOnly ? eq(galleries.featured, true) : undefined))
    .orderBy(desc(galleries.featured), asc(galleries.name))
    .all();
  res.json({ galleries: rows });
});

catalogRouter.get('/galleries/:slug', (req, res) => {
  const gallery = db.select().from(galleries).where(eq(galleries.slug, req.params.slug)).get();
  if (!gallery || gallery.status !== 'approved') throw notFound('Gallery not found');
  const rows = db
    .select({ l: listings })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(and(eq(listings.galleryId, gallery.id), publicListing()))
    .orderBy(desc(listings.featured), desc(listings.createdAt))
    .all()
    .map((r) => r.l);
  const reviewRows = db
    .select({ id: reviews.id, rating: reviews.rating, body: reviews.body, createdAt: reviews.createdAt, buyer: users.name, listing: listings.title })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.buyerId))
    .innerJoin(listings, eq(listings.id, reviews.listingId))
    .where(eq(reviews.galleryId, gallery.id))
    .orderBy(desc(reviews.createdAt))
    .limit(20)
    .all();
  const rating = db.select({ avg: avg(reviews.rating), n: count() }).from(reviews).where(eq(reviews.galleryId, gallery.id)).get();
  const { reviewNote: _note, ownerId: _owner, ...publicGallery } = gallery;
  res.json({
    gallery: { ...publicGallery, rating: rating?.avg ? Number(rating.avg) : null, reviewCount: rating?.n ?? 0 },
    listings: hydrateListings(rows),
    reviews: reviewRows,
  });
});

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().optional(),
  gallery: z.string().optional(),
  medium: z.string().optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  featured: z.literal('1').optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

catalogRouter.get('/listings', (req, res) => {
  const q = listQuery.parse(req.query);
  const conds: (SQL | undefined)[] = [publicListing()];
  if (q.q) {
    const term = `%${q.q}%`;
    conds.push(or(like(listings.title, term), like(listings.artist, term), like(listings.medium, term), like(galleries.name, term)));
  }
  let categoryCond: SQL | undefined;
  if (q.category) {
    const cat = db.select({ id: categories.id }).from(categories).where(eq(categories.slug, q.category)).get();
    categoryCond = cat ? inArray(listings.categoryId, categoryWithDescendants(cat.id)) : sql`0`;
    conds.push(categoryCond);
  }
  if (q.gallery) conds.push(inArray(galleries.slug, q.gallery.split(',')));
  if (q.medium) conds.push(inArray(listings.medium, q.medium.split(',')));
  if (q.minPrice != null) conds.push(gte(listings.priceCents, Math.round(q.minPrice * 100)));
  if (q.maxPrice != null) conds.push(lte(listings.priceCents, Math.round(q.maxPrice * 100)));
  if (q.size) {
    const [lo, hi] = SIZE_BUCKETS[q.size];
    conds.push(and(sql`${longestEdge} >= ${lo}`, sql`${longestEdge} < ${hi}`));
  }
  if (q.featured) conds.push(eq(listings.featured, true));
  const where = and(...conds);

  const order = {
    newest: [desc(listings.createdAt), desc(listings.id)],
    price_asc: [asc(listings.priceCents)],
    price_desc: [desc(listings.priceCents)],
    popular: [desc(listings.views)],
  }[q.sort];

  const base = db.select({ l: listings }).from(listings).innerJoin(galleries, eq(galleries.id, listings.galleryId));
  const total = db.select({ n: count() }).from(listings).innerJoin(galleries, eq(galleries.id, listings.galleryId)).where(where).get()?.n ?? 0;
  const rows = base
    .where(where)
    .orderBy(...order)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .all()
    .map((r) => r.l);

  // Facets are computed over the whole public catalogue (scoped to the category when set) so filters don't disappear.
  const facetScope = and(publicListing(), categoryCond);
  const mediums = db
    .select({ value: listings.medium, n: count() })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(facetScope)
    .groupBy(listings.medium)
    .orderBy(asc(listings.medium))
    .all();
  const gals = db
    .select({ value: galleries.slug, label: galleries.name, n: count() })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(facetScope)
    .groupBy(galleries.id)
    .orderBy(asc(galleries.name))
    .all();
  const bounds = db
    .select({ min: sql<number>`min(${listings.priceCents})`, max: sql<number>`max(${listings.priceCents})` })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(publicListing())
    .get();

  res.json({
    listings: hydrateListings(rows),
    total,
    page: q.page,
    pageSize: q.pageSize,
    facets: { mediums, galleries: gals, price: { min: bounds?.min ?? 0, max: bounds?.max ?? 0 } },
  });
});

/** Autocomplete across works, artists, galleries and categories. */
catalogRouter.get('/search/suggest', (req, res) => {
  const q = z.string().trim().min(1).max(60).safeParse(req.query.q);
  if (!q.success) return void res.json({ results: [] });
  const term = `%${q.data}%`;
  const works = db
    .select({ l: listings })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(and(publicListing(), or(like(listings.title, term), like(listings.artist, term))))
    .orderBy(desc(listings.views))
    .limit(6)
    .all()
    .map((r) => r.l);
  const artists = db
    .selectDistinct({ artist: listings.artist })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(and(publicListing(), like(listings.artist, term)))
    .limit(4)
    .all();
  const gals = db
    .select({ name: galleries.name, slug: galleries.slug })
    .from(galleries)
    .where(and(eq(galleries.status, 'approved'), like(galleries.name, term)))
    .limit(3)
    .all();
  const cats = db
    .select({ name: categories.name, slug: categories.slug })
    .from(categories)
    .where(and(eq(categories.status, 'approved'), like(categories.name, term)))
    .limit(3)
    .all();
  res.json({
    results: [
      ...hydrateListings(works).map((l) => ({
        type: 'listing' as const,
        label: l.title,
        sublabel: `${l.artist} · ${l.gallery?.name ?? ''}`,
        slug: l.slug,
        thumbUrl: l.cover?.thumbUrl ?? null,
        priceCents: l.priceCents,
      })),
      ...artists.map((a) => ({ type: 'artist' as const, label: a.artist, sublabel: 'Artist', slug: a.artist })),
      ...gals.map((g) => ({ type: 'gallery' as const, label: g.name, sublabel: 'Gallery', slug: g.slug })),
      ...cats.map((c) => ({ type: 'category' as const, label: c.name, sublabel: 'Category', slug: c.slug })),
    ],
  });
});

function categoryPath(categoryId: number) {
  const pathOut: { id: number; name: string; slug: string }[] = [];
  let id: number | null = categoryId;
  while (id != null) {
    const c = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!c) break;
    if (c.status === 'approved') pathOut.unshift({ id: c.id, name: c.name, slug: c.slug });
    id = c.parentId;
  }
  return pathOut;
}

catalogRouter.get('/listings/:slug', (req, res) => {
  const row = db
    .select({ l: listings, g: galleries })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(eq(listings.slug, req.params.slug))
    .get();
  if (!row) throw notFound('Listing not found');
  const isOwner = req.user && row.g.ownerId === req.user.id;
  const isStaff = can(req.user?.role, 'listing:moderate');
  const visible = row.g.status === 'approved' && ['active', 'reserved', 'sold'].includes(row.l.status);
  if (!visible && !isOwner && !isStaff) throw notFound('Listing not found');

  if (!isOwner) db.update(listings).set({ views: sql`${listings.views} + 1` }).where(eq(listings.id, row.l.id)).run();

  const qa = db
    .select({ id: questions.id, body: questions.body, answer: questions.answer, answeredAt: questions.answeredAt, createdAt: questions.createdAt, asker: users.name })
    .from(questions)
    .innerJoin(users, eq(users.id, questions.askerId))
    .where(eq(questions.listingId, row.l.id))
    .orderBy(desc(questions.createdAt))
    .all()
    .map((x) => ({ ...x, asker: x.asker.split(' ')[0] }));
  const rating = db.select({ avg: avg(reviews.rating), n: count() }).from(reviews).where(eq(reviews.galleryId, row.g.id)).get();
  const related = db
    .select({ l: listings })
    .from(listings)
    .innerJoin(galleries, eq(galleries.id, listings.galleryId))
    .where(and(publicListing(), eq(listings.categoryId, row.l.categoryId), sql`${listings.id} != ${row.l.id}`))
    .limit(4)
    .all()
    .map((r) => r.l);

  res.json({
    listing: {
      ...hydrateListing(row.l),
      media: mediaFor(row.l.id),
      categoryPath: categoryPath(row.l.categoryId),
      gallery: {
        id: row.g.id,
        name: row.g.name,
        slug: row.g.slug,
        tagline: row.g.tagline,
        location: row.g.location,
        rating: rating?.avg ? Number(rating.avg) : null,
        reviewCount: rating?.n ?? 0,
      },
      isOwner: !!isOwner,
    },
    questions: qa,
    related: hydrateListings(related),
  });
});

catalogRouter.get('/listings/:id/shipping', (req, res) => {
  const country = z.string().trim().length(2).parse(req.query.country);
  const listing = db.select().from(listings).where(eq(listings.id, Number(req.params.id))).get();
  if (!listing) throw notFound('Listing not found');
  const s = shippingFor(listing, country);
  res.json({ region: s.region, shippingCents: s.cents, totalCents: listing.priceCents + s.cents, currency: listing.currency });
});

catalogRouter.post('/listings/:id/questions', requirePermission('question:ask'), (req, res) => {
  const body = z.object({ body: z.string().trim().min(5).max(1000) }).parse(req.body);
  const listing = db.select({ id: listings.id }).from(listings).where(eq(listings.id, Number(req.params.id))).get();
  if (!listing) throw notFound('Listing not found');
  const user = currentUser(req);
  const created = db.insert(questions).values({ listingId: listing.id, askerId: user.id, body: body.body }).returning().get();
  audit(req, 'question.ask', 'listing', listing.id, { questionId: created.id });
  res.status(201).json({ question: { ...created, asker: user.name.split(' ')[0] } });
});
