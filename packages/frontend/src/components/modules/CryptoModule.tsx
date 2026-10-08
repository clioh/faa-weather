/**
 * Crypto Module
 * Cryptocurrency price display
 */

import { ModuleProps } from './index';

interface CryptoConfig {
  symbols?: string;
  currency?: string;
}

export function CryptoModule({ config, size }: ModuleProps) {
  const cryptoConfig = config as CryptoConfig;
  const symbols = (cryptoConfig.symbols || 'BTC,ETH,SOL').split(',');
  // currency can be used when integrating with crypto API

  // Placeholder data - would integrate with crypto API
  const cryptos = symbols.map(symbol => ({
    symbol: symbol.trim().toUpperCase(),
    price: '---',
    change24h: '0.00%',
    positive: true,
  }));

  const isHorizontal = size === 'wide' || size === 'full';

  return (
    <div className={`crypto-module ${isHorizontal ? 'horizontal' : 'vertical'}`}>
      {cryptos.map(crypto => (
        <div key={crypto.symbol} className="crypto-item">
          <span className="crypto-symbol">{crypto.symbol}</span>
          <span className="crypto-price">{crypto.price}</span>
          <span className={`crypto-change ${crypto.positive ? 'positive' : 'negative'}`}>
            {crypto.positive ? '+' : ''}{crypto.change24h}
          </span>
        </div>
      ))}

      <style>{`
        .crypto-module {
          display: flex;
          height: 100%;
          gap: 1rem;
        }

        .crypto-module.horizontal {
          flex-direction: row;
          justify-content: space-around;
          align-items: center;
        }

        .crypto-module.vertical {
          flex-direction: column;
          justify-content: space-around;
        }

        .crypto-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.5rem;
        }

        .crypto-symbol {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--color-text-dim);
          margin-bottom: 0.25rem;
        }

        .crypto-price {
          font-size: 1.25rem;
          font-family: var(--font-mono);
        }

        .crypto-change {
          font-size: 0.75rem;
          font-family: var(--font-mono);
        }

        .crypto-change.positive {
          color: var(--color-vfr);
        }

        .crypto-change.negative {
          color: var(--color-ifr);
        }
      `}</style>
    </div>
  );
}
