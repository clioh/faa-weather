/**
 * Aviation API Routes
 * Endpoints for METAR, TAF, TFRs, and astronomical data
 */

import { Router } from 'express';
import { aviationData } from '../services/aviation.js';
import { formatWind, formatVisibility, formatClouds } from '../services/metar-parser.js';
import {
  getCurrentPeriod,
  getFlightTimeForecast,
  parseLocalFlightTime,
} from '../services/taf-parser.js';
import { AstroDataManager, formatTime, formatZulu, getUpcomingEvent } from '../services/astro.js';
import { notamData, filterNotamsByCategory, filterActiveNotams } from '../services/notam.js';
import { loadConfig } from '../config/index.js';

const router = Router();
const config = loadConfig();

// Initialize astro manager with configured location
const astroManager = new AstroDataManager(
  config.location.latitude,
  config.location.longitude
);

/**
 * GET /api/aviation/metar/:icao
 * Fetch METAR for an airport
 */
router.get('/metar/:icao', async (req, res) => {
  try {
    const { icao } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    const metar = await aviationData.getMetar(icao, forceRefresh);

    if (!metar) {
      return res.status(404).json({ error: `No METAR found for ${icao}` });
    }

    res.json({
      icao: icao.toUpperCase(),
      raw: metar.raw,
      flightRules: metar.flightRules,
      parsed: metar.parsed,
      formatted: {
        wind: formatWind(metar.parsed.wind),
        visibility: formatVisibility(metar.parsed.visibility),
        clouds: formatClouds(metar.parsed.clouds),
        temperature: metar.parsed.temperature !== null
          ? `${metar.parsed.temperature}°C`
          : 'N/A',
        dewpoint: metar.parsed.dewpoint !== null
          ? `${metar.parsed.dewpoint}°C`
          : 'N/A',
        altimeter: metar.parsed.altimeter !== null
          ? `${metar.parsed.altimeter.toFixed(2)}"`
          : 'N/A',
      },
      fetchedAt: metar.fetchedAt.toISOString(),
    });
  } catch (error) {
    console.error('METAR route error:', error);
    res.status(500).json({ error: 'Failed to fetch METAR' });
  }
});

/**
 * GET /api/aviation/taf/:icao
 * Fetch TAF for an airport
 */
router.get('/taf/:icao', async (req, res) => {
  try {
    const { icao } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    const taf = await aviationData.getTaf(icao, forceRefresh);

    if (!taf) {
      return res.status(404).json({ error: `No TAF found for ${icao}` });
    }

    const currentPeriod = getCurrentPeriod(taf.parsed);

    res.json({
      icao: icao.toUpperCase(),
      raw: taf.raw,
      parsed: taf.parsed,
      currentPeriod: currentPeriod
        ? {
            ...currentPeriod,
            flightRules: currentPeriod.flightRules,
          }
        : null,
      fetchedAt: taf.fetchedAt.toISOString(),
    });
  } catch (error) {
    console.error('TAF route error:', error);
    res.status(500).json({ error: 'Failed to fetch TAF' });
  }
});

/**
 * GET /api/aviation/taf/:icao/forecast
 * Get TAF forecast for a specific flight time
 * Query params:
 *   - time: Local time string (e.g., "14:30", "1430")
 *   - date: ISO date string (e.g., "2024-01-15")
 *   - timezone: Optional timezone override
 */
router.get('/taf/:icao/forecast', async (req, res) => {
  try {
    const { icao } = req.params;
    const { time, date, timezone } = req.query;

    if (!time) {
      return res.status(400).json({ error: 'time parameter required' });
    }

    const taf = await aviationData.getTaf(icao);
    if (!taf) {
      return res.status(404).json({ error: `No TAF found for ${icao}` });
    }

    // Parse the flight date
    const flightDate = date ? new Date(date as string) : new Date();
    const tz = (timezone as string) || config.location.timezone;

    // Convert local time to UTC for TAF comparison
    const utcTime = parseLocalFlightTime(time as string, flightDate, tz);

    // Get forecast for that time
    const forecast = getFlightTimeForecast(taf.parsed, utcTime);

    res.json({
      icao: icao.toUpperCase(),
      requestedTime: {
        local: `${time} ${tz}`,
        utc: formatZulu(utcTime),
      },
      forecast: forecast.period,
      warnings: forecast.warnings,
      raw: taf.raw,
    });
  } catch (error) {
    console.error('TAF forecast route error:', error);
    res.status(500).json({ error: 'Failed to get TAF forecast' });
  }
});

/**
 * GET /api/aviation/tfrs
 * Fetch active TFRs
 */
router.get('/tfrs', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const tfrs = await aviationData.getTfrs(forceRefresh);

    res.json({
      count: tfrs.length,
      tfrs,
    });
  } catch (error) {
    console.error('TFR route error:', error);
    res.status(500).json({ error: 'Failed to fetch TFRs' });
  }
});

/**
 * GET /api/aviation/notams/:icao
 * Fetch NOTAMs for an airport
 * Query params:
 *   - active: Only return currently active NOTAMs (default: true)
 *   - categories: Comma-separated list of categories to filter
 */
router.get('/notams/:icao', async (req, res) => {
  try {
    const { icao } = req.params;
    const activeOnly = req.query.active !== 'false';
    const categories = req.query.categories
      ? (req.query.categories as string).split(',')
      : [];

    let notams = await notamData.getNotams(icao);

    // Filter to active NOTAMs if requested
    if (activeOnly) {
      notams = filterActiveNotams(notams);
    }

    // Filter by categories if specified
    if (categories.length > 0) {
      notams = filterNotamsByCategory(notams, categories);
    }

    res.json({
      icao: icao.toUpperCase(),
      count: notams.length,
      notams: notams.map((n) => ({
        id: n.id,
        type: n.type,
        classification: n.classification,
        description: n.description,
        effectiveStart: n.effectiveStart.toISOString(),
        effectiveEnd: n.effectiveEnd?.toISOString() || null,
        location: n.location,
        schedule: n.schedule,
        altitude:
          n.minimumAltitude || n.maximumAltitude
            ? {
                min: n.minimumAltitude,
                max: n.maximumAltitude,
              }
            : null,
      })),
    });
  } catch (error) {
    console.error('NOTAM route error:', error);
    res.status(500).json({ error: 'Failed to fetch NOTAMs' });
  }
});

/**
 * GET /api/astro
 * Get astronomical data for today
 */
router.get('/astro', (_req, res) => {
  try {
    const astro = astroManager.getToday();
    const now = new Date();
    const upcoming = getUpcomingEvent(astro, now);

    res.json({
      date: astro.date,
      sun: {
        sunrise: {
          time: astro.sun.sunrise.toISOString(),
          local: formatTime(astro.sun.sunrise, config.location.timezone),
          zulu: formatZulu(astro.sun.sunrise),
        },
        sunset: {
          time: astro.sun.sunset.toISOString(),
          local: formatTime(astro.sun.sunset, config.location.timezone),
          zulu: formatZulu(astro.sun.sunset),
        },
        civilDawn: {
          time: astro.sun.civilDawn.toISOString(),
          local: formatTime(astro.sun.civilDawn, config.location.timezone),
          zulu: formatZulu(astro.sun.civilDawn),
        },
        civilDusk: {
          time: astro.sun.civilDusk.toISOString(),
          local: formatTime(astro.sun.civilDusk, config.location.timezone),
          zulu: formatZulu(astro.sun.civilDusk),
        },
      },
      moon: {
        phase: astro.moon.phase,
        phaseName: astro.moon.phaseName,
        illumination: astro.moon.illumination,
      },
      upcoming: upcoming
        ? {
            event: upcoming.event,
            time: upcoming.time.toISOString(),
            local: formatTime(upcoming.time, config.location.timezone),
            minutesUntil: upcoming.minutesUntil,
          }
        : null,
      location: astro.location,
    });
  } catch (error) {
    console.error('Astro route error:', error);
    res.status(500).json({ error: 'Failed to calculate astronomical data' });
  }
});

/**
 * GET /api/astro/:date
 * Get astronomical data for a specific date
 */
router.get('/astro/:date', (req, res) => {
  try {
    const { date } = req.params;
    const targetDate = new Date(date);

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const astro = astroManager.getForDate(targetDate);

    res.json({
      date: astro.date,
      sun: {
        sunrise: {
          time: astro.sun.sunrise.toISOString(),
          local: formatTime(astro.sun.sunrise, config.location.timezone),
          zulu: formatZulu(astro.sun.sunrise),
        },
        sunset: {
          time: astro.sun.sunset.toISOString(),
          local: formatTime(astro.sun.sunset, config.location.timezone),
          zulu: formatZulu(astro.sun.sunset),
        },
        civilDawn: {
          time: astro.sun.civilDawn.toISOString(),
          local: formatTime(astro.sun.civilDawn, config.location.timezone),
          zulu: formatZulu(astro.sun.civilDawn),
        },
        civilDusk: {
          time: astro.sun.civilDusk.toISOString(),
          local: formatTime(astro.sun.civilDusk, config.location.timezone),
          zulu: formatZulu(astro.sun.civilDusk),
        },
      },
      moon: {
        phase: astro.moon.phase,
        phaseName: astro.moon.phaseName,
        illumination: astro.moon.illumination,
      },
      location: astro.location,
    });
  } catch (error) {
    console.error('Astro date route error:', error);
    res.status(500).json({ error: 'Failed to calculate astronomical data' });
  }
});

export default router;
