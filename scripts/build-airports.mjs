#!/usr/bin/env node
/**
 * Build packages/backend/data/airports.json, the list the setup airport
 * search runs against.
 *
 * Sources (both public):
 *   - aviationweather.gov station cache: every station the AWC serves METARs
 *     for. The home airport drives the mirror's METAR/TAF widgets, so the list
 *     is limited to stations that actually report weather.
 *   - OurAirports (public domain): proper names, cities and search keywords.
 *
 * Usage: node scripts/build-airports.mjs        (needs network access)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIONS_URL = 'https://aviationweather.gov/data/cache/stations.cache.json.gz';
const OURAIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'backend',
  'data',
  'airports.json'
);

/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SkyGlass build-airports' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|And|The|De|La|Del|Do|Da|Di)\b/g, (m) => m.toLowerCase())
    .replace(/\bMcas\b/g, 'MCAS')
    .replace(/\bNas\b/g, 'NAS')
    .replace(/\bAfb\b/g, 'AFB')
    .replace(/\bAaf\b/g, 'AAF')
    .replace(/\bIntl\b/g, 'Intl')
    .trim();
}

console.log('Downloading station cache and OurAirports data...');
const [stationsGz, csvBuf] = await Promise.all([download(STATIONS_URL), download(OURAIRPORTS_URL)]);
const stations = JSON.parse(gunzipSync(stationsGz).toString('utf8'));
const ourAirports = parseCsv(csvBuf.toString('utf8'));

const byCode = new Map();
for (const a of ourAirports) {
  for (const code of [a.icao_code, a.ident, a.gps_code]) {
    if (code && !byCode.has(code)) byCode.set(code, a);
  }
}

const airports = [];
let enriched = 0;
for (const s of stations) {
  const icao = s.icaoId;
  // 4-letter ICAO codes only (matches the backend's setup validation) that
  // report METARs. Alphanumeric ids are mostly offshore platforms/heliports.
  if (!icao || !/^[A-Z]{4}$/.test(icao)) continue;
  if (!Array.isArray(s.siteType) || !s.siteType.includes('METAR')) continue;

  const oa = byCode.get(icao);
  if (oa && oa.type === 'closed') continue;

  let name;
  let city;
  let keywords = '';
  if (oa) {
    enriched++;
    name = oa.name;
    const region = oa.iso_country === 'US' ? oa.iso_region.replace(/^US-/, '') : oa.iso_country;
    city = [oa.municipality, region].filter(Boolean).join(', ');
    keywords = oa.keywords || '';
  } else {
    name = titleCase(String(s.site || icao));
    city = [s.state, s.country].filter(Boolean).join(', ');
  }

  const entry = {
    icao,
    name,
    city,
    lat: Math.round(Number(s.lat) * 1000) / 1000,
    lon: Math.round(Number(s.lon) * 1000) / 1000,
    taf: s.siteType.includes('TAF') ? 1 : 0,
    p: typeof s.priority === 'number' ? s.priority : 9,
  };
  if (s.iataId) entry.iata = s.iataId;
  if (keywords) entry.kw = keywords;
  airports.push(entry);
}

airports.sort((a, b) => a.icao.localeCompare(b.icao));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(airports) + '\n');
console.log(`Wrote ${airports.length} airports (${enriched} with OurAirports names) to ${OUT}`);
