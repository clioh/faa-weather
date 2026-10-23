/**
 * Photo Frame API Routes (data/photos/)
 * Every change broadcasts WS { type: 'photos', data: { count } }.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { MAX_PHOTO_BYTES, PhotoLimitError, PhotoStore } from '../services/photos.js';
import { isSafeId } from '../validation/safe-id.js';
import { broadcast } from '../server.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const store = new PhotoStore(path.join(DATA_DIR, 'photos'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

function notify(): void {
  broadcast('photos', { count: store.count() });
}

/** Run multer and turn its errors into JSON responses. */
function receivePhoto(req: Request, res: Response, next: NextFunction): void {
  upload.single('photo')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Photo must be 10 MB or smaller' });
      } else {
        res.status(400).json({ error: `Upload rejected (${err.code})` });
      }
      return;
    }
    console.error('Photo upload error:', err);
    res.status(400).json({ error: 'Upload failed' });
  });
}

router.get('/', (_req, res) => {
  res.json({ photos: store.list() });
});

router.post('/', uploadLimiter, receivePhoto, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded (field "photo")' });
  try {
    const photo = store.save(req.file.buffer);
    if (!photo)
      return res.status(415).json({ error: 'Only JPEG, PNG and WebP images are supported' });
    notify();
    res.status(201).json({ photo });
  } catch (error) {
    if (error instanceof PhotoLimitError) return res.status(400).json({ error: error.message });
    console.error('Photo save error:', error);
    res.status(500).json({ error: 'Failed to save photo' });
  }
});

router.get('/:id/file', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const found = store.find(req.params.id);
  if (!found) return res.status(404).json({ error: 'Photo not found' });
  res.type(found.mime);
  res.sendFile(found.file, { maxAge: 24 * 60 * 60 * 1000, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Photo not found' });
  });
});

router.delete('/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    if (!store.remove(req.params.id)) return res.status(404).json({ error: 'Photo not found' });
    notify();
    res.json({ success: true });
  } catch (error) {
    console.error('Photo delete error:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

export default router;
