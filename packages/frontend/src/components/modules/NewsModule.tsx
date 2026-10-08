/**
 * News Module
 * Displays news headlines
 */

import { ModuleProps } from './index';

// NewsConfig interface - will be used when integrating with news API
// interface NewsConfig {
//   source?: string;
//   maxItems?: number;
// }

export function NewsModule(_props: ModuleProps) {

  // Placeholder - would integrate with news API
  const headlines = [
    { id: '1', title: 'News feed coming soon', source: 'SkyGlass' },
    { id: '2', title: 'Configure news source in settings', source: 'Setup' },
  ];

  return (
    <div className="news-module">
      <div className="news-header">
        <span className="news-title">Headlines</span>
      </div>
      <div className="headlines-list">
        {headlines.map(item => (
          <div key={item.id} className="headline-item">
            <span className="headline-text">{item.title}</span>
            <span className="headline-source">{item.source}</span>
          </div>
        ))}
      </div>

      <style>{`
        .news-module {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .news-header {
          margin-bottom: 0.75rem;
        }

        .news-title {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .headlines-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .headline-item {
          padding-bottom: 0.75rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .headline-text {
          display: block;
          font-size: 0.9rem;
          line-height: 1.4;
          margin-bottom: 0.25rem;
        }

        .headline-source {
          font-size: 0.7rem;
          color: var(--color-text-dim);
        }
      `}</style>
    </div>
  );
}
