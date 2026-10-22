/**
 * News Service
 * Fetches RSS 2.0 / Atom feeds (curated presets or a user-supplied URL),
 * normalizes them to a small headline list, and caches per feed URL.
 */

import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { TtlCache, UpstreamError } from './upstream.js';
import { assertPublicUrl, safeFetchText } from './ssrf.js';

export const NEWS_SOURCES = ['world', 'us', 'business', 'technology', 'sports', 'aviation', 'custom'] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];
export type PresetSource = Exclude<NewsSource, 'custom'>;

export interface NewsPreset {
  url: string;
  publisher: string;
}

/** Curated, stable public feeds. Verified reachable October 2026. */
export const NEWS_PRESETS: Record<PresetSource, NewsPreset> = {
  world: { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', publisher: 'BBC News' },
  us: { url: 'https://feeds.npr.org/1003/rss.xml', publisher: 'NPR' },
  business: { url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', publisher: 'CNBC' },
  technology: { url: 'https://feeds.arstechnica.com/arstechnica/index', publisher: 'Ars Technica' },
  sports: { url: 'https://www.espn.com/espn/rss/news', publisher: 'ESPN' },
  aviation: { url: 'https://avweb.com/feed/', publisher: 'AVweb' },
};

export const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;
export const NEWS_MAX_LIMIT = 30;
export const SUMMARY_MAX_CHARS = 200;

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  summary?: string;
}

export interface ParsedFeed {
  title: string | null;
  items: NewsItem[];
}

// ============= Text helpers =============

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä',
  deg: '°', euro: '€', pound: '£', yen: '¥', times: '×', laquo: '«', raquo: '»',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Remove tags (and script/style bodies), decode entities, collapse whitespace. */
export function htmlToText(input: string): string {
  // Feeds often entity-encode their HTML, so decode first, strip, then decode again.
  let text = decodeEntities(input);
  text = text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ');
  text = decodeEntities(text);
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max = SUMMARY_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function itemId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ============= Parsing =============

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false, // decoded by htmlToText/decodeEntities
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'link'].includes(name),
});

type XmlNode = unknown;

/** Text content of a parsed node (string, {#text}, or array of those). */
function textOf(node: XmlNode): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    if (t !== undefined) return textOf(t);
  }
  return null;
}

function attr(node: XmlNode, name: string): string | null {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function first(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = textOf(obj[key]);
    if (v && v.trim()) return v;
  }
  return null;
}

function rssLink(item: Record<string, unknown>): string | null {
  const links = item.link as XmlNode[] | undefined;
  if (Array.isArray(links)) {
    for (const l of links) {
      const t = textOf(l);
      if (t && t.trim()) return t.trim();
      const href = attr(l, 'href'); // atom:link inside RSS
      if (href) return href;
    }
  }
  const guid = item.guid;
  const permalink = attr(guid, 'isPermaLink');
  const guidText = textOf(guid);
  if (guidText && permalink !== 'false' && /^https?:\/\//i.test(guidText)) return guidText.trim();
  return null;
}

function atomLink(entry: Record<string, unknown>): string | null {
  const links = entry.link as XmlNode[] | undefined;
  if (!Array.isArray(links)) return null;
  let fallback: string | null = null;
  for (const l of links) {
    const href = attr(l, 'href') ?? textOf(l);
    if (!href) continue;
    const rel = attr(l, 'rel');
    if (!rel || rel === 'alternate') return href.trim();
    fallback ??= href.trim();
  }
  return fallback;
}

function buildItem(
  title: string | null,
  link: string | null,
  idKey: string | null,
  published: string | null,
  summaryRaw: string | null,
  publisher: string,
): NewsItem | null {
  const cleanTitle = title ? htmlToText(title) : '';
  if (!cleanTitle) return null;
  const cleanLink = link ? decodeEntities(link).trim() : '';
  if (cleanLink && !/^https?:\/\//i.test(cleanLink)) return null;
  const item: NewsItem = {
    id: itemId(cleanLink || idKey || cleanTitle),
    title: cleanTitle,
    link: cleanLink,
    publisher,
    publishedAt: toIso(published),
  };
  const summary = summaryRaw ? truncate(htmlToText(summaryRaw)) : '';
  if (summary) item.summary = summary;
  return item;
}

/**
 * Parse an RSS 2.0, RSS 1.0 (RDF) or Atom document.
 * `publisherOverride` replaces the feed's own title as the item publisher.
 */
export function parseFeed(xml: string, publisherOverride?: string): ParsedFeed {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new UpstreamError('Feed is not valid XML');
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;

  if (rss || rdf) {
    const root = (rss ?? rdf)!;
    const channel = (root.channel ?? {}) as Record<string, unknown>;
    const feedTitle = textOf(channel.title);
    const publisher = publisherOverride ?? (feedTitle ? htmlToText(feedTitle) : 'News');
    const rawItems = ((channel.item ?? root.item ?? []) as Record<string, unknown>[]).filter(
      (i) => i && typeof i === 'object',
    );
    const items = rawItems
      .map((i) =>
        buildItem(
          textOf(i.title),
          rssLink(i),
          textOf(i.guid),
          first(i, ['pubDate', 'dc:date', 'published', 'updated']),
          first(i, ['description', 'content:encoded', 'summary']),
          publisher,
        ),
      )
      .filter((i): i is NewsItem => i !== null);
    return { title: feedTitle ? htmlToText(feedTitle) : null, items };
  }

  if (feed) {
    const feedTitle = textOf(feed.title);
    const publisher = publisherOverride ?? (feedTitle ? htmlToText(feedTitle) : 'News');
    const entries = ((feed.entry ?? []) as Record<string, unknown>[]).filter((e) => e && typeof e === 'object');
    const items = entries
      .map((e) =>
        buildItem(
          textOf(e.title),
          atomLink(e),
          textOf(e.id),
          first(e, ['published', 'updated']),
          first(e, ['summary', 'content']),
          publisher,
        ),
      )
      .filter((i): i is NewsItem => i !== null);
    return { title: feedTitle ? htmlToText(feedTitle) : null, items };
  }

  throw new UpstreamError('Not an RSS or Atom feed');
}

// ============= Fetching =============

const feedCache = new TtlCache<ParsedFeed>(NEWS_CACHE_TTL_MS);

export interface NewsResult {
  source: NewsSource;
  items: NewsItem[];
  fetchedAt: string;
  stale: boolean;
}

/**
 * Get headlines for a preset or a custom URL. Custom URLs go through the
 * SSRF guard (throws UnsafeUrlError). Presets use the same fetcher; their
 * hosts are public so the guard is a no-op for them.
 */
export async function getNews(source: NewsSource, customUrl: string | undefined, limit: number): Promise<NewsResult> {
  const preset = source === 'custom' ? null : NEWS_PRESETS[source];
  const url = preset ? preset.url : customUrl;
  if (!url) throw new UpstreamError('A feed URL is required for custom news', 400);
  // Validate up front so a rejected URL surfaces as UnsafeUrlError (400), not
  // a generic upstream failure. Every fetch/redirect hop is re-checked too.
  if (!preset) await assertPublicUrl(url);

  const result = await feedCache.get(url, async () => {
    const xml = await safeFetchText(url, {
      timeoutMs: 5000,
      maxBytes: 2 * 1024 * 1024,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    });
    return parseFeed(xml, preset?.publisher);
  });

  const items = [...result.value.items];
  // Newest first when dates are present; undated items keep feed order at the end.
  items.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return b.publishedAt.localeCompare(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  });

  // De-duplicate by id (feeds sometimes repeat items)
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));

  return {
    source,
    items: unique.slice(0, Math.min(Math.max(limit, 1), NEWS_MAX_LIMIT)),
    fetchedAt: new Date(result.storedAt).toISOString(),
    stale: result.stale,
  };
}
