import { describe, it, expect } from 'vitest';
import {
  parseFeed,
  htmlToText,
  decodeEntities,
  truncate,
  itemId,
  SUMMARY_MAX_CHARS,
} from './news.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title><![CDATA[BBC News - World]]></title>
  <link>https://www.bbc.co.uk/news/world</link>
  <item>
    <title><![CDATA[Storms &amp; floods hit coast]]></title>
    <description><![CDATA[<p>Heavy rain <b>caused</b> flooding&nbsp;in &#8220;several&#8221; towns.</p><img src="x.jpg"/>]]></description>
    <link>https://www.bbc.co.uk/news/world-1</link>
    <guid isPermaLink="false">world-1</guid>
    <pubDate>Wed, 14 Oct 2026 18:53:31 GMT</pubDate>
  </item>
  <item>
    <title>AT&amp;T &amp;amp; partners</title>
    <description>&lt;p&gt;Escaped &lt;a href="#"&gt;HTML&lt;/a&gt; summary &amp;mdash; done&lt;/p&gt;</description>
    <link>https://example.com/b?x=1&amp;y=2</link>
    <dc:date>2026-10-15T01:00:00Z</dc:date>
  </item>
  <item>
    <title>No date, guid link only</title>
    <guid>https://example.com/c</guid>
  </item>
  <item>
    <description>Item without a title is skipped</description>
    <link>https://example.com/d</link>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title type="text">The Verge</title>
  <link rel="self" type="application/atom+xml" href="https://www.theverge.com/rss/index.xml" />
  <entry>
    <author><name>Jay Peters</name></author>
    <title type="html"><![CDATA[McKinsey is making job applicants spar with a fake AI client]]></title>
    <link rel="alternate" type="text/html" href="https://www.theverge.com/news/1011654/mckinsey" />
    <id>https://www.theverge.com/?p=1011654</id>
    <updated>2026-10-14T18:53:31-04:00</updated>
    <published>2026-10-14T18:53:31-04:00</published>
    <summary type="html"><![CDATA[Consulting firm McKinsey &#38; Company is going to ask applicants...]]></summary>
  </entry>
  <entry>
    <title>Second entry</title>
    <link rel="replies" href="https://www.theverge.com/2#comments" />
    <link href="https://www.theverge.com/2" />
    <id>tag:verge,2</id>
    <updated>2026-10-13T00:00:00Z</updated>
    <content type="html">&lt;p&gt;Body text&lt;/p&gt;</content>
  </entry>
</feed>`;

describe('text helpers', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &#38; c &#x2019; &mdash; &unknown;')).toBe(
      'a & b & c ’ — &unknown;'
    );
  });

  it('strips tags, scripts and collapses whitespace', () => {
    expect(htmlToText('<p>Hi <script>alert(1)</script><b>there</b>\n\n friend</p>')).toBe(
      'Hi there friend'
    );
  });

  it('caps summaries at 200 chars with an ellipsis', () => {
    const long = 'word '.repeat(100);
    const out = truncate(long);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(out.endsWith('…')).toBe(true);
    expect(truncate('short')).toBe('short');
  });

  it('produces stable ids from links', () => {
    expect(itemId('https://a/b')).toBe(itemId('https://a/b'));
    expect(itemId('https://a/b')).not.toBe(itemId('https://a/c'));
    expect(itemId('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('parseFeed (RSS 2.0)', () => {
  const feed = parseFeed(RSS);

  it('reads the channel title as publisher', () => {
    expect(feed.title).toBe('BBC News - World');
    expect(feed.items[0].publisher).toBe('BBC News - World');
  });

  it('handles CDATA titles and HTML summaries', () => {
    const [a] = feed.items;
    expect(a.title).toBe('Storms & floods hit coast');
    expect(a.summary).toBe('Heavy rain caused flooding in “several” towns.');
    expect(a.link).toBe('https://www.bbc.co.uk/news/world-1');
    expect(a.publishedAt).toBe('2026-10-14T18:53:31.000Z');
    expect(a.id).toBe(itemId('https://www.bbc.co.uk/news/world-1'));
  });

  it('decodes entity-escaped HTML and links', () => {
    const b = feed.items[1];
    expect(b.title).toBe('AT&T & partners');
    expect(b.summary).toBe('Escaped HTML summary — done');
    expect(b.link).toBe('https://example.com/b?x=1&y=2');
    expect(b.publishedAt).toBe('2026-10-15T01:00:00.000Z');
  });

  it('falls back to a permalink guid and null date; skips untitled items', () => {
    expect(feed.items).toHaveLength(3);
    expect(feed.items[2].link).toBe('https://example.com/c');
    expect(feed.items[2].publishedAt).toBeNull();
    expect(feed.items[2].summary).toBeUndefined();
  });

  it('uses the publisher override for presets', () => {
    expect(parseFeed(RSS, 'BBC News').items[0].publisher).toBe('BBC News');
  });
});

describe('parseFeed (Atom)', () => {
  const feed = parseFeed(ATOM);

  it('parses entries with alternate links and CDATA', () => {
    expect(feed.items).toHaveLength(2);
    const [a, b] = feed.items;
    expect(a.title).toBe('McKinsey is making job applicants spar with a fake AI client');
    expect(a.link).toBe('https://www.theverge.com/news/1011654/mckinsey');
    expect(a.summary).toBe('Consulting firm McKinsey & Company is going to ask applicants...');
    expect(a.publishedAt).toBe('2026-10-14T22:53:31.000Z');
    expect(a.publisher).toBe('The Verge');
    expect(b.link).toBe('https://www.theverge.com/2');
    expect(b.summary).toBe('Body text');
  });

  it('rejects non-feed documents', () => {
    expect(() => parseFeed('<html><body>nope</body></html>')).toThrow();
  });
});
