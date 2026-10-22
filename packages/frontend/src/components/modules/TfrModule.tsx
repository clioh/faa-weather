/**
 * TFRs — temporary flight restrictions.
 *
 * The FAA list carries no geometry today, so when a TFR has no coordinates
 * the widget shows the national list sorted by start time and says so. When
 * coordinates are present it filters to radiusNm around the mirror.
 *
 * small: count + the first restriction
 * medium / tall / wide: list rows (description, type, facility, window)
 */

import { useEffect } from 'react';
import { ModuleProps } from './index';
import { Age, ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { distanceNm, fetchErrorHint } from './aviationFormat';
import './TfrModule.css';

interface Tfr {
  id: string;
  type: string;
  facility: string;
  state: string;
  description: string;
  effectiveStart: string;
  effectiveEnd: string;
  latitude?: number;
  longitude?: number;
}

interface TfrResponse {
  count: number;
  tfrs: Tfr[];
}

const ROW_CAP: Record<string, number> = { small: 1, medium: 3, tall: 6, wide: 2 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Oct" for day-only stamps (no timezone shift), "16 Oct 1400Z" otherwise. */
function formatTfrDate(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}${mm}Z`;
}

function formatWindow(tfr: Tfr): string {
  if (!tfr.effectiveStart && !tfr.effectiveEnd) return 'Standing';
  if (!tfr.effectiveEnd || tfr.effectiveStart === tfr.effectiveEnd) {
    return formatTfrDate(tfr.effectiveStart || tfr.effectiveEnd);
  }
  if (!tfr.effectiveStart) return `until ${formatTfrDate(tfr.effectiveEnd)}`;
  return `${formatTfrDate(tfr.effectiveStart)} – ${formatTfrDate(tfr.effectiveEnd)}`;
}

/** Security and VIP restrictions are the ones that bite; colour only those. */
function isSecurity(type: string): boolean {
  return /VIP|SECURITY|PRESIDENT/i.test(type);
}

const startKey = (t: Tfr) => (t.effectiveStart ? Date.parse(t.effectiveStart) || 0 : 0);

export function TfrModule({ config, size, latitude, longitude }: ModuleProps) {
  const radiusNm = Math.min(500, Math.max(25, Number(config.radiusNm) || 100));
  const maxItems = Math.min(15, Math.max(1, Number(config.maxItems) || 5));
  const { data, loading, error, isStale, lastUpdated, refresh } = useModuleData<TfrResponse>(
    '/api/aviation/tfrs',
    { refreshMs: 15 * 60_000 }
  );

  useEffect(() => {
    const onWs = (e: Event) => {
      if ((e as CustomEvent<{ type: string }>).detail?.type === 'tfrs') void refresh();
    };
    window.addEventListener('skyglass:ws', onWs);
    return () => window.removeEventListener('skyglass:ws', onWs);
  }, [refresh]);

  const all = data?.tfrs ?? [];
  const hasHome = typeof latitude === 'number' && typeof longitude === 'number';
  const located = hasHome && all.some((t) => typeof t.latitude === 'number' && typeof t.longitude === 'number');

  const items = located
    ? all
        .filter((t) => typeof t.latitude === 'number' && typeof t.longitude === 'number')
        .map((t) => ({ tfr: t, nm: distanceNm(latitude!, longitude!, t.latitude!, t.longitude!) }))
        .filter((x) => x.nm <= radiusNm)
        .sort((a, b) => a.nm - b.nm)
    : [...all].sort((a, b) => startKey(a) - startKey(b)).map((t) => ({ tfr: t, nm: null as number | null }));

  const shown = items.slice(0, Math.min(maxItems, ROW_CAP[size] ?? 3));
  const hidden = items.length - shown.length;
  const scope = located ? `within ${radiusNm} nm` : 'nationwide';

  const meta = data ? (
    <span className="tfr-meta">
      <span className="mf-pill outline">{items.length}</span>
      <Age at={lastUpdated} stale={isStale} />
    </span>
  ) : undefined;

  let footer: string | undefined;
  if (data && items.length > 0 && size !== 'small') {
    footer = hidden > 0 ? `+${hidden} more ${scope}` : located ? undefined : 'Nationwide';
  }

  return (
    <ModuleFrame title="TFRs" meta={meta} className={`tfr tfr-${size}`} footer={footer}>
      {loading ? (
        <ModuleLoading />
      ) : !data ? (
        <ModuleError title="TFRs unavailable" hint={fetchErrorHint(error, 'FAA list not available')} />
      ) : shown.length === 0 ? (
        <ModuleEmpty title={located ? `No TFRs within ${radiusNm} nm` : 'No active TFRs'} />
      ) : (
        <div className="mf-list tfr-list">
          {shown.map(({ tfr, nm }) => (
            <div key={tfr.id} className="tfr-row">
              <span className="tfr-desc">{tfr.description || tfr.id}</span>
              <span className="tfr-sub">
                <span className={`tfr-type${isSecurity(tfr.type) ? ' text-warning' : ''}`}>
                  {tfr.type || 'TFR'}
                </span>
                <span className="tfr-where">{[tfr.facility, tfr.state].filter(Boolean).join(' · ')}</span>
                <span className="tfr-when mono">
                  {nm !== null ? `${Math.round(nm)} nm · ` : ''}
                  {formatWindow(tfr)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </ModuleFrame>
  );
}
