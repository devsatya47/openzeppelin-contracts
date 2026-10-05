import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};

export const ROLES = ['buyer', 'seller', 'subadmin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ROLES }).notNull().default('buyer'),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  country: text('country').notNull().default('US'),
  ...timestamps,
});

export const GALLERY_STATUS = ['pending', 'approved', 'rejected', 'suspended'] as const;

export const galleries = sqliteTable(
  'galleries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('owner_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    tagline: text('tagline').notNull().default(''),
    bio: text('bio').notNull().default(''),
    location: text('location').notNull().default(''),
    country: text('country').notNull().default('US'),
    coverUrl: text('cover_url'),
    status: text('status', { enum: GALLERY_STATUS }).notNull().default('pending'),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    reviewNote: text('review_note'),
    ...timestamps,
  },
  (t) => [uniqueIndex('galleries_owner_idx').on(t.ownerId)],
);

export const CATEGORY_STATUS = ['approved', 'pending', 'rejected'] as const;

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parentId: integer('parent_id').references((): AnySQLiteColumn => categories.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: CATEGORY_STATUS }).notNull().default('approved'),
    suggestedById: integer('suggested_by_id').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const LISTING_STATUS = ['draft', 'active', 'reserved', 'sold', 'archived'] as const;

export const listings = sqliteTable(
  'listings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    galleryId: integer('gallery_id').notNull().references(() => galleries.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    artist: text('artist').notNull(),
    year: integer('year'),
    medium: text('medium').notNull(),
    description: text('description').notNull().default(''),
    widthCm: real('width_cm'),
    heightCm: real('height_cm'),
    depthCm: real('depth_cm'),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    shippingDomesticCents: integer('shipping_domestic_cents').notNull().default(0),
    shippingInternationalCents: integer('shipping_international_cents').notNull().default(0),
    originCountry: text('origin_country').notNull().default('US'),
    provenance: text('provenance').notNull().default(''),
    edition: text('edition').notNull().default('Unique work'),
    certificateOfAuthenticity: integer('certificate_of_authenticity', { mode: 'boolean' }).notNull().default(true),
    status: text('status', { enum: LISTING_STATUS }).notNull().default('active'),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    views: integer('views').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('listings_gallery_idx').on(t.galleryId),
    index('listings_category_idx').on(t.categoryId),
    index('listings_status_idx').on(t.status),
  ],
);

export const listingMedia = sqliteTable(
  'listing_media',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['image', 'video'] }).notNull().default('image'),
    url: text('url').notNull(),
    thumbUrl: text('thumb_url').notNull(),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('listing_media_listing_idx').on(t.listingId)],
);

export const questions = sqliteTable(
  'questions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    askerId: integer('asker_id').notNull().references(() => users.id),
    body: text('body').notNull(),
    answer: text('answer'),
    answeredAt: text('answered_at'),
    ...timestamps,
  },
  (t) => [index('questions_listing_idx').on(t.listingId)],
);

export const ORDER_STATUS = [
  'pending',
  'in_escrow',
  'dispatched',
  'delivered',
  'released',
  'disputed',
  'refunded',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    reference: text('reference').notNull().unique(),
    buyerId: integer('buyer_id').notNull().references(() => users.id),
    listingId: integer('listing_id').notNull().references(() => listings.id),
    galleryId: integer('gallery_id').notNull().references(() => galleries.id),
    priceCents: integer('price_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    commissionCents: integer('commission_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    shippingRegion: text('shipping_region', { enum: ['domestic', 'international'] }).notNull(),
    shippingAddress: text('shipping_address', { mode: 'json' }).$type<ShippingAddress>().notNull(),
    status: text('status', { enum: ORDER_STATUS }).notNull().default('pending'),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    ...timestamps,
    updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    index('orders_buyer_idx').on(t.buyerId),
    index('orders_gallery_idx').on(t.galleryId),
    index('orders_status_idx').on(t.status),
  ],
);

export type ShippingAddress = {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
};

export const orderEvents = sqliteTable(
  'order_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ORDER_STATUS }).notNull(),
    note: text('note'),
    actorId: integer('actor_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

export const escrowTransactions = sqliteTable(
  'escrow_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id').notNull().references(() => orders.id),
    type: text('type', { enum: ['hold', 'release', 'refund', 'commission'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    reference: text('reference').notNull(),
    ...timestamps,
  },
  (t) => [index('escrow_order_idx').on(t.orderId)],
);

export const disputes = sqliteTable(
  'disputes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id').notNull().references(() => orders.id),
    openedById: integer('opened_by_id').notNull().references(() => users.id),
    reason: text('reason').notNull(),
    previousStatus: text('previous_status', { enum: ORDER_STATUS }).notNull(),
    status: text('status', { enum: ['open', 'resolved_release', 'resolved_refund'] }).notNull().default('open'),
    resolution: text('resolution'),
    resolvedById: integer('resolved_by_id').references(() => users.id),
    resolvedAt: text('resolved_at'),
    ...timestamps,
  },
  (t) => [index('disputes_order_idx').on(t.orderId)],
);

export const reviews = sqliteTable('reviews', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().unique().references(() => orders.id),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  galleryId: integer('gallery_id').notNull().references(() => galleries.id),
  buyerId: integer('buyer_id').notNull().references(() => users.id),
  rating: integer('rating').notNull(),
  body: text('body').notNull().default(''),
  ...timestamps,
});

export const PAYOUT_STATUS = ['requested', 'approved', 'paid', 'rejected'] as const;

export const payouts = sqliteTable(
  'payouts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    galleryId: integer('gallery_id').notNull().references(() => galleries.id),
    amountCents: integer('amount_cents').notNull(),
    method: text('method', { enum: ['bank_transfer', 'wire', 'paypal'] }).notNull(),
    destination: text('destination').notNull(),
    status: text('status', { enum: PAYOUT_STATUS }).notNull().default('requested'),
    note: text('note'),
    processedById: integer('processed_by_id').references(() => users.id),
    processedAt: text('processed_at'),
    ...timestamps,
  },
  (t) => [index('payouts_gallery_idx').on(t.galleryId)],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: integer('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: integer('entity_id'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    ip: text('ip'),
    ...timestamps,
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_created_idx').on(t.createdAt)],
);
