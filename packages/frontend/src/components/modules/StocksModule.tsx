/**
 * Stocks Module
 * Stock ticker display
 */

import { ModuleProps } from './index';

interface StocksConfig {
  symbols?: string;
}

export function StocksModule({ config, size }: ModuleProps) {
  const stocksConfig = config as StocksConfig;
  const symbols = (stocksConfig.symbols || 'AAPL,GOOGL,MSFT').split(',');

  // Placeholder data - would integrate with stock API
  const stocks = symbols.map(symbol => ({
    symbol: symbol.trim(),
    price: '---',
    change: '0.00',
    changePercent: '0.00%',
    positive: true,
  }));

  const isHorizontal = size === 'wide' || size === 'full';

  return (
    <div className={`stocks-module ${isHorizontal ? 'horizontal' : 'vertical'}`}>
      {stocks.map(stock => (
        <div key={stock.symbol} className="stock-item">
          <span className="stock-symbol">{stock.symbol}</span>
          <span className="stock-price">{stock.price}</span>
          <span className={`stock-change ${stock.positive ? 'positive' : 'negative'}`}>
            {stock.positive ? '+' : ''}{stock.change} ({stock.changePercent})
          </span>
        </div>
      ))}

      <style>{`
        .stocks-module {
          display: flex;
          height: 100%;
          gap: 1rem;
        }

        .stocks-module.horizontal {
          flex-direction: row;
          justify-content: space-around;
          align-items: center;
        }

        .stocks-module.vertical {
          flex-direction: column;
          justify-content: space-around;
        }

        .stock-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.5rem;
        }

        .stock-symbol {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--color-text-dim);
          margin-bottom: 0.25rem;
        }

        .stock-price {
          font-size: 1.25rem;
          font-family: var(--font-mono);
        }

        .stock-change {
          font-size: 0.75rem;
          font-family: var(--font-mono);
        }

        .stock-change.positive {
          color: var(--color-vfr);
        }

        .stock-change.negative {
          color: var(--color-ifr);
        }
      `}</style>
    </div>
  );
}
