/**
 * Crypto — coin prices with 24-hour change. Same row grammar as stocks.
 */

import { CSSProperties } from 'react';
import { ModuleProps, resolveList } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import './StocksModule.css';

interface CryptoQuote {
  symbol: string;
  name: string | null;
  price: number | null;
  change24hPercent: number | null;
  currency: string;
}

interface CryptoResponse {
  quotes: CryptoQuote[];
  fetchedAt?: string;
}

const DEFAULT_COINS = ['BTC', 'ETH'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];
const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
const MAX_ROWS: Record<string, number> = { small: 2, medium: 4, tall: 6, wide: 4 };

/** Whole units for big prices, more precision for sub-dollar coins. */
function formatPrice(price: number | null, currency: string): string {
  if (price === null || !Number.isFinite(price)) return '—';
  const digits = price >= 1000 ? 0 : price >= 1 ? 2 : 4;
  const n = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(price);
  return `${SYMBOL[currency] ?? ''}${n}`;
}

function Change({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value))
    return <span className="ticker-change text-faint">—</span>;
  const tone = value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-dim';
  const glyph = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return (
    <span className={`ticker-change ${tone}`}>
      {glyph && <span className="ticker-glyph">{glyph}</span>}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

export function CryptoModule({ config, size }: ModuleProps) {
  const coins = resolveList(config.coins, DEFAULT_COINS)
    .map((c) => c.toUpperCase())
    .slice(0, 10);
  const currency =
    typeof config.currency === 'string' && CURRENCIES.includes(config.currency.toUpperCase())
      ? config.currency.toUpperCase()
      : 'USD';
  const maxRows = MAX_ROWS[size] ?? 4;

  const url = coins.length
    ? `/api/finance/crypto?coins=${encodeURIComponent(coins.join(','))}&currency=${currency}`
    : null;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<CryptoResponse>(url, {
    refreshMs: 2 * 60_000,
  });

  const quotes = (data?.quotes ?? []).slice(0, maxRows);

  let body;
  if (!url) {
    body = <ModuleEmpty title="No coins" hint="Add coins such as BTC in the app" />;
  } else if (loading) {
    body = <ModuleLoading />;
  } else if (!data && error) {
    body = <ModuleError title="Prices unavailable" hint="Will retry shortly" />;
  } else if (quotes.length === 0) {
    body = <ModuleEmpty title="No prices" hint="Check the coin symbols in the app" />;
  } else if (size === 'wide') {
    body = (
      <div className="ticker-cards" style={{ '--ticker-n': quotes.length } as CSSProperties}>
        {quotes.map((q) => (
          <div key={q.symbol} className="ticker-card">
            <div className="ticker-card-head">
              <span className="ticker-symbol">{q.symbol}</span>
              <Change value={q.change24hPercent} />
            </div>
            <span className="ticker-price">{formatPrice(q.price, q.currency || currency)}</span>
            {q.name && <span className="ticker-name">{q.name}</span>}
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="ticker-rows">
        {quotes.map((q) => (
          <div key={q.symbol} className="ticker-row">
            <span className="ticker-id">
              <span className="ticker-symbol">{q.symbol}</span>
            </span>
            <span className="ticker-price">{formatPrice(q.price, q.currency || currency)}</span>
            <Change value={q.change24hPercent} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ModuleFrame
      title="Crypto"
      accent={currency}
      meta={<Age at={lastUpdated} stale={isStale} />}
      className="ticker"
    >
      {body}
    </ModuleFrame>
  );
}
