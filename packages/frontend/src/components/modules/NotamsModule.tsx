/**
 * NOTAMs — active notices for an airport, runway and taxiway items first.
 *
 * medium / tall: chip + until on one line, description beneath
 * large / full: chip, description and until on one line
 */

import { ModuleProps, resolveAirport } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { cleanNotamText, fetchErrorHint, formatZuluDay, notamCategory } from './aviationFormat';
import './NotamsModule.css';

interface Notam {
  id: string;
  type: string;
  classification: string;
  description: string;
  effectiveStart: string;
  effectiveEnd: string | null;
}

interface NotamResponse {
  icao: string;
  count: number;
  notams: Notam[];
}

// Rows that fit without scrolling, per tile size.
const ROW_CAP: Record<string, number> = { medium: 3, tall: 6, large: 7, full: 8 };

export function NotamsModule({ config, airport, size }: ModuleProps) {
  const icao = resolveAirport(config, airport);
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  const categories = typeof config.categories === 'string' ? config.categories.trim() : 'all';
  const query = categories && categories !== 'all' ? `?categories=${encodeURIComponent(categories)}` : '';
  const { data, loading, error, isStale, lastUpdated } = useModuleData<NotamResponse>(
    icao ? `/api/aviation/notams/${encodeURIComponent(icao)}${query}` : null,
    { refreshMs: 15 * 60_000 }
  );

  const rows = (data?.notams ?? [])
    .map((n) => ({ notam: n, category: notamCategory(n.description, n.classification) }))
    .sort(
      (a, b) =>
        a.category.rank - b.category.rank ||
        Date.parse(b.notam.effectiveStart) - Date.parse(a.notam.effectiveStart)
    );
  const shown = rows.slice(0, Math.min(maxItems, ROW_CAP[size] ?? 6));
  const hidden = rows.length - shown.length;
  const stacked = size === 'medium' || size === 'tall';

  return (
    <ModuleFrame
      title="NOTAMs"
      accent={icao ?? undefined}
      meta={data ? <Age at={lastUpdated} stale={isStale} /> : undefined}
      className={`notams notams-${size}`}
      footer={data && hidden > 0 ? `+${hidden} more` : undefined}
    >
      {!icao ? (
        <ModuleEmpty title="No airport set" hint="Choose an airport in the app" />
      ) : loading ? (
        <ModuleLoading />
      ) : !data ? (
        <ModuleError title="NOTAMs unavailable" hint={fetchErrorHint(error, `No NOTAMs for ${icao}`)} />
      ) : shown.length === 0 ? (
        <ModuleEmpty title="No active NOTAMs" hint={query ? 'For the selected categories' : undefined} />
      ) : (
        <div className="mf-list notams-list">
          {shown.map(({ notam, category }) => {
            const until = notam.effectiveEnd ? formatZuluDay(notam.effectiveEnd) : 'PERM';
            const text = cleanNotamText(notam.description) || notam.description;
            return (
              <div key={notam.id} className={`notams-row${stacked ? ' stacked' : ''}`}>
                <span className="mf-pill outline notams-chip">{category.label}</span>
                <span className="notams-text">{text}</span>
                <span className="notams-until mono">{until}</span>
              </div>
            );
          })}
        </div>
      )}
    </ModuleFrame>
  );
}
