import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config';
import { badRequest } from './errors';

export type StoredMedia = {
  kind: 'image' | 'video';
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
};

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/tiff']);
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

export const FULL_MAX_EDGE = 2400;
export const THUMB_MAX_EDGE = 720;

async function ensureDir() {
  await fs.mkdir(config.uploadDir, { recursive: true });
}

/**
 * Stores an image as a web-optimised master (≤2400px) plus an automatically generated thumbnail (≤720px).
 * Orientation from EXIF is applied and metadata is stripped.
 */
export async function storeImage(buffer: Buffer): Promise<StoredMedia> {
  await ensureDir();
  const id = crypto.randomUUID();
  const base = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw badRequest('Unreadable image');

  const full = await base
    .clone()
    .resize({ width: FULL_MAX_EDGE, height: FULL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true, progressive: true })
    .toBuffer({ resolveWithObject: true });
  await fs.writeFile(path.join(config.uploadDir, `${id}.jpg`), full.data);

  const thumb = await base
    .clone()
    .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  await fs.writeFile(path.join(config.uploadDir, `${id}_thumb.webp`), thumb);

  return {
    kind: 'image',
    url: `/uploads/${id}.jpg`,
    thumbUrl: `/uploads/${id}_thumb.webp`,
    width: full.info.width,
    height: full.info.height,
  };
}

export async function storeVideo(buffer: Buffer, mimetype: string): Promise<StoredMedia> {
  await ensureDir();
  const ext = VIDEO_TYPES[mimetype];
  const id = crypto.randomUUID();
  await fs.writeFile(path.join(config.uploadDir, `${id}${ext}`), buffer);
  // Videos use their own URL as the "thumbnail"; the client renders a muted preview frame.
  return { kind: 'video', url: `/uploads/${id}${ext}`, thumbUrl: `/uploads/${id}${ext}`, width: null, height: null };
}

export async function storeMedia(file: { buffer: Buffer; mimetype: string }) {
  if (IMAGE_TYPES.has(file.mimetype)) return storeImage(file.buffer);
  if (file.mimetype in VIDEO_TYPES) return storeVideo(file.buffer, file.mimetype);
  throw badRequest(`Unsupported media type: ${file.mimetype}`);
}
