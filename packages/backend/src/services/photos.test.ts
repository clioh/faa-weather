import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PhotoStore, detectImageType } from './photos.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('detectImageType', () => {
  it('identifies jpeg, png and webp by magic bytes', () => {
    expect(detectImageType(JPEG)).toBe('jpeg');
    expect(detectImageType(PNG)).toBe('png');
    expect(detectImageType(WEBP)).toBe('webp');
  });

  it('rejects other content', () => {
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('PhotoStore', () => {
  let dir: string;
  let store: PhotoStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-photos-'));
    store = new PhotoStore(path.join(dir, 'photos'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('saves, lists, finds and removes photos', () => {
    expect(store.list()).toEqual([]);
    const a = store.save(JPEG)!;
    const b = store.save(PNG)!;
    expect(a.url).toBe(`/api/photos/${a.id}/file`);
    expect(a.size).toBe(JPEG.length);
    expect(
      store
        .list()
        .map((p) => p.id)
        .sort()
    ).toEqual([a.id, b.id].sort());
    expect(store.find(a.id)?.mime).toBe('image/jpeg');
    expect(store.find(b.id)?.mime).toBe('image/png');
    expect(store.remove(a.id)).toBe(true);
    expect(store.remove(a.id)).toBe(false);
    expect(store.count()).toBe(1);
  });

  it('refuses non-images', () => {
    expect(store.save(Buffer.from('#!/bin/sh\necho hi'))).toBeNull();
    expect(store.count()).toBe(0);
  });

  it('rejects path tricks in ids', () => {
    fs.writeFileSync(path.join(dir, 'secret.jpg'), JPEG);
    expect(store.find('../secret')).toBeNull();
    expect(store.find('..%2Fsecret')).toBeNull();
    expect(store.find('')).toBeNull();
    expect(store.remove('../secret')).toBe(false);
    expect(fs.existsSync(path.join(dir, 'secret.jpg'))).toBe(true);
  });

  it('ignores stray files in the photo directory', () => {
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'photos', 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'photos', 'bad name.jpg'), JPEG);
    expect(store.list()).toEqual([]);
  });
});
