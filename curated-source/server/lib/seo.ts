import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { galleries, listingMedia, listings } from '../db/schema';

type Meta = { title: string; description: string; image?: string | null; url: string; type: 'website' | 'product' };

const SITE_NAME = 'Curated Art';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

let shell: { html: string; mtime: number } | null = null;
function indexHtml() {
  const file = path.join(config.distDir, 'index.html');
  const mtime = fs.statSync(file).mtimeMs;
  if (!shell || shell.mtime !== mtime) shell = { html: fs.readFileSync(file, 'utf8'), mtime };
  return shell.html;
}

/** Link-preview details for a shared listing or gallery URL; null for every other page. */
function metaFor(pathname: string, origin: string): Meta | null {
  const abs = (u: string | null | undefined) => (u ? (u.startsWith('http') ? u : origin + u) : null);
  const listingMatch = pathname.match(/^\/listing\/([^/]+)\/?$/);
  if (listingMatch) {
    const row = db
      .select({ l: listings, galleryName: galleries.name })
      .from(listings)
      .innerJoin(galleries, eq(galleries.id, listings.galleryId))
      .where(
        and(
          eq(listings.slug, decodeURIComponent(listingMatch[1])),
          eq(galleries.status, 'approved'),
          inArray(listings.status, ['active', 'reserved', 'sold']),
        ),
      )
      .get();
    if (!row) return null;
    const cover = db
      .select({ url: listingMedia.url })
      .from(listingMedia)
      .where(and(eq(listingMedia.listingId, row.l.id), eq(listingMedia.kind, 'image')))
      .orderBy(asc(listingMedia.position))
      .get();
    const l = row.l;
    return {
      title: `${l.title} by ${l.artist} — ${SITE_NAME}`,
      description: `${l.medium}${l.year ? `, ${l.year}` : ''} · ${usd(l.priceCents)} · Offered by ${row.galleryName}. Payment protected until delivery.`,
      image: abs(cover?.url),
      url: origin + pathname,
      type: 'product',
    };
  }
  const galleryMatch = pathname.match(/^\/galleries\/([^/]+)\/?$/);
  if (galleryMatch) {
    const g = db
      .select()
      .from(galleries)
      .where(and(eq(galleries.slug, decodeURIComponent(galleryMatch[1])), eq(galleries.status, 'approved')))
      .get();
    if (!g) return null;
    return {
      title: `${g.name} — ${SITE_NAME}`,
      description: g.tagline || `${g.name}${g.location ? `, ${g.location}` : ''} on ${SITE_NAME}.`,
      image: abs(g.coverUrl),
      url: origin + pathname,
      type: 'website',
    };
  }
  return null;
}

/**
 * Serves the SPA shell, with Open Graph / Twitter tags filled in for listing and gallery pages so
 * links shared on WhatsApp, Facebook, X or iMessage preview the artwork rather than the home page.
 */
export function renderShell(req: Request) {
  const html = indexHtml();
  let meta: Meta | null = null;
  try {
    meta = metaFor(req.path, `${req.protocol}://${req.get('host')}`);
  } catch (err) {
    console.error('Failed to build link preview', err);
  }
  if (!meta) return html;
  const tags = [
    ['og:site_name', SITE_NAME],
    ['og:type', meta.type],
    ['og:title', meta.title],
    ['og:description', meta.description],
    ['og:url', meta.url],
    ...(meta.image ? [['og:image', meta.image]] : []),
  ]
    .map(([p, c]) => `<meta property="${p}" content="${escapeHtml(c)}" />`)
    .concat(
      `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
      `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    )
    .join('\n    ');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(meta.description)}" />`)
    .replace('</head>', `    ${tags}\n  </head>`);
}
