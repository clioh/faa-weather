/**
 * News — headlines from a preset source or a custom RSS feed.
 * Wide and full tiles lay the headlines out in columns.
 */

import { CSSProperties } from 'react';
import { ModuleProps } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { relativeAge, useNow } from './time';
import './NewsModule.css';

interface NewsItem {
  id: string;
  title: string;
  link?: string;
  publisher?: string | null;
  publishedAt: string | null;
}

interface NewsResponse {
  source: string;
  items: NewsItem[];
  fetchedAt?: string;
}

const SOURCE_NAMES: Record<string, string> = {
  world: 'World news',
  us: 'US news',
  business: 'Business',
  technology: 'Technology',
  sports: 'Sports',
  aviation: 'Aviation news',
  custom: 'News',
};

/** Columns and headlines that fit each size (two-line headlines + byline). */
const LAYOUT: Record<string, { cols: number; rows: number }> = {
  medium: { cols: 1, rows: 3 },
  tall: { cols: 1, rows: 4 },
  large: { cols: 1, rows: 5 },
  wide: { cols: 2, rows: 2 },
  full: { cols: 3, rows: 3 },
};

export function NewsModule({ config, size }: ModuleProps) {
  const source =
    typeof config.source === 'string' && config.source in SOURCE_NAMES ? config.source : 'world';
  const feedUrl = typeof config.feedUrl === 'string' ? config.feedUrl.trim() : '';
  const showSource = config.showSource !== false;
  const requested = Number(config.maxItems);
  const layout = LAYOUT[size] ?? LAYOUT.medium;
  const limit = Math.max(
    1,
    Math.min(
      Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 6,
      layout.cols * layout.rows
    )
  );

  const needsFeed = source === 'custom' && !feedUrl;
  const url = needsFeed
    ? null
    : `/api/news?source=${source}&limit=${limit}${source === 'custom' ? `&url=${encodeURIComponent(feedUrl)}` : ''}`;

  const { data, loading, error, isStale, lastUpdated } = useModuleData<NewsResponse>(url, {
    refreshMs: 10 * 60_000,
  });
  // Keeps "12m ago" bylines honest between fetches.
  const now = useNow(60_000);

  const items = (data?.items ?? []).slice(0, limit);
  const title =
    source === 'custom'
      ? items.find((i) => i.publisher)?.publisher || SOURCE_NAMES.custom
      : SOURCE_NAMES[source];

  let body;
  if (needsFeed) {
    body = <ModuleEmpty title="No feed" hint="Add a feed URL in the app" />;
  } else if (loading) {
    body = <ModuleLoading />;
  } else if (!data && error) {
    body = <ModuleError title="Headlines unavailable" hint="Will retry shortly" />;
  } else if (items.length === 0) {
    body = <ModuleEmpty title="No headlines right now" />;
  } else {
    const cols = Math.min(layout.cols, items.length);
    body = (
      <ol
        className={`news-list news-cols-${cols}`}
        style={{ '--news-cols': cols } as CSSProperties}
      >
        {items.map((item) => {
          const age = relativeAge(item.publishedAt, now.getTime());
          const byline = [
            source === 'custom' ? null : item.publisher,
            age ? (age === 'now' ? 'just now' : `${age} ago`) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={item.id} className="news-item">
              <span className="news-headline">{item.title}</span>
              {showSource && byline && <span className="news-byline">{byline}</span>}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ModuleFrame title={title} meta={<Age at={lastUpdated} stale={isStale} />} className="news">
      {body}
    </ModuleFrame>
  );
}
