/**
 * Quotes Module
 * Inspirational quotes display
 */

import { useState, useEffect } from 'react';
import { ModuleProps } from './index';

interface QuotesConfig {
  category?: string;
  rotateInterval?: number;
}

const DEFAULT_QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Aviation is proof that given the will, we have the capacity to achieve the impossible.", author: "Eddie Rickenbacker" },
  { text: "The engine is the heart of an airplane, but the pilot is its soul.", author: "Walter Raleigh" },
  { text: "Once you have tasted flight, you will forever walk the earth with your eyes turned skyward.", author: "Leonardo da Vinci" },
  { text: "Flying is learning how to throw yourself at the ground and miss.", author: "Douglas Adams" },
  { text: "The desire to fly is an idea handed down to us by our ancestors.", author: "Wilbur Wright" },
  { text: "A mile of highway will take you a mile. A mile of runway will take you anywhere.", author: "Unknown" },
];

export function QuotesModule({ config }: ModuleProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const quotesConfig = config as QuotesConfig;
  const rotateInterval = (quotesConfig.rotateInterval || 30) * 1000;

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % DEFAULT_QUOTES.length);
    }, rotateInterval);
    return () => clearInterval(interval);
  }, [rotateInterval]);

  const quote = DEFAULT_QUOTES[currentIndex];

  return (
    <div className="quotes-module">
      <div className="quote-content">
        <span className="quote-mark">"</span>
        <p className="quote-text">{quote.text}</p>
        <p className="quote-author">— {quote.author}</p>
      </div>

      <style>{`
        .quotes-module {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 1rem;
        }

        .quote-content {
          text-align: center;
          max-width: 90%;
          position: relative;
        }

        .quote-mark {
          font-size: 4rem;
          font-family: Georgia, serif;
          color: var(--color-accent);
          opacity: 0.3;
          position: absolute;
          top: -2rem;
          left: -1rem;
          line-height: 1;
        }

        .quote-text {
          font-size: 1.1rem;
          line-height: 1.6;
          font-style: italic;
          margin-bottom: 0.75rem;
        }

        .quote-author {
          font-size: 0.85rem;
          color: var(--color-text-dim);
        }
      `}</style>
    </div>
  );
}
