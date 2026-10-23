/**
 * Photo frame storage (data/photos/).
 * Files are stored as `<id>.<ext>`; metadata comes from the filesystem.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { isSafeId, resolveSafePath } from '../validation/safe-id.js';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS = 500;

export type PhotoType = 'jpeg' | 'png' | 'webp';

export const PHOTO_TYPES: Record<PhotoType, { ext: string; mime: string }> = {
  jpeg: { ext: '.jpg', mime: 'image/jpeg' },
  png: { ext: '.png', mime: 'image/png' },
  webp: { ext: '.webp', mime: 'image/webp' },
};

const EXT_TO_TYPE: Record<string, PhotoType> = { '.jpg': 'jpeg', '.png': 'png', '.webp': 'webp' };

/** Identify an image by its magic bytes (the client-supplied MIME type is not trusted). */
export function detectImageType(buf: Buffer): PhotoType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export interface PhotoMeta {
  id: string;
  url: string;
  uploadedAt: string;
  size: number;
}

export class PhotoLimitError extends Error {
  constructor() {
    super(`Photo frame is limited to ${MAX_PHOTOS} photos`);
    this.name = 'PhotoLimitError';
  }
}

export class PhotoStore {
  constructor(private readonly dir: string) {}

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list(): PhotoMeta[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const photos: PhotoMeta[] = [];
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      const id = name.slice(0, -ext.length);
      if (!EXT_TO_TYPE[ext] || !isSafeId(id)) continue;
      try {
        const stat = fs.statSync(path.join(this.dir, name));
        if (!stat.isFile()) continue;
        photos.push({
          id,
          url: `/api/photos/${id}/file`,
          uploadedAt: stat.mtime.toISOString(),
          size: stat.size,
        });
      } catch {
        // ignore files removed mid-listing
      }
    }
    return photos.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }

  count(): number {
    return this.list().length;
  }

  /** Returns null when the bytes are not a supported image. */
  save(buf: Buffer): PhotoMeta | null {
    const type = detectImageType(buf);
    if (!type) return null;
    if (this.count() >= MAX_PHOTOS) throw new PhotoLimitError();
    this.ensureDir();
    const id = randomUUID();
    const file = resolveSafePath(this.dir, id, PHOTO_TYPES[type].ext);
    if (!file) return null;
    fs.writeFileSync(file, buf, { flag: 'wx' });
    const stat = fs.statSync(file);
    return {
      id,
      url: `/api/photos/${id}/file`,
      uploadedAt: stat.mtime.toISOString(),
      size: stat.size,
    };
  }

  /** Locate a stored photo by id; null for unknown or unsafe ids. */
  find(id: unknown): { file: string; mime: string } | null {
    if (!isSafeId(id)) return null;
    for (const [ext, type] of Object.entries(EXT_TO_TYPE)) {
      const file = resolveSafePath(this.dir, id, ext);
      if (file && fs.existsSync(file)) return { file, mime: PHOTO_TYPES[type].mime };
    }
    return null;
  }

  remove(id: unknown): boolean {
    const found = this.find(id);
    if (!found) return false;
    fs.unlinkSync(found.file);
    return true;
  }
}
