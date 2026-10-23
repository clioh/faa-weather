import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { ScheduleService } from './schedule.js';
import { ScheduleParseError } from './schedule-parser.js';

async function roster(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roster');
  sheet.addRow(['Date', 'Flight', 'Dep', 'Arr', 'ETD', 'ETA']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('ScheduleService: the uploaded schedule survives a restart', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-schedule-'));
    file = path.join(dir, 'flight-schedule.xlsx');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps the upload and restores it in a new service', async () => {
    const first = new ScheduleService({ columnMapping: {}, file });
    const loaded = await first.loadScheduleFromBuffer(await roster([['2030-03-01', 'AA100', 'JFK', 'LAX', '08:00', '11:30']]));
    expect(loaded).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);

    const restarted = new ScheduleService({ columnMapping: {}, file });
    let changed = 0;
    restarted.onChange = () => changed++;
    await restarted.restore();
    expect(restarted.getFlightEvents().map((f) => f.flightNumber)).toEqual(['AA100']);
    expect(changed).toBe(1);
  });

  it('a rejected upload keeps the saved schedule', async () => {
    const service = new ScheduleService({ columnMapping: {}, file });
    await service.loadScheduleFromBuffer(await roster([['2030-03-01', 'AA100', 'JFK', 'LAX', '08:00', '11:30']]));
    const saved = fs.readFileSync(file);
    await expect(service.loadScheduleFromBuffer(await roster([]))).rejects.toBeInstanceOf(ScheduleParseError);
    expect(fs.readFileSync(file).equals(saved)).toBe(true);
    expect(service.getFlightEvents()).toHaveLength(1);
  });

  it('clear() removes the schedule and the file', async () => {
    const service = new ScheduleService({ columnMapping: {}, file });
    await service.loadScheduleFromBuffer(await roster([['2030-03-01', 'AA100', 'JFK', 'LAX', '08:00', '11:30']]));
    service.clear();
    expect(service.getFlightEvents()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
    service.clear(); // nothing to remove: no throw
  });

  it('restore() without a file, or with a corrupt one, leaves the schedule empty', async () => {
    const none = new ScheduleService({ columnMapping: {}, file });
    await none.restore();
    expect(none.getFlightEvents()).toEqual([]);

    fs.writeFileSync(file, 'not a spreadsheet');
    const corrupt = new ScheduleService({ columnMapping: {}, file });
    await corrupt.restore();
    expect(corrupt.getFlightEvents()).toEqual([]);
  });
});
