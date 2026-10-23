/**
 * Request helpers shared by the Vercel functions.
 * Lives under api/_lib/ so Vercel does not deploy it as a function.
 */

import type { IncomingMessage } from 'node:http'

/**
 * The JSON body as a plain object, or null when it is missing, malformed or
 * not an object.
 *
 * @vercel/node defines `req.body` as a lazy getter that parses JSON on first
 * access and throws (an error that is not ours) on malformed JSON, which
 * would otherwise surface as a 500. Callers map null to a 400.
 */
export function readJsonObject(req: { body?: unknown }): Record<string, unknown> | null {
  let body: unknown
  try {
    body = req.body
  } catch {
    return null
  }
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) return null
  return body as Record<string, unknown>
}

const MAX_RAW_BODY_BYTES = 1_000_000
const RAW_BODY_TIMEOUT_MS = 10_000

/**
 * The exact request body bytes, for signature verification (Stripe webhooks).
 *
 * Never touches `req.body`. @vercel/node's helpers buffer the body before the
 * handler runs and replay it only through a patched `req.on('data' | 'end')`
 * (its `restoreBody`); `for await (const chunk of req)` does not see the
 * replay, and reading `req.body` parses it. Listening for 'data'/'end' works
 * both with the helpers on and on a plain, unread IncomingMessage.
 */
export function readRawBody(
  req: Pick<IncomingMessage, 'on'>,
  { maxBytes = MAX_RAW_BODY_BYTES, timeoutMs = RAW_BODY_TIMEOUT_MS } = {}
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (err: Error | null, body?: Buffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(body!)
    }
    const timer = setTimeout(
      () => settle(new Error('Timed out reading the request body')),
      timeoutMs
    )
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      size += buf.length
      if (size > maxBytes) return settle(new Error('Request body too large'))
      chunks.push(buf)
    })
    req.on('end', () => settle(null, Buffer.concat(chunks)))
    req.on('error', (err: Error) => settle(err))
  })
}

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}
