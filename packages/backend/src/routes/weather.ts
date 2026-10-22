/**
 * General Weather API Routes (Open-Meteo)
 * GET /api/weather/current?lat=&lon=&units=imperial|metric
 * GET /api/weather/forecast?lat=&lon=&units=&days=5
 */

import { Router } from 'express';
import { validateQuery } from '../middleware/validate.js';
import { weatherCurrentQuerySchema, weatherForecastQuerySchema } from '../validation/schemas.js';
import { getCurrentWeather, getWeatherForecast, type Units } from '../services/weather.js';
import { upstreamErrorResponse } from '../services/upstream.js';

const router = Router();

router.get('/current', validateQuery(weatherCurrentQuerySchema), async (req, res) => {
  const { lat, lon, units } = req.query as unknown as { lat: number; lon: number; units: Units };
  try {
    res.json(await getCurrentWeather(lat, lon, units));
  } catch (error) {
    console.error('Weather route error:', error instanceof Error ? error.message : error);
    const { status, body } = upstreamErrorResponse(error, 'Failed to fetch weather');
    res.status(status).json(body);
  }
});

router.get('/forecast', validateQuery(weatherForecastQuerySchema), async (req, res) => {
  const { lat, lon, units, days } = req.query as unknown as { lat: number; lon: number; units: Units; days: number };
  try {
    res.json(await getWeatherForecast(lat, lon, units, days));
  } catch (error) {
    console.error('Forecast route error:', error instanceof Error ? error.message : error);
    const { status, body } = upstreamErrorResponse(error, 'Failed to fetch forecast');
    res.status(status).json(body);
  }
});

export default router;
