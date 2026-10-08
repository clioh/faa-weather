/**
 * Display Control Service
 * Controls display power based on presence detection
 *
 * Mac: Uses brightness CLI or caffeinate for sleep prevention
 * Linux/Pi: Uses HDMI CEC (cec-client) or DPMS
 */

import { exec, spawn, ChildProcess } from 'child_process';
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
 * Detect the current platform and available display control methods
 */
async function detectPlatform(): Promise<'mac' | 'linux-cec' | 'linux-dpms' | 'unknown'> {
  const platform = process.platform;

  if (platform === 'darwin') {
    return 'mac';
  }

  if (platform === 'linux') {
    // Check for CEC support (Raspberry Pi)
    try {
      await execAsync('which cec-client');
      return 'linux-cec';
    } catch {
      // Fall back to DPMS
      try {
        await execAsync('which xset');
        return 'linux-dpms';
      } catch {
        return 'unknown';
      }
    }
  }

  return 'unknown';
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

/**
 * Linux CEC Display Controller (Raspberry Pi)
 * Uses cec-client to control HDMI display
 */
class LinuxCecController implements DisplayController {
  private state: DisplayState = 'on';

  async turnOn(): Promise<void> {
    if (this.state === 'on') return;

    try {
      // CEC command to turn on TV (on 0 = TV)
      await execAsync('echo "on 0" | cec-client -s -d 1');
      // Also set as active source
      await execAsync('echo "as" | cec-client -s -d 1');
      this.state = 'on';
      console.log('Display turned ON via CEC');
    } catch (error) {
      console.error('Failed to turn on display via CEC:', error);
    }
  }

  async turnOff(): Promise<void> {
    if (this.state === 'off') return;

    try {
      // CEC command to set TV to standby
      await execAsync('echo "standby 0" | cec-client -s -d 1');
      this.state = 'off';
      console.log('Display turned OFF via CEC');
    } catch (error) {
      console.error('Failed to turn off display via CEC:', error);
    }
  }

  async dim(_level: number): Promise<void> {
    // CEC doesn't support dimming - ignore
    console.log('CEC does not support brightness control');
  }

  getState(): DisplayState {
    return this.state;
  }
}

/**
 * Linux DPMS Display Controller
 * Uses xset for display power management
 */
class LinuxDpmsController implements DisplayController {
  private state: DisplayState = 'on';

  async turnOn(): Promise<void> {
    if (this.state === 'on') return;

    try {
      await execAsync('xset dpms force on');
      this.state = 'on';
      console.log('Display turned ON via DPMS');
    } catch (error) {
      console.error('Failed to turn on display via DPMS:', error);
    }
  }

  async turnOff(): Promise<void> {
    if (this.state === 'off') return;

    try {
      await execAsync('xset dpms force off');
      this.state = 'off';
      console.log('Display turned OFF via DPMS');
    } catch (error) {
      console.error('Failed to turn off display via DPMS:', error);
    }
  }

  async dim(_level: number): Promise<void> {
    // DPMS doesn't support dimming
    console.log('DPMS does not support brightness control');
  }

  getState(): DisplayState {
    return this.state;
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

  constructor() {
    this.controller = new StubDisplayController();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const platform = await detectPlatform();
    console.log(`Detected display platform: ${platform}`);

    switch (platform) {
      case 'mac':
        this.controller = new MacDisplayController();
        await (this.controller as MacDisplayController).init();
        break;
      case 'linux-cec':
        this.controller = new LinuxCecController();
        break;
      case 'linux-dpms':
        this.controller = new LinuxDpmsController();
        break;
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
      // Start timeout before turning off
      this.presenceTimeout = setTimeout(async () => {
        this.isPresent = false;
        await this.controller.turnOff();
      }, timeoutMs);

      console.log(`Presence lost - display will turn off in ${timeoutMs / 1000}s`);
    }
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
