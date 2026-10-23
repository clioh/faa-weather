/**
 * Cloud API Client
 *
 * Handles communication with the SkyGlass cloud backend for:
 * - Layout synchronization
 * - Mirror registration
 * - Remote mirror access via relay
 */

import { getClerkInstance } from '@clerk/expo';

// API configuration
const CLOUD_API_URL = process.env.EXPO_PUBLIC_CLOUD_API_URL || 'https://api.skyglass.dev';
const REQUEST_TIMEOUT = 15000;

export interface CloudLayout {
  id: string;
  name: string;
  modules: ModuleConfig[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleConfig {
  instanceId: string;
  moduleType: string;
  position: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
  order?: number;
}

export interface CloudMirror {
  id: string;
  name: string;
  relayToken?: string;
  online: boolean;
  lastSeen: string | null;
  createdAt: string;
}

export interface SyncResult {
  layouts: CloudLayout[];
  syncedAt: string;
}

export interface SyncPushResult {
  updated: CloudLayout[];
  conflicts: { localId: string; serverVersion: number }[];
  syncedAt: string;
}

export interface RelayStatus {
  mirrorId: string;
  connected: boolean;
  online: boolean;
  lastSeen: string | null;
}

export class CloudAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CloudAPIError';
  }
}

class CloudAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = CLOUD_API_URL) {
    this.baseUrl = baseUrl;
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const clerk = getClerkInstance();
      const token = await clerk.session?.getToken();
      return token || null;
    } catch {
      return null;
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new CloudAPIError('Not authenticated', 401);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new CloudAPIError(
          errorBody.error || `Request failed with status ${response.status}`,
          response.status,
          errorBody.details
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof CloudAPIError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new CloudAPIError('Request timed out', 408);
      }

      throw new CloudAPIError(error instanceof Error ? error.message : 'Request failed');
    }
  }

  // ============ Layouts ============

  async getLayouts(): Promise<{ layouts: CloudLayout[] }> {
    return this.request('/api/layouts');
  }

  async getLayout(layoutId: string): Promise<CloudLayout> {
    return this.request(`/api/layouts/${layoutId}`);
  }

  async createLayout(
    name: string,
    modules: ModuleConfig[] = [],
    isActive: boolean = false
  ): Promise<CloudLayout> {
    return this.request('/api/layouts', {
      method: 'POST',
      body: JSON.stringify({ name, modules, isActive }),
    });
  }

  async updateLayout(
    layoutId: string,
    updates: { name?: string; modules?: ModuleConfig[]; isActive?: boolean }
  ): Promise<CloudLayout> {
    return this.request(`/api/layouts/${layoutId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteLayout(layoutId: string): Promise<void> {
    return this.request(`/api/layouts/${layoutId}`, {
      method: 'DELETE',
    });
  }

  // ============ Sync ============

  async syncPull(since?: string): Promise<SyncResult> {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.request(`/api/layouts/sync${params}`);
  }

  async syncPush(
    layouts: {
      id: string;
      name: string;
      modules: ModuleConfig[];
      isActive: boolean;
      version: number;
      updatedAt: string;
      deleted?: boolean;
    }[]
  ): Promise<SyncPushResult> {
    return this.request('/api/layouts/sync', {
      method: 'POST',
      body: JSON.stringify({ layouts }),
    });
  }

  // ============ Mirrors ============

  async getMirrors(): Promise<{ mirrors: CloudMirror[] }> {
    return this.request('/api/mirrors');
  }

  async getMirror(mirrorId: string): Promise<CloudMirror> {
    return this.request(`/api/mirrors/${mirrorId}`);
  }

  async registerMirror(mirrorId: string, name: string): Promise<CloudMirror> {
    return this.request('/api/mirrors', {
      method: 'POST',
      body: JSON.stringify({ id: mirrorId, name }),
    });
  }

  async unregisterMirror(mirrorId: string): Promise<void> {
    return this.request(`/api/mirrors/${mirrorId}`, {
      method: 'DELETE',
    });
  }

  async regenerateMirrorToken(mirrorId: string): Promise<CloudMirror> {
    return this.request(`/api/mirrors/${mirrorId}/regenerate-token`, {
      method: 'POST',
    });
  }

  // ============ Relay ============

  async getRelayStatus(mirrorId: string): Promise<RelayStatus> {
    return this.request(`/api/relay/${mirrorId}/status`);
  }

  async sendRelayCommand<T = unknown>(
    mirrorId: string,
    command: 'getLayout' | 'updateLayout' | 'getStatus' | 'displayOn' | 'displayOff',
    payload?: Record<string, unknown>
  ): Promise<{ success: boolean; data: T }> {
    return this.request(`/api/relay/${mirrorId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command, payload }),
    });
  }

  // ============ Health ============

  async checkHealth(): Promise<{
    status: string;
    timestamp: string;
    database: string;
    relay: { connectedMirrors: number };
  }> {
    // Health check doesn't require auth
    const response = await fetch(`${this.baseUrl}/api/health`);
    return response.json();
  }
}

// Export singleton instance
export const cloudAPI = new CloudAPIClient();

// Export class for testing/custom instances
export { CloudAPIClient };
