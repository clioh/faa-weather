/**
 * Update Service
 * Handles checking for and applying software updates via GitHub Releases
 *
 * Download integrity contract (scripts/update.sh relies on it):
 * - the tarball is downloaded to `.update-temp/release-<version>.tar.gz.part`;
 * - only when every byte arrived (Content-Length and the GitHub asset size) AND its
 *   SHA-256 equals the release's published `<asset>.sha256`, the .part is renamed to
 *   `release-<version>.tar.gz` and the digest is written to `release-<version>.tar.gz.sha256`;
 * - "download ready" means both files exist and the tarball still hashes to that digest
 *   (re-checked on every update check and right before launching update.sh, which also
 *   receives the digest via `--sha256` and re-verifies before extracting).
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  downloadToFile,
  fetchText,
  parseChecksum,
  sha256File,
} from './updateDownload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '../../../../');

// GitHub repository for releases
const GITHUB_REPO = process.env.GITHUB_REPO || 'YOUR_USERNAME/SkyGlass';
const REPO_PLACEHOLDER = /YOUR_USERNAME|^\s*$/;
const DEFAULT_GITHUB_API_BASE = 'https://api.github.com';
// Versions become file names; never let a tag name escape .update-temp.
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

export const NO_CHECKSUM_MESSAGE = 'Release has no checksum; refusing to install';
export const BAD_CHECKSUM_FILE_MESSAGE = 'Could not read the release checksum; refusing to install';
export const CHECKSUM_MISMATCH_MESSAGE =
  'Downloaded update failed checksum verification; try downloading again';
export const VERIFY_FAILED_MESSAGE =
  'Downloaded update is damaged or incomplete; please download it again';

/** Launches scripts/update.sh detached; injectable for tests. */
export type UpdateLauncher = (
  script: string,
  args: string[],
  opts: { cwd: string; outLog: string }
) => Promise<void>;

export interface UpdateServiceOptions {
  /** Repo checkout root (VERSION, package.json, scripts/, logs/). */
  projectRoot?: string;
  /** Download dir; default `<projectRoot>/.update-temp` or $SKYGLASS_UPDATE_TEMP_DIR. */
  tempDir?: string;
  /** Default https://api.github.com or $GITHUB_API_BASE. */
  githubApiBase?: string;
  /** Default `<projectRoot>/scripts/update.sh`. */
  updateScript?: string;
  /** Abort a download when no bytes arrive for this long. Default 60 s. */
  stallTimeoutMs?: number;
  /** Abort when the server does not answer with headers within this long. Default 30 s. */
  connectTimeoutMs?: number;
  launcher?: UpdateLauncher;
}

const defaultLauncher: UpdateLauncher = async (script, args, { cwd, outLog }) => {
  // It must run outside this process: it stops and restarts skyglass-backend,
  // i.e. us. `bash -c '... &'` double-forks so the script is reparented
  // away from this process and is not killed by PM2's tree-kill when the
  // backend is stopped. --delay gives us time to send the HTTP response.
  const child = spawn(
    '/bin/bash',
    ['-c', 'nohup "$0" "$@" >> "$UPDATE_OUT_LOG" 2>&1 < /dev/null &', script, ...args],
    {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, UPDATE_OUT_LOG: outLog },
    }
  );
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Failed to launch updater (exit ${code})`))
    );
  });
  child.unref();
};

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  downloadUrl: string;
  size: number;
  /** File name of the tarball asset (the .sha256 file names it). */
  assetName: string;
  /** browser_download_url of `<assetName>.sha256`, or null if the release has none. */
  checksumUrl: string | null;
}

export interface DownloadProgress {
  phase: 'idle' | 'downloading' | 'extracting' | 'installing' | 'complete' | 'error';
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
  error?: string;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseName: string;
  publishedAt: string;
  downloadSize: number;
  lastChecked: number;
  autoUpdateEnabled: boolean;
  autoDownloadEnabled: boolean;
  downloadReady: boolean; // Update has been downloaded and is ready to install
  downloadProgress: DownloadProgress;
  error?: string;
}

export interface UpdateConfig {
  autoUpdate: boolean;
  autoDownload: boolean; // Download updates automatically but don't install
  checkInterval: number;
  notifyOnly: boolean;
  githubRepo: string;
}

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');

  const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);
  while (partsA.length < maxLen) partsA.push(0);
  while (partsB.length < maxLen) partsB.push(0);

  for (let i = 0; i < maxLen; i++) {
    if (partsA[i] < partsB[i]) return -1;
    if (partsA[i] > partsB[i]) return 1;
  }

  return 0;
}

export class UpdateService extends EventEmitter {
  private status: UpdateStatus = {
    updateAvailable: false,
    currentVersion: '',
    latestVersion: '',
    releaseNotes: '',
    releaseName: '',
    publishedAt: '',
    downloadSize: 0,
    lastChecked: 0,
    autoUpdateEnabled: false,
    autoDownloadEnabled: false,
    downloadReady: false,
    downloadProgress: {
      phase: 'idle',
      bytesDownloaded: 0,
      totalBytes: 0,
      percent: 0,
      speed: 0,
      eta: 0,
    },
  };

  private config: UpdateConfig = {
    autoUpdate: false,
    autoDownload: true, // Download automatically by default
    checkInterval: 24,
    notifyOnly: true,
    githubRepo: GITHUB_REPO,
  };

  private latestRelease: ReleaseInfo | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private updateInProgress = false;
  private warnedNoRepo = false;
  private downloadedTarball: string | null = null;
  private downloading = false;

  private readonly projectRoot: string;
  private readonly tempDir: string;
  private readonly githubApiBase: string;
  private readonly updateScript: string;
  private readonly launcher: UpdateLauncher;
  private stallTimeoutMs: number;
  private connectTimeoutMs: number;

  constructor(options: UpdateServiceOptions = {}) {
    super();
    this.projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
    this.tempDir =
      options.tempDir ??
      process.env.SKYGLASS_UPDATE_TEMP_DIR ??
      path.join(this.projectRoot, '.update-temp');
    this.githubApiBase = (
      options.githubApiBase ??
      process.env.GITHUB_API_BASE ??
      DEFAULT_GITHUB_API_BASE
    ).replace(/\/+$/, '');
    this.updateScript = options.updateScript ?? path.join(this.projectRoot, 'scripts', 'update.sh');
    this.launcher = options.launcher ?? defaultLauncher;
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  /** Test hook: shorten the network timeouts. */
  setTimeouts(t: { stallTimeoutMs?: number; connectTimeoutMs?: number }): void {
    if (t.stallTimeoutMs !== undefined) this.stallTimeoutMs = t.stallTimeoutMs;
    if (t.connectTimeoutMs !== undefined) this.connectTimeoutMs = t.connectTimeoutMs;
  }

  /**
   * Initialize the update service
   */
  async init(config?: Partial<UpdateConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.status.autoUpdateEnabled = this.config.autoUpdate;
    this.status.autoDownloadEnabled = this.config.autoDownload;

    await this.getCurrentVersion();
    // A crash or power cut mid-download leaves a .part behind; it is never usable.
    this.removePartFiles();

    if (this.config.checkInterval > 0) {
      this.scheduleCheck();
    }

    console.log(
      `Update service initialized. Version: ${this.status.currentVersion}, Auto-download: ${this.config.autoDownload}, Auto-update: ${this.config.autoUpdate}`
    );
  }

  private scheduleCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    const intervalMs = this.config.checkInterval * 60 * 60 * 1000;
    this.checkTimer = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);

    setTimeout(() => this.checkForUpdates(), 30000);
  }

  private async getCurrentVersion(): Promise<string> {
    try {
      const versionFile = path.join(this.projectRoot, 'VERSION');
      if (fs.existsSync(versionFile)) {
        const version = fs.readFileSync(versionFile, 'utf-8').trim();
        this.status.currentVersion = version;
        return version;
      }

      const packageJson = path.join(this.projectRoot, 'package.json');
      if (fs.existsSync(packageJson)) {
        const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));
        this.status.currentVersion = pkg.version || '0.0.0';
        return this.status.currentVersion;
      }

      this.status.currentVersion = '0.0.0';
      return '0.0.0';
    } catch {
      this.status.currentVersion = '0.0.0';
      return '0.0.0';
    }
  }

  private tarballPathFor(version: string): string {
    return path.join(this.tempDir, `release-${version}.tar.gz`);
  }

  private removePartFiles(): void {
    try {
      for (const file of fs.readdirSync(this.tempDir)) {
        if (file.endsWith('.part')) {
          fs.rmSync(path.join(this.tempDir, file), { force: true });
        }
      }
    } catch {
      // temp dir does not exist yet
    }
  }

  private removeDownloaded(tarballPath: string): void {
    fs.rmSync(tarballPath, { force: true });
    fs.rmSync(`${tarballPath}.sha256`, { force: true });
  }

  /**
   * Is release-<version>.tar.gz a complete, verified download? Requires the tarball and
   * its .sha256 file, and recomputes the tarball's hash. Anything else (a leftover
   * partial file from an old crash, a missing/garbled .sha256, a mismatch) is deleted.
   */
  private async verifyDownloaded(version: string): Promise<string | null> {
    const tarballPath = this.tarballPathFor(version);
    const shaPath = `${tarballPath}.sha256`;
    const hasTarball = fs.existsSync(tarballPath);
    const hasSha = fs.existsSync(shaPath);
    if (!hasTarball && !hasSha) return null;
    if (!hasTarball || !hasSha) {
      console.warn(`Discarding incomplete update download for v${version}`);
      this.removeDownloaded(tarballPath);
      return null;
    }
    try {
      const expected = fs.readFileSync(shaPath, 'utf-8').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('bad .sha256 file');
      const actual = await sha256File(tarballPath);
      if (actual !== expected) throw new Error('checksum mismatch');
      return expected;
    } catch (error) {
      console.warn(
        `Discarding update download for v${version}: ${error instanceof Error ? error.message : String(error)}`
      );
      this.removeDownloaded(tarballPath);
      return null;
    }
  }

  private async fetchLatestRelease(): Promise<ReleaseInfo | null> {
    try {
      const url = `${this.githubApiBase}/repos/${this.config.githubRepo}/releases/latest`;
      const text = await fetchText(url, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        connectTimeoutMs: this.connectTimeoutMs,
        stallTimeoutMs: this.stallTimeoutMs,
      });
      let release: {
        tag_name: string;
        name: string;
        body: string;
        published_at: string;
        assets: Array<{
          name: string;
          browser_download_url: string;
          size: number;
        }>;
      };
      try {
        release = JSON.parse(text);
      } catch {
        throw new Error('Failed to parse GitHub API response');
      }

      const assets = Array.isArray(release.assets) ? release.assets : [];
      const tarball = assets.find((a) => a.name.endsWith('.tar.gz'));

      if (!tarball) {
        console.warn('No tarball found in latest release');
        return null;
      }

      const version = String(release.tag_name ?? '').replace(/^v/, '');
      if (!SAFE_VERSION.test(version)) {
        console.warn(`Ignoring release with unusable tag name: ${release.tag_name}`);
        return null;
      }

      const checksum = assets.find((a) => a.name === `${tarball.name}.sha256`);

      return {
        version,
        tag: release.tag_name,
        name: release.name,
        body: release.body,
        publishedAt: release.published_at,
        downloadUrl: tarball.browser_download_url,
        size: typeof tarball.size === 'number' ? tarball.size : 0,
        assetName: tarball.name,
        checksumUrl: checksum?.browser_download_url ?? null,
      };
    } catch (error) {
      console.warn(
        `Failed to fetch latest release from ${this.config.githubRepo}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /** Fetch and parse `<asset>.sha256`; throws with a user-facing message. */
  private async fetchExpectedChecksum(release: ReleaseInfo): Promise<string> {
    if (!release.checksumUrl) {
      throw new Error(NO_CHECKSUM_MESSAGE);
    }
    let text: string;
    try {
      text = await fetchText(release.checksumUrl, {
        maxBytes: 4096,
        connectTimeoutMs: this.connectTimeoutMs,
        stallTimeoutMs: this.stallTimeoutMs,
      });
    } catch (error) {
      console.warn(
        `Checksum download failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new Error(BAD_CHECKSUM_FILE_MESSAGE);
    }
    const digest = parseChecksum(text, release.assetName);
    if (!digest) {
      throw new Error(BAD_CHECKSUM_FILE_MESSAGE);
    }
    return digest;
  }

  private setProgress(progress: DownloadProgress): void {
    this.status.downloadProgress = progress;
    this.emit('downloadProgress', this.status.downloadProgress);
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateStatus> {
    if (this.updateInProgress) {
      return this.status;
    }

    if (REPO_PLACEHOLDER.test(this.config.githubRepo)) {
      if (!this.warnedNoRepo) {
        console.warn(
          'Update checks skipped: set GITHUB_REPO (owner/repo) to enable GitHub Releases updates'
        );
        this.warnedNoRepo = true;
      }
      this.status.error = 'Update source not configured';
      this.status.lastChecked = Date.now();
      return this.status;
    }

    console.log('Checking for updates via GitHub Releases...');

    try {
      const release = await this.fetchLatestRelease();

      if (!release) {
        this.status.error = 'Could not fetch release info';
        this.status.lastChecked = Date.now();
        return this.status;
      }

      this.latestRelease = release;

      const currentVersion = this.status.currentVersion;
      const latestVersion = release.version;
      const comparison = compareVersions(currentVersion, latestVersion);

      const updateAvailable = comparison < 0;

      // Ready only if a previous download completed AND still verifies. While a
      // download is running its .part is not looked at.
      const downloadReady = this.downloading
        ? false
        : (await this.verifyDownloaded(release.version)) !== null;
      this.downloadedTarball = downloadReady ? this.tarballPathFor(release.version) : null;

      this.status = {
        ...this.status,
        updateAvailable,
        currentVersion,
        latestVersion,
        releaseNotes: release.body || '',
        releaseName: release.name,
        publishedAt: release.publishedAt,
        downloadSize: release.size,
        lastChecked: Date.now(),
        downloadReady,
        error: undefined,
      };

      if (updateAvailable) {
        console.log(`Update available: ${currentVersion} → ${latestVersion}`);

        this.emit('updateAvailable', this.status);

        // Auto-download if configured (but not installed)
        if (this.config.autoDownload && !this.status.downloadReady) {
          console.log('Auto-downloading update...');
          await this.downloadUpdate();
        }

        // Auto-apply if configured
        if (this.config.autoUpdate && !this.config.notifyOnly && this.status.downloadReady) {
          console.log('Auto-update enabled. Applying updates...');
          await this.applyUpdates();
        }
      } else {
        console.log(`Already up to date (v${currentVersion})`);
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      this.status.error = error instanceof Error ? error.message : 'Unknown error';
      this.status.lastChecked = Date.now();
    }

    return this.status;
  }

  /**
   * Download update without installing
   */
  async downloadUpdate(): Promise<{ success: boolean; message: string }> {
    if (!this.status.updateAvailable || !this.latestRelease) {
      return { success: false, message: 'No updates available' };
    }

    if (this.status.downloadReady) {
      return { success: true, message: 'Update already downloaded' };
    }

    if (this.downloading) {
      return { success: false, message: 'Download already in progress' };
    }

    const release = this.latestRelease;
    const tarballPath = this.tarballPathFor(release.version);
    const partPath = `${tarballPath}.part`;
    this.downloading = true;

    try {
      // Start from a clean temp dir: nothing in it is a verified download (or
      // downloadReady would be true), including stray .part files.
      fs.mkdirSync(this.tempDir, { recursive: true });
      for (const file of fs.readdirSync(this.tempDir)) {
        fs.rmSync(path.join(this.tempDir, file), { recursive: true, force: true });
      }

      console.log(`Downloading update v${release.version}...`);

      this.setProgress({
        phase: 'downloading',
        bytesDownloaded: 0,
        totalBytes: release.size,
        percent: 0,
        speed: 0,
        eta: 0,
      });

      // Required: an unverifiable release is never installed.
      const expectedSha = await this.fetchExpectedChecksum(release);

      let bytesDownloaded = 0;
      let totalBytes = release.size;
      let lastTime = Date.now();
      let lastBytes = 0;
      const progressInterval = setInterval(() => {
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const speed = timeDiff > 0 ? (bytesDownloaded - lastBytes) / timeDiff : 0;
        const eta = speed > 0 ? Math.max(0, totalBytes - bytesDownloaded) / speed : 0;
        this.setProgress({
          phase: 'downloading',
          bytesDownloaded,
          totalBytes,
          percent: totalBytes > 0 ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)) : 0,
          speed: Math.round(speed),
          eta: Math.round(eta),
        });
        lastTime = now;
        lastBytes = bytesDownloaded;
      }, 500);

      let result;
      try {
        result = await downloadToFile(release.downloadUrl, partPath, {
          expectedSize: release.size,
          stallTimeoutMs: this.stallTimeoutMs,
          connectTimeoutMs: this.connectTimeoutMs,
          onProgress: (bytes, total) => {
            bytesDownloaded = bytes;
            if (total > 0) totalBytes = total;
          },
        });
      } finally {
        clearInterval(progressInterval);
      }

      if (result.sha256 !== expectedSha) {
        throw new Error(CHECKSUM_MISMATCH_MESSAGE);
      }

      // Atomic publish: the final name only ever holds a complete, verified file,
      // and the .sha256 (written last) marks it as such.
      fs.renameSync(partPath, tarballPath);
      const shaTmp = `${tarballPath}.sha256.part`;
      fs.writeFileSync(shaTmp, `${expectedSha}\n`);
      fs.renameSync(shaTmp, `${tarballPath}.sha256`);

      this.downloadedTarball = tarballPath;
      this.status.downloadReady = true;
      this.status.error = undefined;
      this.setProgress({
        phase: 'complete',
        bytesDownloaded: result.bytes,
        totalBytes: result.bytes,
        percent: 100,
        speed: 0,
        eta: 0,
      });

      console.log('Update downloaded and verified');
      this.emit('downloadComplete', this.status);

      return { success: true, message: 'Update downloaded successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      console.error('Download failed:', message);

      fs.rmSync(partPath, { force: true });
      fs.rmSync(`${tarballPath}.sha256.part`, { force: true });
      this.removeDownloaded(tarballPath);
      this.downloadedTarball = null;
      this.status.downloadReady = false;
      this.status.error = message;

      this.setProgress({
        phase: 'error',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        speed: 0,
        eta: 0,
        error: message,
      });

      return { success: false, message };
    } finally {
      this.downloading = false;
    }
  }

  /**
   * Apply downloaded updates
   */
  async applyUpdates(): Promise<{ success: boolean; message: string }> {
    if (this.updateInProgress) {
      return { success: false, message: 'Update already in progress' };
    }

    if (!this.status.downloadReady || !this.downloadedTarball) {
      // Try to download first
      if (this.status.updateAvailable && this.latestRelease) {
        const downloadResult = await this.downloadUpdate();
        if (!downloadResult.success) {
          return downloadResult;
        }
      } else {
        return { success: false, message: 'No updates available' };
      }
    }

    const version = this.latestRelease?.version || '';
    const tarballPath = this.downloadedTarball!;

    if (!fs.existsSync(this.updateScript)) {
      return { success: false, message: `Update script not found at ${this.updateScript}` };
    }

    // Re-verify right before installing: the file may have been damaged on disk
    // (SD card) since it was downloaded.
    this.updateInProgress = true;
    const sha256 = version ? await this.verifyDownloaded(version) : null;
    if (!sha256 || tarballPath !== this.tarballPathFor(version)) {
      this.updateInProgress = false;
      this.downloadedTarball = null;
      this.status.downloadReady = false;
      this.status.error = VERIFY_FAILED_MESSAGE;
      this.setProgress({
        phase: 'error',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        speed: 0,
        eta: 0,
        error: VERIFY_FAILED_MESSAGE,
      });
      return { success: false, message: VERIFY_FAILED_MESSAGE };
    }

    console.log(`Applying update to v${version}...`);

    try {
      this.setProgress({
        phase: 'installing',
        bytesDownloaded: this.status.downloadSize,
        totalBytes: this.status.downloadSize,
        percent: 100,
        speed: 0,
        eta: 0,
      });

      // The install (stop services, copy files, npm install, restart, health
      // check, rollback on failure) is done by scripts/update.sh so that the
      // shell and in-app update paths share one implementation that preserves
      // runtime state (venv, face_data, node_modules, data/, config.yaml).
      // update.sh re-verifies the tarball against --sha256 before extracting.
      const logDir = path.join(this.projectRoot, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const outLog = path.join(logDir, 'update-output.log');
      const args = [
        '--apply-tarball',
        tarballPath,
        '--delay',
        '3',
        '--version',
        version,
        '--sha256',
        sha256,
      ];
      await this.launcher(this.updateScript, args, { cwd: this.projectRoot, outLog });

      this.downloadedTarball = null;
      this.status.downloadReady = false;

      const message = `Update to v${version} started; SkyGlass will restart shortly`;
      console.log(`${message} (log: ${outLog})`);
      this.emit('updateStarted', { version });
      return { success: true, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      console.error('Update failed to start:', message);
      this.setProgress({
        phase: 'error',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        speed: 0,
        eta: 0,
        error: message,
      });
      // Nothing was stopped or modified yet; the current version keeps running.
      this.updateInProgress = false;
      return { success: false, message };
    }
    // On success updateInProgress stays true: this process is about to be
    // restarted by the update script and must not start a second update.
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  setConfig(config: Partial<UpdateConfig>): void {
    this.config = { ...this.config, ...config };
    this.status.autoUpdateEnabled = this.config.autoUpdate;
    this.status.autoDownloadEnabled = this.config.autoDownload;

    if (config.checkInterval !== undefined) {
      this.scheduleCheck();
    }
  }

  getConfig(): UpdateConfig {
    return { ...this.config };
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}

export const updateService = new UpdateService();
