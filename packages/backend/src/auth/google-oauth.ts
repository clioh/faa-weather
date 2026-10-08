/**
 * Google OAuth 2.0 Authentication
 * Handles OAuth flow for Google Calendar access
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Token storage path (in project root/config)
const TOKEN_PATH = join(__dirname, '..', '..', '..', '..', 'config', 'google-token.json');

// OAuth scopes needed for calendar access
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

interface TokenData {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export class GoogleAuth {
  private oauth2Client;

  constructor(config: GoogleAuthConfig) {
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri || 'http://localhost:3001/api/auth/google/callback'
    );

    // Try to load existing token
    this.loadToken();
  }

  /**
   * Load stored token from file
   */
  private loadToken(): boolean {
    try {
      if (existsSync(TOKEN_PATH)) {
        const tokenData = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')) as TokenData;
        this.oauth2Client.setCredentials(tokenData);
        console.log('Google OAuth: Loaded stored token');
        return true;
      }
    } catch (error) {
      console.error('Failed to load Google token:', error);
    }
    return false;
  }

  /**
   * Save token to file
   */
  private saveToken(tokens: TokenData): void {
    try {
      writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('Google OAuth: Token saved');
    } catch (error) {
      console.error('Failed to save Google token:', error);
    }
  }

  /**
   * Generate authorization URL for user to visit
   */
  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleCallback(code: string): Promise<boolean> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      this.saveToken(tokens as TokenData);
      return true;
    } catch (error) {
      console.error('Failed to exchange code for tokens:', error);
      return false;
    }
  }

  /**
   * Check if we have valid credentials
   */
  isAuthenticated(): boolean {
    const credentials = this.oauth2Client.credentials;
    return !!(credentials && credentials.access_token);
  }

  /**
   * Get the OAuth2 client for API calls
   */
  getClient() {
    return this.oauth2Client;
  }

  /**
   * Refresh the access token if needed
   */
  async refreshIfNeeded(): Promise<boolean> {
    try {
      const credentials = this.oauth2Client.credentials;
      if (!credentials.expiry_date) return true;

      // Refresh if token expires in less than 5 minutes
      const expiresIn = credentials.expiry_date - Date.now();
      if (expiresIn < 5 * 60 * 1000) {
        console.log('Google OAuth: Refreshing token...');
        const { credentials: newCredentials } = await this.oauth2Client.refreshAccessToken();
        this.saveToken(newCredentials as TokenData);
      }
      return true;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return false;
    }
  }

  /**
   * Revoke the current token (for logout)
   */
  async revoke(): Promise<void> {
    try {
      const token = this.oauth2Client.credentials.access_token;
      if (token) {
        await this.oauth2Client.revokeToken(token);
      }
      this.oauth2Client.setCredentials({});
      if (existsSync(TOKEN_PATH)) {
        writeFileSync(TOKEN_PATH, '{}');
      }
      console.log('Google OAuth: Token revoked');
    } catch (error) {
      console.error('Failed to revoke token:', error);
    }
  }
}

// Singleton instance (initialized when config is loaded)
let googleAuth: GoogleAuth | null = null;

export function initGoogleAuth(config: GoogleAuthConfig): GoogleAuth {
  googleAuth = new GoogleAuth(config);
  return googleAuth;
}

export function getGoogleAuth(): GoogleAuth | null {
  return googleAuth;
}
