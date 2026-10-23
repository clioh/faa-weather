/**
 * Low-level HTTP helpers for the in-app updater.
 *
 * Every byte the updater fetches goes through here, so the rules live in one place:
 * - only https URLs (plain http is allowed for loopback hosts only, which is what the
 *   tests use; GitHub never redirects there);
 * - at most MAX_REDIRECTS redirects, each re-checked against the rule above;
 * - a connect/headers timeout and a stall timeout (no bytes for N ms) on the body;
 * - a body that ends early (connection drop, fewer bytes than Content-Length or than
 *   the size the caller expects) is an error, never a "finished" download.
 *
 * Errors are always rejections of the returned promise; nothing throws from inside
 * a socket callback.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import { createHash } from 'crypto';

export const MAX_REDIRECTS = 5;
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
export const DEFAULT_STALL_TIMEOUT_MS = 60_000;

export const STALL_MESSAGE = 'Download stalled; check the internet connection and try again';
export const CONNECT_TIMEOUT_MESSAGE =
  'Could not reach the update server; check the internet connection and try again';
export const TRUNCATED_MESSAGE = 'Download was interrupted before it finished; try again';

const USER_AGENT = 'SkyGlass-Updater';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'stalled'
      | 'connect-timeout'
      | 'truncated'
      | 'size-mismatch'
      | 'too-large'
      | 'http-status'
      | 'redirect'
      | 'bad-url'
      | 'network'
      | 'io'
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  connectTimeoutMs?: number;
  stallTimeoutMs?: number;
  maxRedirects?: number;
}

export interface DownloadOptions extends RequestOptions {
  /** Expected body size from another source (e.g. the GitHub asset size); 0/undefined = unknown. */
  expectedSize?: number;
  /** Called on every chunk with the running byte count and the best known total. */
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void;
}

export interface DownloadResult {
  bytes: number;
  sha256: string;
}

/** Throws unless `raw` is https, or http to a loopback host. */
export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DownloadError(`Invalid download URL: ${raw}`, 'bad-url');
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new DownloadError(`Refusing non-https download URL: ${url.origin}`, 'bad-url');
}

/**
 * Issue a GET and follow redirects. Resolves with the final 200 response (body not yet
 * consumed); any other status, too many redirects, a disallowed redirect target or no
 * response headers within connectTimeoutMs rejects.
 */
function getFollowingRedirects(
  rawUrl: string,
  opts: RequestOptions
): Promise<{ res: http.IncomingMessage; url: string }> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const headers = { 'User-Agent': USER_AGENT, ...opts.headers };

  const attempt = (current: string, redirectsLeft: number) =>
    new Promise<{ res: http.IncomingMessage; url: string }>((resolve, reject) => {
      let url: URL;
      try {
        url = assertAllowedUrl(current);
      } catch (err) {
        reject(err);
        return;
      }
      const mod = url.protocol === 'https:' ? https : http;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      // agent: false = a fresh connection per request; a pooled keep-alive socket the
      // server already dropped would otherwise fail the next request.
      const req = mod.get(url, { headers, agent: false });
      const timer = setTimeout(() => {
        settle(() => reject(new DownloadError(CONNECT_TIMEOUT_MESSAGE, 'connect-timeout')));
        req.destroy();
      }, connectTimeoutMs);

      req.on('error', (err) =>
        settle(() => reject(new DownloadError(`Network error: ${err.message}`, 'network')))
      );
      req.on('response', (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume(); // discard the redirect body
          const location = res.headers.location;
          if (!location) {
            settle(() => reject(new DownloadError('Redirect without location header', 'redirect')));
            return;
          }
          if (redirectsLeft <= 0) {
            settle(() => reject(new DownloadError('Too many redirects', 'redirect')));
            return;
          }
          let next: string;
          try {
            next = new URL(location, url).toString();
          } catch {
            settle(() => reject(new DownloadError('Invalid redirect location', 'redirect')));
            return;
          }
          settle(() => attempt(next, redirectsLeft - 1).then(resolve, reject));
          return;
        }
        if (status !== 200) {
          res.resume();
          settle(() =>
            reject(new DownloadError(`Download failed with status ${status}`, 'http-status'))
          );
          return;
        }
        settle(() => resolve({ res, url: url.toString() }));
      });
    });

  return attempt(rawUrl, maxRedirects);
}

/**
 * Consume a response body chunk by chunk with stall and completeness checks.
 * `sink` receives every chunk (may return false for backpressure, in which case
 * `drain` must eventually be signalled by calling the provided resume callback).
 */
function consumeBody(
  res: http.IncomingMessage,
  opts: {
    stallTimeoutMs: number;
    expectedSize?: number;
    maxBytes?: number;
    onChunk: (chunk: Buffer, pause: () => () => void) => void;
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const declared = res.headers['content-length'];
    const contentLength =
      declared !== undefined && /^\d+$/.test(declared) ? parseInt(declared, 10) : undefined;
    const expectedSize = opts.expectedSize && opts.expectedSize > 0 ? opts.expectedSize : undefined;

    if (
      contentLength !== undefined &&
      expectedSize !== undefined &&
      contentLength !== expectedSize
    ) {
      res.destroy();
      reject(
        new DownloadError(
          `Server reported ${contentLength} bytes but the release lists ${expectedSize}`,
          'size-mismatch'
        )
      );
      return;
    }
    if (
      opts.maxBytes !== undefined &&
      contentLength !== undefined &&
      contentLength > opts.maxBytes
    ) {
      res.destroy();
      reject(new DownloadError('Response is too large', 'too-large'));
      return;
    }

    let bytes = 0;
    let done = false;
    let stallTimer: NodeJS.Timeout | undefined;

    if (res.destroyed && !res.readableEnded) {
      // The connection already went away before we started reading.
      reject(new DownloadError(TRUNCATED_MESSAGE, 'truncated'));
      return;
    }

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(stallTimer);
      if (err) {
        res.destroy();
        reject(err);
      } else {
        resolve(bytes);
      }
    };
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(
        () => finish(new DownloadError(STALL_MESSAGE, 'stalled')),
        opts.stallTimeoutMs
      );
    };
    armStall();

    const pause = () => {
      // Waiting on the disk is not a network stall.
      clearTimeout(stallTimer);
      res.pause();
      return () => {
        if (done) return;
        armStall();
        res.resume();
      };
    };

    res.on('data', (chunk: Buffer) => {
      if (done) return;
      bytes += chunk.length;
      armStall();
      const limit = contentLength ?? expectedSize ?? opts.maxBytes;
      if (limit !== undefined && bytes > limit) {
        finish(new DownloadError('Server sent more data than expected', 'size-mismatch'));
        return;
      }
      try {
        opts.onChunk(chunk, pause);
      } catch (err) {
        finish(err instanceof Error ? err : new DownloadError(String(err), 'io'));
      }
    });
    res.on('aborted', () => finish(new DownloadError(TRUNCATED_MESSAGE, 'truncated')));
    res.on('error', () => finish(new DownloadError(TRUNCATED_MESSAGE, 'truncated')));
    res.on('close', () => finish(new DownloadError(TRUNCATED_MESSAGE, 'truncated')));
    res.on('end', () => {
      if (!res.complete) {
        finish(new DownloadError(TRUNCATED_MESSAGE, 'truncated'));
      } else if (contentLength !== undefined && bytes !== contentLength) {
        finish(new DownloadError(TRUNCATED_MESSAGE, 'truncated'));
      } else if (expectedSize !== undefined && bytes !== expectedSize) {
        finish(
          new DownloadError(
            `Downloaded ${bytes} bytes but the release lists ${expectedSize}`,
            'size-mismatch'
          )
        );
      } else {
        finish();
      }
    });
  });
}

/** GET a small text resource (API JSON, checksum file) with the same safety rules. */
export async function fetchText(
  url: string,
  opts: RequestOptions & { maxBytes?: number } = {}
): Promise<string> {
  const { res } = await getFollowingRedirects(url, opts);
  const chunks: Buffer[] = [];
  await consumeBody(res, {
    stallTimeoutMs: opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? 10 * 1024 * 1024,
    onChunk: (chunk) => chunks.push(chunk),
  });
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Download `url` to `destPath` (created/truncated), hashing as it goes. Resolves only
 * when the whole body arrived (Content-Length and expectedSize both honoured) and the
 * file has been flushed to disk. On rejection the caller owns deleting `destPath`.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  opts: DownloadOptions = {}
): Promise<DownloadResult> {
  // Open the file before requesting: no await may sit between receiving the response
  // and attaching body listeners, or an early disconnect ('aborted'/'close') is missed.
  const fh = await fs.promises.open(destPath, 'w');
  let res: http.IncomingMessage;
  try {
    ({ res } = await getFollowingRedirects(url, opts));
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
  const declared = res.headers['content-length'];
  const total =
    opts.expectedSize && opts.expectedSize > 0
      ? opts.expectedSize
      : declared && /^\d+$/.test(declared)
        ? parseInt(declared, 10)
        : 0;

  const out = fh.createWriteStream({ autoClose: false });
  const hash = createHash('sha256');
  let writeError: Error | null = null;
  out.on('error', (err) => {
    writeError = err;
    res.destroy(err);
  });

  let bytes = 0;
  try {
    await consumeBody(res, {
      stallTimeoutMs: opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
      expectedSize: opts.expectedSize,
      onChunk: (chunk, pause) => {
        if (writeError) throw new DownloadError(`Write failed: ${writeError.message}`, 'io');
        bytes += chunk.length;
        hash.update(chunk);
        if (!out.write(chunk)) {
          const resume = pause();
          out.once('drain', resume);
        }
        opts.onProgress?.(bytes, total);
      },
    });
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject);
      out.end(() => resolve());
    });
    if (writeError) throw new DownloadError(`Write failed: ${(writeError as Error).message}`, 'io');
    // Flush to disk before the caller renames, so a power cut cannot leave a
    // renamed-but-empty file.
    await fh.sync();
  } finally {
    out.destroy();
    await fh.close().catch(() => {});
  }
  return { bytes, sha256: hash.digest('hex') };
}

/** Stream-hash a file (tarballs are ~50 MB; fine to do on each check). */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Parse a sha256sum-format file ("<64 hex>  <filename>" or "<64 hex> *<filename>",
 * or just the digest). If a filename is present it must match `expectedName`.
 * Returns the lowercase digest or null when unparseable.
 */
export function parseChecksum(text: string, expectedName?: string): string | null {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '');
  if (!line) return null;
  const m = /^\s*([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$/.exec(line);
  if (!m) return null;
  const name = m[2];
  if (name && expectedName && name.replace(/^.*\//, '') !== expectedName) return null;
  return m[1].toLowerCase();
}
