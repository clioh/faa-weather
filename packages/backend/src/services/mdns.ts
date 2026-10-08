/**
 * mDNS Service Discovery
 *
 * Advertises the SkyGlass backend on the local network via mDNS/Bonjour.
 * Mobile apps can discover mirrors by scanning for '_skyglass._tcp' services.
 */

import { Bonjour, Service } from 'bonjour-service';
import { networkInterfaces, hostname } from 'os';

interface MdnsServiceOptions {
  name?: string;
  port: number;
  mirrorId?: string;
  version?: string;
}

class MdnsService {
  private bonjour: Bonjour | null = null;
  private publishedService: Service | null = null;
  private isRunning = false;

  /**
   * Get the local IP addresses (non-localhost)
   */
  private getLocalIpAddresses(): string[] {
    const interfaces = networkInterfaces();
    const addresses: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const info of iface) {
        // Skip internal/loopback addresses and IPv6
        if (info.internal || info.family !== 'IPv4') continue;
        addresses.push(info.address);
      }
    }

    return addresses;
  }

  /**
   * Generate a unique mirror ID based on hostname and MAC
   */
  private generateMirrorId(): string {
    const host = hostname().toLowerCase().replace(/[^a-z0-9]/g, '');
    const timestamp = Date.now().toString(36).slice(-4);
    return `mirror-${host}-${timestamp}`;
  }

  /**
   * Start advertising the SkyGlass service
   */
  async start(options: MdnsServiceOptions): Promise<void> {
    if (this.isRunning) {
      console.log('[mDNS] Service already running');
      return;
    }

    const {
      name = `SkyGlass-${hostname()}`,
      port,
      mirrorId = this.generateMirrorId(),
      version = '0.1.0',
    } = options;

    try {
      this.bonjour = new Bonjour();

      const ipAddresses = this.getLocalIpAddresses();
      const primaryIp = ipAddresses[0] || 'unknown';

      // Publish the service with metadata
      this.publishedService = this.bonjour!.publish({
        name,
        type: 'skyglass',
        protocol: 'tcp',
        port,
        txt: {
          // Service metadata that mobile apps can read
          id: mirrorId,
          version,
          api: '/api',
          ws: `ws://${primaryIp}:${port}`,
          ip: primaryIp,
        },
      });

      this.isRunning = true;

      console.log('[mDNS] Service published:');
      console.log(`  Name: ${name}`);
      console.log(`  Type: _skyglass._tcp`);
      console.log(`  Port: ${port}`);
      console.log(`  Mirror ID: ${mirrorId}`);
      console.log(`  IP Addresses: ${ipAddresses.join(', ')}`);
    } catch (error) {
      console.error('[mDNS] Failed to start service:', error);
      throw error;
    }
  }

  /**
   * Stop advertising the service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      if (this.publishedService) {
        this.publishedService.stop?.();
        this.publishedService = null;
      }

      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }

      this.isRunning = false;
      console.log('[mDNS] Service stopped');
    } catch (error) {
      console.error('[mDNS] Error stopping service:', error);
    }
  }

  /**
   * Check if service is running
   */
  isAdvertising(): boolean {
    return this.isRunning;
  }

  /**
   * Get service info
   */
  getServiceInfo(): { name: string; port: number; addresses: string[] } | null {
    if (!this.publishedService) return null;

    return {
      name: this.publishedService.name,
      port: this.publishedService.port,
      addresses: this.getLocalIpAddresses(),
    };
  }
}

// Export singleton instance
export const mdnsService = new MdnsService();
