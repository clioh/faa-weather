/**
 * Email Poller Service
 * Polls IMAP inbox for XLSX schedule attachments
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { parseFlightSchedule, FlightEvent, ColumnMapping } from './schedule-parser.js';

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  folder: string;
  senderFilter?: string; // Only process emails from this sender
  subjectFilter?: string; // Only process emails with this in subject
}

export interface EmailPollResult {
  success: boolean;
  newSchedule: boolean;
  events: FlightEvent[];
  lastEmailDate?: Date;
  error?: string;
}

export class EmailPoller {
  private config: EmailConfig;
  private columnMapping: Partial<ColumnMapping>;
  private cachedEvents: FlightEvent[] = [];

  constructor(config: EmailConfig, columnMapping: Partial<ColumnMapping> = {}) {
    this.config = config;
    this.columnMapping = columnMapping;
  }

  /**
   * Connect to IMAP and fetch new schedule emails
   */
  async poll(): Promise<EmailPollResult> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.tls,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      logger: false,
    });

    let newEvents: FlightEvent[] = [];
    let foundNewSchedule = false;
    let lastEmailDate: Date | undefined;

    try {
      await client.connect();

      const lock = await client.getMailboxLock(this.config.folder);

      try {
        // Build search query
        const searchQuery: Record<string, unknown> = { seen: false };

        if (this.config.senderFilter) {
          searchQuery.from = this.config.senderFilter;
        }

        // Search for unread messages
        const searchResult = await client.search(searchQuery, { uid: true });
        const uids = searchResult === false ? [] : searchResult;

        if (uids.length === 0) {
          console.log('No new schedule emails found');
          return {
            success: true,
            newSchedule: false,
            events: this.cachedEvents,
          };
        }

        console.log(`Found ${uids.length} new emails to process`);

        // Fetch and process each message
        for (const uid of uids) {
          const message = await client.fetchOne(String(uid), {
            source: true,
          });

          if (message === false || !message.source) continue;

          try {
            const parsed = await simpleParser(message.source);
            const processResult = await this.processEmail(parsed);

            if (processResult.events.length > 0) {
              newEvents = processResult.events;
              foundNewSchedule = true;
              lastEmailDate = parsed.date || undefined;
            }
          } catch (parseErr) {
            console.error('Failed to parse email:', parseErr);
          }
        }

        if (foundNewSchedule) {
          this.cachedEvents = newEvents;
        }

        return {
          success: true,
          newSchedule: foundNewSchedule,
          events: foundNewSchedule ? newEvents : this.cachedEvents,
          lastEmailDate,
        };
      } finally {
        lock.release();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('IMAP error:', error);
      return {
        success: false,
        newSchedule: false,
        events: this.cachedEvents,
        error: `IMAP error: ${error.message}`,
      };
    } finally {
      await client.logout();
    }
  }

  /**
   * Process a single email for XLSX attachments
   */
  private async processEmail(
    email: ParsedMail
  ): Promise<{ events: FlightEvent[] }> {
    // Check subject filter if specified
    if (this.config.subjectFilter) {
      const subject = email.subject || '';
      if (!subject.toLowerCase().includes(this.config.subjectFilter.toLowerCase())) {
        console.log(`Skipping email: subject doesn't match filter`);
        return { events: [] };
      }
    }

    // Find XLSX attachments
    const attachments = email.attachments || [];
    const xlsxAttachments = attachments.filter(
      (att: Attachment) =>
        att.filename?.endsWith('.xlsx') ||
        att.filename?.endsWith('.xls') ||
        att.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        att.contentType === 'application/vnd.ms-excel'
    );

    if (xlsxAttachments.length === 0) {
      console.log('No XLSX attachments found in email');
      return { events: [] };
    }

    console.log(`Found ${xlsxAttachments.length} XLSX attachment(s)`);

    // Parse the first XLSX attachment
    const attachment = xlsxAttachments[0];
    const buffer = attachment.content;

    const events = await parseFlightSchedule(buffer, this.columnMapping);
    console.log(`Parsed ${events.length} events from email attachment`);

    return { events };
  }

  /**
   * Get cached events (from last successful poll)
   */
  getCachedEvents(): FlightEvent[] {
    return this.cachedEvents;
  }

  /**
   * Update column mapping
   */
  setColumnMapping(mapping: Partial<ColumnMapping>): void {
    this.columnMapping = mapping;
  }
}

/**
 * Create an email poller from config
 */
export function createEmailPoller(
  config: {
    imap_host: string;
    imap_port: number;
    username: string;
    password: string;
    folder: string;
    sender_filter?: string;
  },
  columnMapping: Partial<ColumnMapping> = {}
): EmailPoller {
  return new EmailPoller(
    {
      host: config.imap_host,
      port: config.imap_port,
      user: config.username,
      password: config.password,
      tls: true,
      folder: config.folder,
      senderFilter: config.sender_filter,
    },
    columnMapping
  );
}
