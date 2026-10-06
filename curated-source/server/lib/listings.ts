import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, galleries, listingMedia, listings } from '../db/schema';

export type ListingRow = typeof listings.$inferSelect;

/** Attaches primary media, gallery and category summaries to a set of listing rows (3 queries total). */
export function hydrateListings(rows: ListingRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const media = db
    .select()
    .from(listingMedia)
    .where(inArray(listingMedia.listingId, ids))
    .orderBy(asc(listingMedia.position))
    .all();
  const gals = db
    .select({ id: galleries.id, name: galleries.name, slug: galleries.slug, location: galleries.location })
    .from(galleries)
    .where(inArray(galleries.id, [...new Set(rows.map((r) => r.galleryId))]))
    .all();
  const cats = db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.id, [...new Set(rows.map((r) => r.categoryId))]))
    .all();
  return rows.map((r) => {
    const cover = media.find((m) => m.listingId === r.id);
    return {
      ...r,
      cover: cover
        ? { kind: cover.kind, url: cover.url, thumbUrl: cover.thumbUrl, width: cover.width, height: cover.height }
        : null,
      gallery: gals.find((g) => g.id === r.galleryId) ?? null,
      category: cats.find((c) => c.id === r.categoryId) ?? null,
    };
  });
}

export function hydrateListing(row: ListingRow) {
  return hydrateListings([row])[0];
}

/** Returns the id of a category plus all of its descendants. */
export function categoryWithDescendants(rootId: number) {
  const all = db.select({ id: categories.id, parentId: categories.parentId }).from(categories).all();
  const out = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parentId != null && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return [...out];
}

export function mediaFor(listingId: number) {
  return db.select().from(listingMedia).where(eq(listingMedia.listingId, listingId)).orderBy(asc(listingMedia.position)).all();
}
