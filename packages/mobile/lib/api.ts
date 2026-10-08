/**
 * SkyGlass API Client
 * Handles communication with the mirror's backend API
 */

import { ModuleInstance, MirrorLayout } from './modules';

export type { ModuleInstance, MirrorLayout };

export interface MirrorDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  version?: string;
  setupComplete?: boolean;
}

export interface SetupStatus {
  step: 'wifi' | 'airport' | 'location' | 'face' | 'complete';
  wifi_configured: boolean;
  airport_configured: boolean;
  location_configured: boolean;
  face_registered: boolean;
}

export interface Airport {
  icao: string;
  name: string;
  city: string;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseName: string;
  publishedAt: string;
  downloadSize: number;
  downloadReady: boolean;
  lastChecked?: string;
  downloadProgress: {
    phase: 'idle' | 'downloading' | 'extracting' | 'installing' | 'complete' | 'error';
    percent: number;
    speed: number;
    eta: number;
    bytesDownloaded?: number;
    error?: string;
  };
}

export interface LocationConfig {
  latitude: number;
  longitude: number;
  timezone: string;
}

class MirrorAPI {
  private baseUrl: string = '';
  private timeout = 10000;

  setBaseUrl(host: string, port: number = 3001) {
    this.baseUrl = `http://${host}:${port}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the presence server URL (port 5000)
   */
  private getPresenceUrl(): string {
    return this.baseUrl.replace(':3001', ':5000');
  }

  /**
   * Make a request to the main API server
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new Error('Mirror not connected. Call setBaseUrl first.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error?.message || error?.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  /**
   * Make a request to the presence server (port 5000)
   * Uses same timeout and error handling as main API
   */
  private async presenceRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const presenceUrl = this.getPresenceUrl();
    if (!presenceUrl || presenceUrl === ':5000') {
      throw new Error('Mirror not connected. Call setBaseUrl first.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${presenceUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error?.message || error?.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  // Health check
  async ping(): Promise<{ status: string; version: string }> {
    return this.request('/api/health');
  }

  // Discovery info (returns detailed mirror information)
  async getDiscoveryInfo(): Promise<{
    name: string;
    version: string;
    airport: string;
    addresses: string[];
    port: number;
    capabilities: string[];
    setupComplete: boolean;
  }> {
    return this.request('/api/discovery');
  }

  // Setup endpoints
  async getSetupStatus(): Promise<SetupStatus> {
    return this.request('/api/setup/status');
  }

  async searchAirports(query: string): Promise<Airport[]> {
    return this.request(`/api/setup/airports?q=${encodeURIComponent(query)}`);
  }

  async setAirport(icao: string): Promise<{ success: boolean }> {
    return this.request('/api/setup/airport', {
      method: 'POST',
      body: JSON.stringify({ icao }),
    });
  }

  async setLocation(location: LocationConfig): Promise<{ success: boolean }> {
    return this.request('/api/setup/location', {
      method: 'POST',
      body: JSON.stringify(location),
    });
  }

  async getLocation(): Promise<LocationConfig | null> {
    return this.request('/api/setup/location');
  }

  // Face registration
  async startFaceRegistration(name: string): Promise<{ sessionId: string }> {
    return this.request('/api/presence/register/start', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async uploadFaceImage(
    sessionId: string,
    imageBase64: string,
    imageIndex: number
  ): Promise<{ success: boolean; facesDetected: number }> {
    return this.request('/api/presence/register/image', {
      method: 'POST',
      body: JSON.stringify({ sessionId, image: imageBase64, index: imageIndex }),
    });
  }

  async completeFaceRegistration(
    sessionId: string
  ): Promise<{ success: boolean; userId: string }> {
    return this.request('/api/presence/register/complete', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  async getRegisteredFaces(): Promise<{ id: string; name: string; createdAt: string }[]> {
    return this.request('/api/presence/faces');
  }

  async deleteFace(faceId: string): Promise<{ success: boolean }> {
    return this.request(`/api/presence/faces/${encodeURIComponent(faceId)}`, {
      method: 'DELETE',
    });
  }

  // WiFi provisioning
  async getWifiNetworks(): Promise<{ ssid: string; signal: number; secure: boolean }[]> {
    return this.request('/api/wifi/scan');
  }

  async connectWifi(ssid: string, password: string): Promise<{ success: boolean }> {
    return this.request('/api/wifi/connect', {
      method: 'POST',
      body: JSON.stringify({ ssid, password }),
    });
  }

  async getWifiStatus(): Promise<{ connected: boolean; ssid?: string; ip?: string }> {
    return this.request('/api/wifi/status');
  }

  // Update endpoints
  async getUpdateStatus(): Promise<UpdateStatus> {
    return this.request('/api/update/status');
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return this.request('/api/update/check', { method: 'POST' });
  }

  async downloadUpdate(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/update/download', { method: 'POST' });
  }

  async applyUpdate(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/update/apply', { method: 'POST' });
  }

  // Config endpoints
  async getConfig(): Promise<Record<string, unknown>> {
    return this.request('/api/config');
  }

  async updateConfig(config: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request('/api/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // Aviation data
  async getMetar(icao: string): Promise<Record<string, unknown>> {
    return this.request(`/api/aviation/metar/${icao}`);
  }

  async getTaf(icao: string): Promise<Record<string, unknown>> {
    return this.request(`/api/aviation/taf/${icao}`);
  }

  // Layout management
  async getLayout(): Promise<MirrorLayout> {
    return this.request('/api/layout');
  }

  async updateLayout(layout: MirrorLayout): Promise<{ success: boolean; layout: MirrorLayout }> {
    return this.request('/api/layout', {
      method: 'PUT',
      body: JSON.stringify(layout),
    });
  }

  async addModule(module: ModuleInstance): Promise<{ success: boolean; module: ModuleInstance }> {
    return this.request('/api/layout/module', {
      method: 'POST',
      body: JSON.stringify(module),
    });
  }

  async getModule(instanceId: string): Promise<ModuleInstance> {
    return this.request(`/api/layout/module/${instanceId}`);
  }

  async updateModule(
    instanceId: string,
    updates: Partial<ModuleInstance>
  ): Promise<{ success: boolean; module: ModuleInstance }> {
    return this.request(`/api/layout/module/${instanceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteModule(instanceId: string): Promise<{ success: boolean }> {
    return this.request(`/api/layout/module/${instanceId}`, {
      method: 'DELETE',
    });
  }

  // OAuth token management
  async storeOAuthTokens(
    instanceId: string,
    tokens: {
      provider: string;
      accessToken: string;
      refreshToken?: string;
      tokenExpiry?: number;
    }
  ): Promise<{ success: boolean }> {
    return this.request(`/api/layout/oauth/${instanceId}`, {
      method: 'POST',
      body: JSON.stringify(tokens),
    });
  }

  async removeOAuthTokens(instanceId: string): Promise<{ success: boolean }> {
    return this.request(`/api/layout/oauth/${instanceId}`, {
      method: 'DELETE',
    });
  }

  // Saved layouts
  async getSavedLayouts(): Promise<
    { id: string; name: string; moduleCount: number; updatedAt: string }[]
  > {
    return this.request('/api/layout/saved');
  }

  async saveLayout(name: string): Promise<{ success: boolean; layout: MirrorLayout }> {
    return this.request('/api/layout/save', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async loadLayout(layoutId: string): Promise<{ success: boolean; layout: MirrorLayout }> {
    return this.request(`/api/layout/load/${layoutId}`, {
      method: 'POST',
    });
  }

  async deleteSavedLayout(layoutId: string): Promise<{ success: boolean }> {
    return this.request(`/api/layout/saved/${layoutId}`, {
      method: 'DELETE',
    });
  }

  async resetLayout(): Promise<{ success: boolean; layout: MirrorLayout }> {
    return this.request('/api/layout/reset', {
      method: 'POST',
    });
  }

  // ============================================================
  // USER-SPECIFIC LAYOUT METHODS
  // ============================================================

  /**
   * Get a user's active layout
   */
  async getUserLayout(userId: string): Promise<{
    id: string;
    name: string;
    modules: ModuleInstance[];
    updatedAt: string;
  }> {
    return this.request(`/api/users/${userId}/layout`);
  }

  /**
   * Update a user's active layout modules
   */
  async updateUserLayout(
    userId: string,
    modules: ModuleInstance[]
  ): Promise<{ success: boolean }> {
    return this.request(`/api/users/${userId}/layout`, {
      method: 'PUT',
      body: JSON.stringify({ modules }),
    });
  }

  /**
   * Get all layouts for a user
   */
  async getUserLayouts(userId: string): Promise<
    {
      id: string;
      name: string;
      modules: ModuleInstance[];
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }[]
  > {
    return this.request(`/api/users/${userId}/layouts`);
  }

  /**
   * Create a new layout for a user
   */
  async createUserLayout(
    userId: string,
    name: string,
    modules: ModuleInstance[] = []
  ): Promise<{
    id: string;
    name: string;
    modules: ModuleInstance[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }> {
    return this.request(`/api/users/${userId}/layouts`, {
      method: 'POST',
      body: JSON.stringify({ name, modules }),
    });
  }

  /**
   * Activate a specific layout for a user
   */
  async activateUserLayout(
    userId: string,
    layoutId: string
  ): Promise<{ success: boolean }> {
    return this.request(`/api/users/${userId}/layouts/${layoutId}/activate`, {
      method: 'POST',
    });
  }

  /**
   * Delete a user's layout
   */
  async deleteUserLayout(
    userId: string,
    layoutId: string
  ): Promise<{ success: boolean }> {
    return this.request(`/api/users/${userId}/layouts/${layoutId}`, {
      method: 'DELETE',
    });
  }

  // ============================================================
  // USER-SPECIFIC FACE ENROLLMENT
  // ============================================================

  /**
   * Start face enrollment for a specific user
   */
  async startUserFaceEnrollment(
    userId: string,
    name: string
  ): Promise<{ success: boolean; userId: string; userName: string; samplesNeeded: number }> {
    return this.presenceRequest(`/api/users/${userId}/enroll/start`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  /**
   * Capture a face sample for a user
   */
  async captureUserFaceSample(userId: string): Promise<{
    success: boolean;
    samplesCollected: number;
    samplesNeeded: number;
    complete: boolean;
    message?: string;
  }> {
    return this.presenceRequest(`/api/users/${userId}/enroll/capture`, {
      method: 'POST',
    });
  }

  /**
   * Complete face enrollment for a user
   */
  async completeUserFaceEnrollment(userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.presenceRequest(`/api/users/${userId}/enroll/complete`, {
      method: 'POST',
    });
  }

  /**
   * Check user's face enrollment status
   */
  async getUserFaceStatus(userId: string): Promise<{
    enrolled: boolean;
    samples: number;
    enrolledAt?: string;
    name?: string;
  }> {
    return this.presenceRequest(`/api/users/${userId}/face`);
  }

  /**
   * Delete user's face data from this mirror
   */
  async deleteUserFaceData(userId: string): Promise<{ success: boolean; message: string }> {
    return this.presenceRequest(`/api/users/${userId}/face`, {
      method: 'DELETE',
    });
  }
}

export const api = new MirrorAPI();
