/**
 * Stocks — price, daily change and a 30-day trend per symbol.
 * The row grammar (.ticker-*) is shared with the crypto widget.
 */

import { CSSProperties } from 'react';
import { ModuleProps, resolveList } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { Sparkline } from './Sparkline';
import './StocksModule.css';

interface StockQuote {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  history: number[];
  asOf: string | null;
}

interface StocksResponse {
  quotes: StockQuote[];
  fetchedAt?: string;
}

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'SPY'];
const MAX_ROWS: Record<string, number> = { small: 2, medium: 4, tall: 6, large: 6, wide: 4 };

const priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ChangePercent({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="ticker-change text-faint">—</span>;
  const tone = value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-dim';
  const glyph = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return (
    <span className={`ticker-change ${tone}`}>
      {glyph && <span className="ticker-glyph">{glyph}</span>}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function Trend({ history }: { history: number[] }) {
  if (history.length < 2) return <span className="ticker-spark" />;
  const net = history[history.length - 1] - history[0];
  return (
    <span className={`ticker-spark ${net >= 0 ? 'text-positive' : 'text-negative'}`}>
      <Sparkline values={history} area />
    </span>
  );
}

export function StocksModule({ config, size }: ModuleProps) {
  const symbols = resolveList(config.symbols, DEFAULT_SYMBOLS)
    .map((s) => s.toUpperCase())
    .slice(0, 12);
  const showSparkline = config.showSparkline !== false && size !== 'small';
  const maxRows = MAX_ROWS[size] ?? 4;

  const url = symbols.length ? `/api/finance/stocks?symbols=${encodeURIComponent(symbols.join(','))}` : null;
  const { data, loading, error, isStale, lastUpdated } = useModuleData<StocksResponse>(url, {
    refreshMs: 5 * 60_000,
  });

  const quotes = (data?.quotes ?? []).slice(0, maxRows);
  const wide = size === 'wide';

  let body;
  if (!url) {
    body = <ModuleEmpty title="No symbols" hint="Add ticker symbols in the app" />;
  } else if (loading) {
    body = <ModuleLoading />;
  } else if (!data && error) {
    body = <ModuleError title="Quotes unavailable" hint="Will retry shortly" />;
  } else if (quotes.length === 0) {
    body = <ModuleEmpty title="No quotes" hint="Check the symbols in the app" />;
  } else if (wide) {
    body = (
      <div className="ticker-cards" style={{ '--ticker-n': quotes.length } as CSSProperties}>
        {quotes.map((q) => (
          <div key={q.symbol} className="ticker-card">
            <div className="ticker-card-head">
              <span className="ticker-symbol">{q.symbol}</span>
              <ChangePercent value={q.changePercent} />
            </div>
            <span className="ticker-price">{q.price === null ? '—' : priceFormat.format(q.price)}</span>
            {showSparkline && <Trend history={q.history ?? []} />}
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className={`ticker-rows${showSparkline ? ' with-spark' : ''}`}>
        {quotes.map((q) => (
          <div key={q.symbol} className="ticker-row">
            <span className="ticker-id">
              <span className="ticker-symbol">{q.symbol}</span>
              {size === 'large' && q.name && <span className="ticker-name">{q.name}</span>}
            </span>
            {showSparkline && <Trend history={q.history ?? []} />}
            <span className="ticker-price">{q.price === null ? '—' : priceFormat.format(q.price)}</span>
            <ChangePercent value={q.changePercent} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ModuleFrame title="Stocks" meta={<Age at={lastUpdated} stale={isStale} />} className="ticker">
      {body}
    </ModuleFrame>
  );
}
