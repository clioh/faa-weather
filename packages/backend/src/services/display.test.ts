import { describe, it, expect } from 'vitest';
import {
  LinuxDisplayController,
  parseWlrOutputs,
  probeLinuxDisplay,
  runCommand,
  type LinuxDisplayMethod,
  type Runner,
} from './display.js';

type Call = { file: string; args: string[]; input?: string; env?: NodeJS.ProcessEnv };

/** A Runner that answers from `replies` (keyed by program name) and records every call. */
function fakeRunner(replies: Record<string, string | Error>) {
  const calls: Call[] = [];
  const run: Runner = async (file, args, options = {}) => {
    calls.push({ file, args, input: options.input, env: options.env });
    const reply = replies[file] ?? new Error(`spawn ${file} ENOENT`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { run, calls };
}

const WLR_RANDR = `DSI-1 "Raspberry Pi touch display (DSI-1)"
  Enabled: no
HDMI-A-1 "Dell Inc. DELL SE2422H (HDMI-A-1)"
  Physical size: 527x296 mm
  Enabled: yes
  Modes:
    1920x1080 px, 60.000000 Hz (preferred, current)
`;

const noSession = { env: {}, runtimeDir: '/run/user/1000', listDir: async () => [] as string[] };

describe('runCommand', () => {
  it('feeds stdin and returns stdout', async () => {
    expect(await runCommand('cat', [], { input: 'pow 0\n' })).toBe('pow 0\n');
  });

  it('rejects on a non-zero exit, a missing program and a timeout', async () => {
    await expect(runCommand('false', [])).rejects.toThrow(/exited with 1/);
    await expect(runCommand('skyglass-no-such-program', [])).rejects.toThrow(/ENOENT/);
    await expect(runCommand('sleep', ['5'], { timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });
});

describe('parseWlrOutputs', () => {
  it('returns the unindented output names', () => {
    expect(parseWlrOutputs(WLR_RANDR)).toEqual(['DSI-1', 'HDMI-A-1']);
  });
});

describe('probeLinuxDisplay', () => {
  it('uses CEC only when the display answers', async () => {
    const { run } = fakeRunner({ 'cec-client': 'power status: standby\n' });
    expect(await probeLinuxDisplay({ run, ...noSession })).toEqual({ kind: 'cec' });
  });

  it('falls back to the Wayland HDMI output when CEC gets no answer', async () => {
    const { run, calls } = fakeRunner({ 'cec-client': 'power status: unknown\n', 'wlr-randr': WLR_RANDR });
    const method = await probeLinuxDisplay({
      run,
      env: {},
      runtimeDir: '/run/user/1000',
      listDir: async () => ['bus', 'wayland-0.lock', 'wayland-0'],
    });
    expect(method).toMatchObject({ kind: 'wayland', output: 'HDMI-A-1' });
    const wlr = calls.find((c) => c.file === 'wlr-randr');
    expect(wlr?.env).toMatchObject({ WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' });
  });

  it('uses X11 DPMS when there is no Wayland session', async () => {
    const { run } = fakeRunner({ xset: 'DPMS is Disabled\n' });
    const method = await probeLinuxDisplay({ run, ...noSession });
    expect(method).toMatchObject({ kind: 'x11', env: { DISPLAY: ':0' } });
  });

  it('returns null when nothing works', async () => {
    const { run } = fakeRunner({});
    expect(await probeLinuxDisplay({ run, ...noSession })).toBeNull();
  });
});

describe('LinuxDisplayController', () => {
  const wayland: LinuxDisplayMethod = { kind: 'wayland', output: 'HDMI-A-1', env: { WAYLAND_DISPLAY: 'wayland-0' } };

  it('switches the HDMI output off and on, once per change', async () => {
    const { run, calls } = fakeRunner({ 'wlr-randr': '' });
    const display = new LinuxDisplayController(async () => wayland, run);
    await display.init();
    await display.turnOff();
    await display.turnOff();
    await display.turnOn();
    expect(calls.map((c) => c.args)).toEqual([
      ['--output', 'HDMI-A-1', '--off'],
      ['--output', 'HDMI-A-1', '--on'],
    ]);
    expect(display.getState()).toBe('on');
  });

  it('sends CEC standby, then power on and active source', async () => {
    const { run, calls } = fakeRunner({ 'cec-client': '' });
    const display = new LinuxDisplayController(async () => ({ kind: 'cec' }), run);
    await display.init();
    await display.turnOff();
    await display.turnOn();
    expect(calls.map((c) => c.input)).toEqual(['standby 0\n', 'on 0\n', 'as\n']);
  });

  it('probes again later when the desktop session was not up yet', async () => {
    let clock = 0;
    const answers: (LinuxDisplayMethod | null)[] = [null, wayland];
    const { run, calls } = fakeRunner({ 'wlr-randr': '' });
    const display = new LinuxDisplayController(async () => answers.shift() ?? null, run, () => clock);
    await display.init();

    await display.turnOff(); // too soon to probe again
    expect(calls).toEqual([]);

    await display.turnOn();
    clock = LinuxDisplayController.PROBE_RETRY_MS;
    await display.turnOff();
    expect(calls.map((c) => c.args)).toEqual([['--output', 'HDMI-A-1', '--off']]);
  });

  it('waits for a probe in flight instead of starting another', async () => {
    let probes = 0;
    let finish: (m: LinuxDisplayMethod) => void = () => {};
    const { run, calls } = fakeRunner({ 'wlr-randr': '' });
    const display = new LinuxDisplayController(
      () => {
        probes += 1;
        return new Promise((resolve) => (finish = resolve));
      },
      run,
    );
    const init = display.init();
    const off = display.turnOff();
    finish(wayland);
    await Promise.all([init, off]);
    expect(probes).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('keeps its state and re-probes after a failed command', async () => {
    let probes = 0;
    const { run } = fakeRunner({ 'wlr-randr': new Error('compositor gone') });
    const display = new LinuxDisplayController(async () => (probes++, wayland), run, () => probes * 60_000);
    await display.init();
    await display.turnOff();
    expect(display.getState()).toBe('on');
    await display.turnOff();
    expect(probes).toBe(2);
  });
});
