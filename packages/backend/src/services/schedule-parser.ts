/**
 * Flight Schedule XLSX Parser
 * Parses flight schedules from XLSX files with configurable column mapping
 */

import ExcelJS from 'exceljs';

export interface FlightEvent {
  id: string;
  source: 'xlsx';
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  aircraftType?: string;
  dutyType?: string; // e.g., 'Flight', 'Reserve', 'Training', 'Day Off'
  reportTime?: Date;
  releaseTime?: Date;
}

/**
 * Column mapping configuration
 * Maps your schedule's column headers to our data fields
 */
export interface ColumnMapping {
  date: string; // Column name for date
  flightNumber?: string;
  departure?: string; // Departure airport
  arrival?: string; // Arrival airport
  departureTime?: string; // Local departure time
  arrivalTime?: string; // Local arrival time
  reportTime?: string; // Show/report time
  releaseTime?: string; // Release time
  dutyType?: string; // Type of duty
  aircraftType?: string;
  // For parsing
  dateFormat?: string; // e.g., 'MM/DD/YYYY', 'YYYY-MM-DD'
  timeFormat?: string; // e.g., 'HH:mm', 'HHmm'
}

// Default column mapping (adjust based on your airline's format)
const DEFAULT_MAPPING: ColumnMapping = {
  date: 'Date',
  flightNumber: 'Flight',
  departure: 'Dep',
  arrival: 'Arr',
  departureTime: 'ETD',
  arrivalTime: 'ETA',
  reportTime: 'Report',
  releaseTime: 'Release',
  dutyType: 'Duty',
  aircraftType: 'Aircraft',
};

/**
 * Parse a time string to hours and minutes
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  if (!timeStr) return null;

  // Clean the string
  const cleaned = String(timeStr).trim();

  // Try HH:MM format
  const colonMatch = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    return {
      hours: parseInt(colonMatch[1], 10),
      minutes: parseInt(colonMatch[2], 10),
    };
  }

  // Try HHMM format
  const hmMatch = cleaned.match(/^(\d{2})(\d{2})$/);
  if (hmMatch) {
    return {
      hours: parseInt(hmMatch[1], 10),
      minutes: parseInt(hmMatch[2], 10),
    };
  }

  // Try decimal hours (e.g., 14.5 = 14:30)
  const decimalMatch = cleaned.match(/^(\d+)\.(\d+)$/);
  if (decimalMatch) {
    const hours = parseInt(decimalMatch[1], 10);
    const fraction = parseFloat(`0.${decimalMatch[2]}`);
    const minutes = Math.round(fraction * 60);
    return { hours, minutes };
  }

  return null;
}

/**
 * Parse a date from Excel cell value
 */
function parseExcelDate(value: unknown): Date | null {
  if (!value) return null;

  // If it's already a Date
  if (value instanceof Date) {
    return value;
  }

  // If it's a number, it's an Excel serial date
  if (typeof value === 'number') {
    // Excel dates are days since 1899-12-30
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    return date;
  }

  // Try parsing as string
  const str = String(value).trim();
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Try MM/DD/YYYY format
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    let year = parseInt(mdyMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(mdyMatch[1], 10) - 1, parseInt(mdyMatch[2], 10));
  }

  // Try DD-MMM-YYYY format (e.g., 15-Jan-2024)
  const dmmyMatch = str.match(/^(\d{1,2})-(\w{3})-(\d{2,4})$/i);
  if (dmmyMatch) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[dmmyMatch[2].toLowerCase()];
    if (month !== undefined) {
      let year = parseInt(dmmyMatch[3], 10);
      if (year < 100) year += 2000;
      return new Date(year, month, parseInt(dmmyMatch[1], 10));
    }
  }

  return null;
}

/**
 * Combine a date and time into a single Date object
 */
function combineDateAndTime(
  date: Date,
  timeStr: string | undefined,
  defaultHours = 0,
  defaultMinutes = 0
): Date {
  const time = timeStr ? parseTimeString(timeStr) : null;
  const result = new Date(date);

  if (time) {
    result.setHours(time.hours, time.minutes, 0, 0);
  } else {
    result.setHours(defaultHours, defaultMinutes, 0, 0);
  }

  return result;
}

/**
 * Get cell value as string
 */
function getCellValue(cell: ExcelJS.Cell | undefined): string | undefined {
  if (!cell || cell.value === null || cell.value === undefined) {
    return undefined;
  }

  const value = cell.value;

  // Handle rich text
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((rt) => rt.text).join('');
  }

  // Handle formula results
  if (typeof value === 'object' && 'result' in value) {
    return String(value.result);
  }

  // Handle hyperlinks
  if (typeof value === 'object' && 'text' in value) {
    return String(value.text);
  }

  return String(value);
}

/** The upload is not a readable XLSX schedule (corrupt, wrong format, no worksheet). */
export class ScheduleParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScheduleParseError';
  }
}

/**
 * Parse an XLSX file buffer into flight events. Throws ScheduleParseError when
 * the file can't be read, so a bad upload never replaces a good schedule.
 */
export async function parseFlightSchedule(
  buffer: Buffer | Uint8Array,
  mapping: Partial<ColumnMapping> = {}
): Promise<FlightEvent[]> {
  const config = { ...DEFAULT_MAPPING, ...mapping };
  const events: FlightEvent[] = [];

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    // Get the first sheet
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new ScheduleParseError('No worksheet found in the file');
    }

    // Get header row to map column names to indices
    const headerRow = sheet.getRow(1);
    const columnMap: Record<string, number> = {};

    headerRow.eachCell((cell, colNumber) => {
      const value = getCellValue(cell);
      if (value) {
        columnMap[value] = colNumber;
      }
    });

    console.log(`Parsing ${sheet.rowCount - 1} rows from schedule`);

    // Process data rows (skip header)
    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      // Get the date
      const dateCol = columnMap[config.date];
      const dateCell = dateCol ? row.getCell(dateCol) : undefined;
      const dateValue = dateCell?.value;
      const date = parseExcelDate(dateValue);

      if (!date) {
        console.log(`Skipping row ${rowNum}: no valid date`);
        continue;
      }

      // Helper to get column value
      const getColValue = (colName: string | undefined): string | undefined => {
        if (!colName) return undefined;
        const col = columnMap[colName];
        if (!col) return undefined;
        return getCellValue(row.getCell(col));
      };

      // Get flight details
      const flightNumber = getColValue(config.flightNumber);
      const departure = getColValue(config.departure);
      const arrival = getColValue(config.arrival);
      const dutyType = getColValue(config.dutyType);
      const aircraftType = getColValue(config.aircraftType);

      // Get times
      const depTimeStr = getColValue(config.departureTime);
      const arrTimeStr = getColValue(config.arrivalTime);
      const reportTimeStr = getColValue(config.reportTime);
      const releaseTimeStr = getColValue(config.releaseTime);

      // Calculate start and end times
      let startTime: Date;
      let endTime: Date;

      if (reportTimeStr) {
        startTime = combineDateAndTime(date, reportTimeStr);
      } else if (depTimeStr) {
        startTime = combineDateAndTime(date, depTimeStr);
      } else {
        startTime = new Date(date);
        startTime.setHours(0, 0, 0, 0);
      }

      if (releaseTimeStr) {
        endTime = combineDateAndTime(date, releaseTimeStr);
      } else if (arrTimeStr) {
        endTime = combineDateAndTime(date, arrTimeStr);
      } else {
        endTime = new Date(date);
        endTime.setHours(23, 59, 59, 999);
      }

      // Handle overnight flights (end time before start time)
      if (endTime < startTime) {
        endTime.setDate(endTime.getDate() + 1);
      }

      // Build the title
      let title = '';
      if (flightNumber) {
        title = flightNumber;
        if (departure && arrival) {
          title += ` ${departure}-${arrival}`;
        }
      } else if (dutyType) {
        title = dutyType;
      } else {
        title = 'Duty';
      }

      // Create the event
      const event: FlightEvent = {
        id: `xlsx-${rowNum - 1}-${date.toISOString().split('T')[0]}`,
        source: 'xlsx',
        title,
        startTime,
        endTime,
        allDay: !depTimeStr && !reportTimeStr,
        flightNumber,
        departure,
        arrival,
        aircraftType,
        dutyType,
        reportTime: reportTimeStr ? combineDateAndTime(date, reportTimeStr) : undefined,
        releaseTime: releaseTimeStr ? combineDateAndTime(date, releaseTimeStr) : undefined,
      };

      events.push(event);
    }

    console.log(`Parsed ${events.length} events from schedule`);
    return events;
  } catch (error) {
    if (error instanceof ScheduleParseError) throw error;
    throw new ScheduleParseError('Could not read the file as an XLSX schedule', { cause: error });
  }
}

/**
 * Parse an XLSX file from a file path
 */
export async function parseFlightScheduleFromFile(
  filePath: string,
  mapping: Partial<ColumnMapping> = {}
): Promise<FlightEvent[]> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    // Write to buffer and use the main parser
    const buffer = await workbook.xlsx.writeBuffer();
    return parseFlightSchedule(Buffer.from(buffer), mapping);
  } catch (error) {
    console.error('Failed to read XLSX file:', error);
    return [];
  }
}

/**
 * Get column headers from an XLSX file (for configuration UI)
 */
export async function getXlsxHeaders(buffer: Buffer | Uint8Array): Promise<string[]> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return [];
    }

    const headers: string[] = [];
    const headerRow = sheet.getRow(1);

    headerRow.eachCell((cell) => {
      const value = getCellValue(cell);
      if (value) {
        headers.push(value);
      }
    });

    return headers;
  } catch (error) {
    console.error('Failed to get XLSX headers:', error);
    return [];
  }
}
