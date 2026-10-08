/**
 * Update Service
 * Handles checking for and applying software updates via GitHub Releases
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import https from 'https';
import { createWriteStream } from 'fs';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const UPDATE_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'update.sh');

// GitHub repository for releases
const GITHUB_REPO = process.env.GITHUB_REPO || 'YOUR_USERNAME/SkyGlass';
const GITHUB_API_BASE = 'https://api.github.com';

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  downloadUrl: string;
  size: number;
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

/**
 * Make HTTPS request to GitHub API
 */
async function githubApiRequest<T>(endpoint: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const options = {
      headers: {
        'User-Agent': 'SkyGlass-Updater',
        Accept: 'application/vnd.github.v3+json',
      },
    };

    https
      .get(url, options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            https
              .get(redirectUrl, options, (redirectRes) => {
                let data = '';
                redirectRes.on('data', (chunk) => (data += chunk));
                redirectRes.on('end', () => {
                  try {
                    resolve(JSON.parse(data));
                  } catch {
                    reject(new Error('Failed to parse GitHub API response'));
                  }
                });
              })
              .on('error', reject);
          } else {
            reject(new Error('Redirect without location header'));
          }
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned status ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Failed to parse GitHub API response'));
          }
        });
      })
      .on('error', reject);
  });
}

class UpdateService extends EventEmitter {
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
  private downloadedTarball: string | null = null;
  private onUpdateAvailable?: (status: UpdateStatus) => void;

  /**
   * Initialize the update service
   */
  async init(
    config?: Partial<UpdateConfig>,
    onUpdateAvailable?: (status: UpdateStatus) => void
  ): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.onUpdateAvailable = onUpdateAvailable;
    this.status.autoUpdateEnabled = this.config.autoUpdate;
    this.status.autoDownloadEnabled = this.config.autoDownload;

    await this.getCurrentVersion();

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
      const versionFile = path.join(PROJECT_ROOT, 'VERSION');
      if (fs.existsSync(versionFile)) {
        const version = fs.readFileSync(versionFile, 'utf-8').trim();
        this.status.currentVersion = version;
        return version;
      }

      const packageJson = path.join(PROJECT_ROOT, 'package.json');
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

  private async fetchLatestRelease(): Promise<ReleaseInfo | null> {
    try {
      const endpoint = `/repos/${this.config.githubRepo}/releases/latest`;
      const release = await githubApiRequest<{
        tag_name: string;
        name: string;
        body: string;
        published_at: string;
        assets: Array<{
          name: string;
          browser_download_url: string;
          size: number;
        }>;
      }>(endpoint);

      const tarball = release.assets.find((a) => a.name.endsWith('.tar.gz'));

      if (!tarball) {
        console.warn('No tarball found in latest release');
        return null;
      }

      return {
        version: release.tag_name.replace(/^v/, ''),
        tag: release.tag_name,
        name: release.name,
        body: release.body,
        publishedAt: release.published_at,
        downloadUrl: tarball.browser_download_url,
        size: tarball.size,
      };
    } catch (error) {
      console.error('Failed to fetch latest release:', error);
      return null;
    }
  }

  /**
   * Download file with progress reporting
   */
  private downloadFileWithProgress(
    url: string,
    destPath: string,
    totalSize: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      let bytesDownloaded = 0;
      let lastTime = Date.now();
      let lastBytes = 0;

      const updateProgress = () => {
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const bytesDiff = bytesDownloaded - lastBytes;
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
        const remaining = totalSize - bytesDownloaded;
        const eta = speed > 0 ? remaining / speed : 0;

        this.status.downloadProgress = {
          phase: 'downloading',
          bytesDownloaded,
          totalBytes: totalSize,
          percent: totalSize > 0 ? Math.round((bytesDownloaded / totalSize) * 100) : 0,
          speed: Math.round(speed),
          eta: Math.round(eta),
        };

        this.emit('downloadProgress', this.status.downloadProgress);

        lastTime = now;
        lastBytes = bytesDownloaded;
      };

      const progressInterval = setInterval(updateProgress, 500);

      const makeRequest = (requestUrl: string) => {
        https
          .get(requestUrl, { headers: { 'User-Agent': 'SkyGlass-Updater' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              const redirectUrl = res.headers.location;
              if (redirectUrl) {
                makeRequest(redirectUrl);
                return;
              }
            }

            if (res.statusCode !== 200) {
              clearInterval(progressInterval);
              file.close();
              fs.unlinkSync(destPath);
              reject(new Error(`Download failed with status ${res.statusCode}`));
              return;
            }

            res.on('data', (chunk) => {
              bytesDownloaded += chunk.length;
            });

            res.pipe(file);

            file.on('finish', () => {
              clearInterval(progressInterval);
              file.close();
              this.status.downloadProgress = {
                phase: 'complete',
                bytesDownloaded: totalSize,
                totalBytes: totalSize,
                percent: 100,
                speed: 0,
                eta: 0,
              };
              this.emit('downloadProgress', this.status.downloadProgress);
              resolve();
            });
          })
          .on('error', (err) => {
            clearInterval(progressInterval);
            file.close();
            if (fs.existsSync(destPath)) {
              fs.unlinkSync(destPath);
            }
            reject(err);
          });
      };

      makeRequest(url);
    });
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateStatus> {
    if (this.updateInProgress) {
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

      // Check if we already have this update downloaded
      const tempDir = path.join(PROJECT_ROOT, '.update-temp');
      const expectedTarball = path.join(tempDir, `release-${release.version}.tar.gz`);
      const downloadReady = fs.existsSync(expectedTarball);

      if (downloadReady) {
        this.downloadedTarball = expectedTarball;
      }

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
      };

      if (updateAvailable) {
        console.log(`Update available: ${currentVersion} → ${latestVersion}`);

        if (this.onUpdateAvailable) {
          this.onUpdateAvailable(this.status);
        }

        this.emit('updateAvailable', this.status);

        // Auto-download if configured (but not installed)
        if (this.config.autoDownload && !downloadReady) {
          console.log('Auto-downloading update...');
          await this.downloadUpdate();
        }

        // Auto-apply if configured
        if (this.config.autoUpdate && !this.config.notifyOnly && downloadReady) {
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

    if (this.status.downloadProgress.phase === 'downloading') {
      return { success: false, message: 'Download already in progress' };
    }

    const tempDir = path.join(PROJECT_ROOT, '.update-temp');
    const tarballPath = path.join(tempDir, `release-${this.latestRelease.version}.tar.gz`);

    try {
      if (fs.existsSync(tempDir)) {
        // Clean old downloads but keep if same version
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          if (file !== `release-${this.latestRelease.version}.tar.gz`) {
            fs.rmSync(path.join(tempDir, file), { recursive: true });
          }
        }
      }
      fs.mkdirSync(tempDir, { recursive: true });

      console.log(`Downloading update v${this.latestRelease.version}...`);

      this.status.downloadProgress = {
        phase: 'downloading',
        bytesDownloaded: 0,
        totalBytes: this.latestRelease.size,
        percent: 0,
        speed: 0,
        eta: 0,
      };
      this.emit('downloadProgress', this.status.downloadProgress);

      await this.downloadFileWithProgress(
        this.latestRelease.downloadUrl,
        tarballPath,
        this.latestRelease.size
      );

      // Verify download
      const stats = fs.statSync(tarballPath);
      if (stats.size < 1000) {
        throw new Error('Downloaded file is too small');
      }

      this.downloadedTarball = tarballPath;
      this.status.downloadReady = true;
      this.status.downloadProgress.phase = 'complete';

      console.log('Update downloaded successfully');
      this.emit('downloadComplete', this.status);

      return { success: true, message: 'Update downloaded successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      console.error('Download failed:', message);

      this.status.downloadProgress = {
        phase: 'error',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        speed: 0,
        eta: 0,
        error: message,
      };
      this.emit('downloadProgress', this.status.downloadProgress);

      if (fs.existsSync(tarballPath)) {
        fs.unlinkSync(tarballPath);
      }

      return { success: false, message };
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

    if (fs.existsSync('/.dockerenv')) {
      return {
        success: false,
        message: 'Running in Docker: pull the new image and recreate the container instead',
      };
    }
    if (!fs.existsSync(UPDATE_SCRIPT)) {
      return { success: false, message: `Update script not found at ${UPDATE_SCRIPT}` };
    }
    if (!fs.existsSync(tarballPath)) {
      this.downloadedTarball = null;
      this.status.downloadReady = false;
      return { success: false, message: 'Downloaded update is missing, please download again' };
    }

    this.updateInProgress = true;
    console.log(`Applying update to v${version || 'unknown'}...`);

    try {
      this.status.downloadProgress = {
        phase: 'installing',
        bytesDownloaded: this.status.downloadSize,
        totalBytes: this.status.downloadSize,
        percent: 100,
        speed: 0,
        eta: 0,
      };
      this.emit('downloadProgress', this.status.downloadProgress);

      // The install (stop services, copy files, npm install, restart, health
      // check, rollback on failure) is done by scripts/update.sh so that the
      // shell and in-app update paths share one implementation that preserves
      // runtime state (venv, face_data, node_modules, data/, config.yaml).
      //
      // It must run outside this process: it stops and restarts skyglass-backend,
      // i.e. us. `bash -c '... &'` double-forks so the script is reparented
      // away from this process and is not killed by PM2's tree-kill when the
      // backend is stopped. --delay gives us time to send the HTTP response.
      const logDir = path.join(PROJECT_ROOT, 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const outLog = path.join(logDir, 'update-output.log');
      const args = ['--apply-tarball', tarballPath, '--delay', '3'];
      if (version) {
        args.push('--version', version);
      }
      const child = spawn(
        '/bin/bash',
        ['-c', 'nohup "$0" "$@" >> "$UPDATE_OUT_LOG" 2>&1 < /dev/null &', UPDATE_SCRIPT, ...args],
        {
          cwd: PROJECT_ROOT,
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

      this.downloadedTarball = null;
      this.status.downloadReady = false;

      const message = `Update to v${version || 'latest'} started; SkyGlass will restart shortly`;
      console.log(`${message} (log: ${outLog})`);
      this.emit('updateStarted', { version });
      return { success: true, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      console.error('Update failed to start:', message);
      this.status.downloadProgress = {
        phase: 'error',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        speed: 0,
        eta: 0,
        error: message,
      };
      this.emit('downloadProgress', this.status.downloadProgress);
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
