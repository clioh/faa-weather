/**
 * Display Control Service
 * Controls display power based on presence detection
 *
 * Mac: Uses brightness CLI or caffeinate for sleep prevention
 * Linux/Pi: HDMI-CEC when the display answers it (TVs), otherwise turns the
 * HDMI output off so the monitor sleeps: wlr-randr on Wayland (current
 * Raspberry Pi OS), xset DPMS on X11. See probeLinuxDisplay().
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { readdir } from 'fs/promises';
import { promisify } from 'util';
import { loadConfig } from '../config/index.js';

const execAsync = promisify(exec);

export type DisplayState = 'on' | 'off' | 'dimmed';

interface DisplayController {
  turnOn(): Promise<void>;
  turnOff(): Promise<void>;
  dim(level: number): Promise<void>;
  getState(): DisplayState;
}

/**
 * Mac Display Controller
 * Uses brightness CLI if available, otherwise uses caffeinate
 */
class MacDisplayController implements DisplayController {
  private state: DisplayState = 'on';
  private caffeinateProcess: ChildProcess | null = null;
  private hasBrightness = false;

  async init(): Promise<void> {
    // Check if brightness CLI is installed
    try {
      await execAsync('which brightness');
      this.hasBrightness = true;
    } catch {
      this.hasBrightness = false;
      console.log('brightness CLI not found - using caffeinate for sleep prevention');
    }
  }

  async turnOn(): Promise<void> {
    if (this.state === 'on') return;

    try {
      // Wake display
      await execAsync('caffeinate -u -t 1');

      if (this.hasBrightness) {
        const config = loadConfig();
        const brightness = (config.display.brightness || 80) / 100;
        await execAsync(`brightness ${brightness}`);
      }

      // Keep display awake while present
      if (!this.caffeinateProcess) {
        this.caffeinateProcess = spawn('caffeinate', ['-d', '-i'], {
          detached: true,
          stdio: 'ignore',
        });
        this.caffeinateProcess.unref();
      }

      this.state = 'on';
      console.log('Display turned ON');
    } catch (error) {
      console.error('Failed to turn on display:', error);
    }
  }

  async turnOff(): Promise<void> {
    if (this.state === 'off') return;

    try {
      // Stop caffeinate
      if (this.caffeinateProcess) {
        this.caffeinateProcess.kill();
        this.caffeinateProcess = null;
      }

      if (this.hasBrightness) {
        // Dim to minimum
        await execAsync('brightness 0');
      } else {
        // Put display to sleep
        await execAsync('pmset displaysleepnow');
      }

      this.state = 'off';
      console.log('Display turned OFF');
    } catch (error) {
      console.error('Failed to turn off display:', error);
    }
  }

  async dim(level: number): Promise<void> {
    if (!this.hasBrightness) return;

    try {
      const brightness = Math.max(0, Math.min(1, level / 100));
      await execAsync(`brightness ${brightness}`);
      this.state = level > 0 ? 'dimmed' : 'off';
    } catch (error) {
      console.error('Failed to dim display:', error);
    }
  }

  getState(): DisplayState {
    return this.state;
  }
}

/** Runs a program without a shell; resolves its stdout, rejects on a non-zero exit or timeout. */
export type Runner = (
  file: string,
  args: string[],
  options?: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<string>;

export const runCommand: Runner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: options.env ?? process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${file} timed out`));
    }, options.timeoutMs ?? 10_000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${file} exited with ${code}: ${stderr.trim()}`));
    });
    child.stdin.on('error', () => {}); // EPIPE when the program exits before reading
    child.stdin.end(options.input ?? '');
  });

export type LinuxDisplayMethod =
  | { kind: 'cec' }
  | { kind: 'wayland'; output: string; env: NodeJS.ProcessEnv }
  | { kind: 'x11'; env: NodeJS.ProcessEnv };

const CEC_ARGS = ['-s', '-d', '1'];
const CEC_TIMEOUT_MS = 15_000;

/** Output names from `wlr-randr` (unindented lines start an output, e.g. `HDMI-A-1 "Dell ..."`). */
export function parseWlrOutputs(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => /^\S/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

export interface ProbeOptions {
  run?: Runner;
  env?: NodeJS.ProcessEnv;
  /** Where the Wayland socket lives. Default: $XDG_RUNTIME_DIR, else /run/user/<uid>. */
  runtimeDir?: string;
  listDir?: (dir: string) => Promise<string[]>;
}

/**
 * How to switch the mirror's display on and off, or null if nothing works yet.
 *
 * 1. HDMI-CEC, only if the display answers a power query. cec-client is
 *    installed on every mirror, and most computer monitors ignore CEC.
 * 2. Wayland: turn the HDMI output off with wlr-randr; the monitor sleeps on
 *    loss of signal. The backend runs under PM2, outside the desktop session,
 *    so the session's socket is found in the runtime directory.
 * 3. X11: DPMS with xset on display :0.
 */
export async function probeLinuxDisplay(options: ProbeOptions = {}): Promise<LinuxDisplayMethod | null> {
  const run = options.run ?? runCommand;
  const env = options.env ?? process.env;
  const listDir = options.listDir ?? ((dir: string) => readdir(dir));

  try {
    const answer = await run('cec-client', CEC_ARGS, { input: 'pow 0\n', timeoutMs: CEC_TIMEOUT_MS });
    if (/power status:\s*(on|standby|in transition)/i.test(answer)) return { kind: 'cec' };
  } catch {
    // cec-client missing or no CEC adapter
  }

  const runtimeDir = options.runtimeDir ?? env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
  let socket = env.WAYLAND_DISPLAY;
  if (!socket) {
    try {
      socket = (await listDir(runtimeDir)).filter((name) => /^wayland-\d+$/.test(name)).sort()[0];
    } catch {
      // no runtime directory: no desktop session
    }
  }
  if (socket) {
    const waylandEnv = { ...env, XDG_RUNTIME_DIR: runtimeDir, WAYLAND_DISPLAY: socket };
    try {
      const outputs = parseWlrOutputs(await run('wlr-randr', [], { env: waylandEnv }));
      const output = outputs.find((name) => name.startsWith('HDMI')) ?? outputs[0];
      if (output) return { kind: 'wayland', output, env: waylandEnv };
    } catch {
      // wlr-randr missing, or not a wlroots compositor
    }
  }

  const x11Env = { ...env, DISPLAY: env.DISPLAY || ':0' };
  try {
    await run('xset', ['q'], { env: x11Env });
    return { kind: 'x11', env: x11Env };
  } catch {
    return null;
  }
}

type Command = [file: string, args: string[], options?: Parameters<Runner>[2]];

function describe(method: LinuxDisplayMethod): string {
  switch (method.kind) {
    case 'cec':
      return 'HDMI-CEC';
    case 'wayland':
      return `Wayland output ${method.output} (wlr-randr)`;
    case 'x11':
      return 'X11 DPMS (xset)';
  }
}

function commandsFor(method: LinuxDisplayMethod, target: 'on' | 'off'): Command[] {
  switch (method.kind) {
    case 'cec': {
      const cec = (input: string): Command => ['cec-client', CEC_ARGS, { input, timeoutMs: CEC_TIMEOUT_MS }];
      // "as" makes the Pi the active source, so the TV switches to its input.
      return target === 'on' ? [cec('on 0\n'), cec('as\n')] : [cec('standby 0\n')];
    }
    case 'wayland':
      return [['wlr-randr', ['--output', method.output, target === 'on' ? '--on' : '--off'], { env: method.env }]];
    case 'x11':
      // Older X11 images: keep DPMS off except to force the display off, so
      // X never blanks the mirror on its own timer.
      return target === 'on'
        ? [['xset', ['dpms', 'force', 'on'], { env: method.env }], ['xset', ['-dpms'], { env: method.env }]]
        : [['xset', ['+dpms', 'dpms', 'force', 'off'], { env: method.env }]];
  }
}

/**
 * Linux / Raspberry Pi display controller (see probeLinuxDisplay). The backend
 * can start before the desktop session, so when no method is found it probes
 * again on a later on/off request, at most every PROBE_RETRY_MS. A failed
 * command also triggers a new probe (e.g. the session restarted).
 */
export class LinuxDisplayController implements DisplayController {
  static readonly PROBE_RETRY_MS = 30_000;

  private state: DisplayState = 'on';
  private method: LinuxDisplayMethod | null = null;
  private lastProbe = -Infinity;
  private probing: Promise<void> | null = null;

  constructor(
    private readonly probe: () => Promise<LinuxDisplayMethod | null> = () => probeLinuxDisplay(),
    private readonly run: Runner = runCommand,
    private readonly now: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    await this.reprobe();
  }

  async turnOn(): Promise<void> {
    if (this.state === 'on') return;
    await this.apply('on');
  }

  async turnOff(): Promise<void> {
    if (this.state === 'off') return;
    await this.apply('off');
  }

  async dim(_level: number): Promise<void> {
    // None of the Linux methods can dim; the mirror UI handles brightness.
  }

  getState(): DisplayState {
    return this.state;
  }

  /** One probe at a time; callers during a probe wait for it. */
  private reprobe(): Promise<void> {
    this.probing ??= (async () => {
      this.lastProbe = this.now();
      this.method = await this.probe();
      console.log(
        this.method
          ? `Display control: ${describe(this.method)}`
          : 'Display control: none yet (no CEC display answered, no Wayland or X11 session); will retry',
      );
    })().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private async apply(target: 'on' | 'off'): Promise<void> {
    if (this.probing) {
      await this.probing;
    } else if (!this.method && this.now() - this.lastProbe >= LinuxDisplayController.PROBE_RETRY_MS) {
      await this.reprobe();
    }
    const method = this.method;
    if (!method) {
      this.state = target;
      console.log(`Display ${target.toUpperCase()} (no display control available)`);
      return;
    }
    try {
      for (const [file, args, options] of commandsFor(method, target)) {
        await this.run(file, args, options);
      }
      this.state = target;
      console.log(`Display turned ${target.toUpperCase()} via ${describe(method)}`);
    } catch (error) {
      this.method = null;
      console.error(`Failed to turn display ${target} via ${describe(method)}:`, error);
    }
  }
}

/**
 * Stub controller for unsupported platforms
 */
class StubDisplayController implements DisplayController {
  private state: DisplayState = 'on';

  async turnOn(): Promise<void> {
    this.state = 'on';
    console.log('[STUB] Display ON');
  }

  async turnOff(): Promise<void> {
    this.state = 'off';
    console.log('[STUB] Display OFF');
  }

  async dim(level: number): Promise<void> {
    this.state = level > 0 ? 'dimmed' : 'off';
    console.log(`[STUB] Display dimmed to ${level}%`);
  }

  getState(): DisplayState {
    return this.state;
  }
}

/**
 * Display Manager
 * Handles presence-based display control with timeouts and transitions
 */
export class DisplayManager {
  private controller: DisplayController;
  private presenceTimeout: NodeJS.Timeout | null = null;
  private isPresent = false;
  private initialized = false;
  /** While set, presence loss does not turn the display off (layout editing). */
  private holdUntil: number | null = null;
  private holdTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.controller = new StubDisplayController();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    switch (process.platform) {
      case 'darwin': {
        const controller = new MacDisplayController();
        await controller.init();
        this.controller = controller;
        break;
      }
      case 'linux': {
        // Asking a CEC display for its power state takes seconds; probe in
        // the background. Requests made meanwhile wait for the probe.
        const controller = new LinuxDisplayController();
        void controller.init();
        this.controller = controller;
        break;
      }
      default:
        console.log('No display control available - using stub');
        this.controller = new StubDisplayController();
    }

    this.initialized = true;
  }

  /**
   * Handle presence state change from detector
   */
  async handlePresence(present: boolean, _confidence: number): Promise<void> {
    const config = loadConfig();
    const timeoutMs = (config.display.presence_timeout || 120) * 1000;

    // Clear any pending timeout
    if (this.presenceTimeout) {
      clearTimeout(this.presenceTimeout);
      this.presenceTimeout = null;
    }

    if (present) {
      this.isPresent = true;
      await this.controller.turnOn();
    } else {
      this.isPresent = false;
      if (this.isHeld()) {
        console.log('Presence lost - display held on by the app, not turning off');
        return;
      }
      // Start timeout before turning off
      this.presenceTimeout = setTimeout(async () => {
        await this.controller.turnOff();
      }, timeoutMs);

      console.log(`Presence lost - display will turn off in ${timeoutMs / 1000}s`);
    }
  }

  /**
   * Keep the display on for `ttlMs` regardless of presence, e.g. while the
   * phone app previews a layout. Calling again extends the hold. When it
   * expires (or is released) the normal presence timeout takes over.
   */
  async hold(ttlMs: number): Promise<number> {
    if (this.presenceTimeout) {
      clearTimeout(this.presenceTimeout);
      this.presenceTimeout = null;
    }
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
    }
    this.holdUntil = Date.now() + ttlMs;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.holdUntil = null;
      console.log('Display hold expired');
      void this.handlePresence(this.isPresent, 0);
    }, ttlMs);
    await this.controller.turnOn();
    return this.holdUntil;
  }

  async release(): Promise<void> {
    if (!this.isHeld()) return;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.holdUntil = null;
    await this.handlePresence(this.isPresent, 0);
  }

  isHeld(): boolean {
    return this.holdUntil !== null && this.holdUntil > Date.now();
  }

  /**
   * Force display on (e.g., for manual override)
   */
  async forceOn(): Promise<void> {
    if (this.presenceTimeout) {
      clearTimeout(this.presenceTimeout);
      this.presenceTimeout = null;
    }
    await this.controller.turnOn();
  }

  /**
   * Force display off
   */
  async forceOff(): Promise<void> {
    if (this.presenceTimeout) {
      clearTimeout(this.presenceTimeout);
      this.presenceTimeout = null;
    }
    await this.controller.turnOff();
  }

  /**
   * Get current display state
   */
  getState(): DisplayState {
    return this.controller.getState();
  }

  /**
   * Check if someone is currently detected as present
   */
  isUserPresent(): boolean {
    return this.isPresent;
  }
}

// Export singleton instance
export const displayManager = new DisplayManager();
