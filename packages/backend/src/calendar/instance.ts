/**
 * Process-wide CalendarService wired to data/calendar-accounts.json, the
 * loaded config and the WebSocket broadcast. Routes import this; tests build
 * their own CalendarService instead.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { configEvents, loadConfig } from '../config/index.js';
import { broadcast } from '../server.js';
import { CalendarAccountStore } from './accounts-store.js';
import { readCalendarSettings, type CalendarSettings } from './config.js';
import { CalendarService } from './service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/calendar or dist/calendar -> packages/backend -> repo root /data (same as todos/photos)
export const CALENDAR_DATA_DIR = path.resolve(__dirname, '../../../../data');
export const CALENDAR_ACCOUNTS_FILE = path.join(CALENDAR_DATA_DIR, 'calendar-accounts.json');

let settings: CalendarSettings | null = null;

function getSettings(): CalendarSettings {
  if (!settings) {
    try {
      settings = readCalendarSettings(loadConfig());
    } catch (error) {
      console.error('[calendar] could not load config:', error);
      settings = readCalendarSettings({});
    }
  }
  return settings;
}

configEvents.on('changed', () => {
  settings = null;
  calendarService.reschedule();
});

export const calendarService = new CalendarService({
  store: new CalendarAccountStore(CALENDAR_ACCOUNTS_FILE),
  getSettings,
  notify: (payload) => broadcast('calendar', payload),
});
