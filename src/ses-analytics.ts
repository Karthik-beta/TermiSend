/**
 * SES Analytics Pipeline Module for TermiSend
 * Event-driven analytics system for AWS SES data collection and storage
 *
 * Implements:
 * - Internal event emitter for email lifecycle tracking
 * - Rate-limited API fetchers for SES analytics endpoints
 * - Database storage functions for historical data retention
 * - Polling coordinator for periodic sync operations
 *
 * AWS SES API Documentation:
 * - GetSendQuota: https://docs.aws.amazon.com/ses/latest/APIReference/API_GetSendQuota.html
 * - GetSendStatistics: https://docs.aws.amazon.com/ses/latest/APIReference/API_GetSendStatistics.html
 * - ListIdentities: https://docs.aws.amazon.com/ses/latest/APIReference/API_ListIdentities.html
 * - GetIdentityVerificationAttributes: https://docs.aws.amazon.com/ses/latest/APIReference/API_GetIdentityVerificationAttributes.html
 */

import type {
  GetIdentityVerificationAttributesCommandOutput,
  GetSendQuotaCommandOutput,
  GetSendStatisticsCommandOutput,
  ListIdentitiesCommandOutput,
  SendDataPoint,
} from '@aws-sdk/client-ses';
import { getAnalyticsRateLimitMs } from './config.js';
import {
  createMessageEvent,
  createQuotaSnapshot,
  createSendStatistics,
  getSendStatistics as dbGetSendStatistics,
  getLatestQuotaSnapshot,
  upsertIdentityStatus,
} from './db.js';
import { logger } from './logger.js';
import { getSesClient } from './ses-quota.js';
import type {
  AnalyticsEventType,
  IdentityStatus,
  IdentityVerificationStatus,
  MessageEvent,
  QuotaSnapshot,
  SendStatistics,
  SyncOptions,
  SyncResult,
} from './types.js';

// ============================================================================
// Event Emitter for Internal Analytics Events
// ============================================================================

/**
 * Handler function type for analytics events
 */
type AnalyticsEventHandler = (data: EventData) => void;

/**
 * Data payload for analytics events
 */
export interface EventData {
  messageId?: string;
  contactId: string;
  sendLogId: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

/**
 * Internal event emitter for analytics events
 * Simple implementation without external dependencies
 */
class AnalyticsEventEmitter {
  private handlers: Map<AnalyticsEventType, AnalyticsEventHandler[]> = new Map();

  /**
   * Emit an analytics event
   * @param event - Event type
   * @param data - Event data payload
   */
  emit(event: AnalyticsEventType, data: EventData): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          // Silently ignore handler errors to prevent disrupting the main flow
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Analytics event handler error for ${event}: ${errorMessage}`).catch(() => {
            // Ignore logging errors
          });
        }
      }
    }

    // Also persist to database asynchronously
    this.persistEvent(event, data).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to persist analytics event ${event}: ${errorMessage}`).catch(() => {
        // Ignore logging errors
      });
    });
  }

  /**
   * Subscribe to an analytics event
   * @param event - Event type to subscribe to
   * @param handler - Handler function to call when event is emitted
   */
  on(event: AnalyticsEventType, handler: AnalyticsEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)?.push(handler);
  }

  /**
   * Remove a handler from an event
   * @param event - Event type
   * @param handler - Handler function to remove
   */
  off(event: AnalyticsEventType, handler: AnalyticsEventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Persist event to database
   * @param eventType - Type of event
   * @param data - Event data
   */
  private async persistEvent(eventType: AnalyticsEventType, data: EventData): Promise<void> {
    const messageEvent: MessageEvent = {
      eventType,
      messageId: data.messageId,
      contactId: data.contactId,
      sendLogId: data.sendLogId,
      eventData: data.details ?? {},
      occurredAt: data.timestamp,
    };

    await createMessageEvent(messageEvent);
  }
}

// Singleton event emitter instance
const eventEmitter = new AnalyticsEventEmitter();

/**
 * Analytics events API
 * Provides emit/on methods for event-driven analytics
 */
export const analyticsEvents = {
  /**
   * Emit an analytics event
   * @param event - Event type
   * @param data - Event data payload
   */
  emit(event: AnalyticsEventType, data: EventData): void {
    eventEmitter.emit(event, data);
  },

  /**
   * Subscribe to an analytics event
   * @param event - Event type to subscribe to
   * @param handler - Handler function
   */
  on(event: AnalyticsEventType, handler: (data: EventData) => void): void {
    eventEmitter.on(event, handler);
  },

  /**
   * Unsubscribe from an analytics event
   * @param event - Event type
   * @param handler - Handler function to remove
   */
  off(event: AnalyticsEventType, handler: (data: EventData) => void): void {
    eventEmitter.off(event, handler);
  },
};

// ============================================================================
// Rate Limiter for SES Analytics APIs
// ============================================================================

/**
 * Rate limiter for SES analytics API calls
 * Enforces 1 request per second limit as per AWS documentation
 */
class AnalyticsRateLimiter {
  private lastRequestTime: number = 0;
  private minIntervalMs: number;

  constructor(minIntervalMs: number = 1000) {
    this.minIntervalMs = minIntervalMs;
  }

  /**
   * Wait until it's safe to make another request
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minIntervalMs) {
      const waitTime = this.minIntervalMs - timeSinceLastRequest;
      await delay(waitTime);
    }

    this.lastRequestTime = Date.now();
  }
}

// Singleton rate limiter instance
const rateLimiter = new AnalyticsRateLimiter(getAnalyticsRateLimitMs());

/**
 * Delay utility function
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Check if an error is a retryable AWS error
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { code?: string; name?: string; retryable?: boolean };
  const code = err.code || err.name;
  return (
    err.retryable === true ||
    code === 'Throttling' ||
    code === 'ThrottlingException' ||
    code === 'ServiceUnavailable' ||
    code === 'InternalFailure'
  );
}

// ============================================================================
// API Fetchers with Rate Limiting
// ============================================================================

/** Maximum retries for API calls */
const MAX_API_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 1000;

/** Maximum delay for exponential backoff (ms) - 10 seconds */
const MAX_BACKOFF_DELAY_MS = 10000;

/**
 * Handle retry with exponential backoff
 */
async function handleRetry(attempt: number, operation: string): Promise<boolean> {
  if (attempt < MAX_API_RETRIES - 1) {
    const rawBackoffMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
    const backoffMs = Math.min(rawBackoffMs, MAX_BACKOFF_DELAY_MS);
    const retryMsg = `${operation} retry ${attempt + 1}/${MAX_API_RETRIES} after ${backoffMs}ms`;
    await logger.warn(retryMsg);
    await delay(backoffMs);
    return true;
  }
  return false;
}

/**
 * Fetch quota snapshot from GetSendQuota API
 * @returns Quota snapshot or null if fetch fails
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetSendQuota.html
 */
export async function fetchQuotaSnapshot(): Promise<QuotaSnapshot | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    try {
      await rateLimiter.acquire();

      const { GetSendQuotaCommand } = await import('@aws-sdk/client-ses');
      const command = new GetSendQuotaCommand({});
      const response: GetSendQuotaCommandOutput = await getSesClient().send(command);

      await logger.logEvent('AWS_SES_REQ', {
        operation: 'GetSendQuota',
        params: {},
      });

      const snapshot: QuotaSnapshot = {
        max24HourSend: response.Max24HourSend || 0,
        maxSendRate: response.MaxSendRate || 0,
        sentLast24Hours: response.SentLast24Hours || 0,
        recordedAt: new Date(),
        source: 'api',
      };

      await logger.logEvent('AWS_SES_RES', {
        operation: 'GetSendQuota',
        max24HourSend: snapshot.max24HourSend,
        maxSendRate: snapshot.maxSendRate,
        sentLast24Hours: snapshot.sentLast24Hours,
      });

      return snapshot;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isRetryableError(error)) {
        const shouldRetry = await handleRetry(attempt, 'GetSendQuota');
        if (shouldRetry) {
          continue;
        }
      }

      break;
    }
  }

  const errorMsg = `GetSendQuota failed: ${lastError?.message}`;
  await logger.logError('SES Analytics', errorMsg, {
    attempts: MAX_API_RETRIES,
  });
  return null;
}

/**
 * Check if a data point is within the specified date range
 */
function isDataPointInRange(timestamp: Date, startDate?: Date, endDate?: Date): boolean {
  if (startDate && timestamp < startDate) {
    return false;
  }
  if (endDate && timestamp > endDate) {
    return false;
  }
  return true;
}

/**
 * Process a single data point into SendStatistics format
 */
function processDataPoint(point: SendDataPoint): SendStatistics {
  const timestamp = point.Timestamp ? new Date(point.Timestamp) : new Date();
  return {
    timestamp,
    deliveryAttempts: Number(point.DeliveryAttempts) || 0,
    bounces: Number(point.Bounces) || 0,
    complaints: Number(point.Complaints) || 0,
    rejects: Number(point.Rejects) || 0,
    fetchedAt: new Date(),
  };
}

/**
 * Fetch and process send statistics data points
 */
async function fetchAndProcessStatistics(
  startDate?: Date,
  endDate?: Date
): Promise<SendStatistics[]> {
  await rateLimiter.acquire();

  const { GetSendStatisticsCommand } = await import('@aws-sdk/client-ses');
  const command = new GetSendStatisticsCommand({});
  const response: GetSendStatisticsCommandOutput = await getSesClient().send(command);

  await logger.logEvent('AWS_SES_REQ', {
    operation: 'GetSendStatistics',
    params: {},
  });

  const statistics: SendStatistics[] = [];
  const dataPoints = response.SendDataPoints || [];

  for (const point of dataPoints) {
    const stats = processDataPoint(point);

    if (isDataPointInRange(stats.timestamp, startDate, endDate)) {
      statistics.push(stats);
    }
  }

  await logger.logEvent('AWS_SES_RES', {
    operation: 'GetSendStatistics',
    dataPoints: statistics.length,
  });

  return statistics.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Fetch send statistics from GetSendStatistics API
 * Returns data points for the last 14 days (AWS retention limit)
 * @param startDate - Optional start date filter
 * @param endDate - Optional end date filter
 * @returns Array of send statistics data points
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetSendStatistics.html
 */
export async function fetchSendStatistics(
  startDate?: Date,
  endDate?: Date
): Promise<SendStatistics[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    try {
      return await fetchAndProcessStatistics(startDate, endDate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isRetryableError(error)) {
        const shouldRetry = await handleRetry(attempt, 'GetSendStatistics');
        if (shouldRetry) {
          continue;
        }
      }

      break;
    }
  }

  const errorMsg = `GetSendStatistics failed: ${lastError?.message}`;
  await logger.logError('SES Analytics', errorMsg, {
    attempts: MAX_API_RETRIES,
  });
  return [];
}

/**
 * Fetch identity statuses from ListIdentities and GetIdentityVerificationAttributes APIs
 * @returns Array of identity status records
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_ListIdentities.html
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetIdentityVerificationAttributes.html
 */
export async function fetchIdentityStatuses(): Promise<IdentityStatus[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    try {
      // First, list all identities
      await rateLimiter.acquire();

      const { ListIdentitiesCommand } = await import('@aws-sdk/client-ses');
      const listCommand = new ListIdentitiesCommand({});
      const listResponse: ListIdentitiesCommandOutput = await getSesClient().send(listCommand);

      await logger.logEvent('AWS_SES_REQ', {
        operation: 'ListIdentities',
        params: {},
      });

      const identities = listResponse.Identities || [];

      await logger.logEvent('AWS_SES_RES', {
        operation: 'ListIdentities',
        identityCount: identities.length,
      });

      if (identities.length === 0) {
        return [];
      }

      // Then, get verification attributes for all identities
      await rateLimiter.acquire();

      const { GetIdentityVerificationAttributesCommand } = await import('@aws-sdk/client-ses');
      const verifyCommand = new GetIdentityVerificationAttributesCommand({
        Identities: identities,
      });
      const verifyResponse: GetIdentityVerificationAttributesCommandOutput =
        await getSesClient().send(verifyCommand);

      await logger.logEvent('AWS_SES_REQ', {
        operation: 'GetIdentityVerificationAttributes',
        params: {
          identityCount: identities.length,
        },
      });

      const attributes = verifyResponse.VerificationAttributes || {};
      const statuses: IdentityStatus[] = [];

      for (const identity of identities) {
        const attr = attributes[identity];
        const verificationStatus =
          (attr?.VerificationStatus as IdentityVerificationStatus) || 'NotStarted';

        statuses.push({
          identity,
          verificationStatus,
          dkimEnabled: false, // DKIM status requires separate API call
          dkimVerificationStatus: null,
          checkedAt: new Date(),
        });
      }

      await logger.logEvent('AWS_SES_RES', {
        operation: 'GetIdentityVerificationAttributes',
        identityCount: statuses.length,
      });

      return statuses;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isRetryableError(error)) {
        const shouldRetry = await handleRetry(attempt, 'Identity fetch');
        if (shouldRetry) {
          continue;
        }
      }

      break;
    }
  }

  const errorMsg = `FetchIdentityStatuses failed: ${lastError?.message}`;
  await logger.logError('SES Analytics', errorMsg, {
    attempts: MAX_API_RETRIES,
  });
  return [];
}

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Store a quota snapshot in the database
 * @param quota - Quota snapshot to store
 */
export async function storeQuotaSnapshot(quota: QuotaSnapshot): Promise<void> {
  try {
    await createQuotaSnapshot(quota);
    await logger.info(
      `Quota snapshot stored: ${quota.sentLast24Hours}/${quota.max24HourSend} sent`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'SES Analytics Storage',
      `Failed to store quota snapshot: ${errorMessage}`
    );
    throw error;
  }
}

/**
 * Store send statistics in the database
 * @param stats - Array of send statistics to store
 * @returns Number of new records inserted
 */
export async function storeSendStatistics(stats: SendStatistics[]): Promise<number> {
  if (stats.length === 0) {
    return 0;
  }

  try {
    const inserted = await createSendStatistics(stats);
    await logger.info(`Stored ${inserted} send statistics data points (${stats.length} total)`);
    return inserted;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'SES Analytics Storage',
      `Failed to store send statistics: ${errorMessage}`
    );
    throw error;
  }
}

/**
 * Store identity statuses in the database
 * @param identities - Array of identity statuses to store
 */
export async function storeIdentityStatuses(identities: IdentityStatus[]): Promise<void> {
  if (identities.length === 0) {
    return;
  }

  try {
    await upsertIdentityStatus(identities);
    await logger.info(`Stored ${identities.length} identity statuses`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'SES Analytics Storage',
      `Failed to store identity statuses: ${errorMessage}`
    );
    throw error;
  }
}

/**
 * Store a message event in the database
 * @param event - Message event to store
 */
export async function storeMessageEvent(event: MessageEvent): Promise<void> {
  try {
    await createMessageEvent(event);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'SES Analytics Storage',
      `Failed to store message event: ${errorMessage}`
    );
    throw error;
  }
}

// ============================================================================
// Polling Coordinator
// ============================================================================

/**
 * Sync all analytics data from SES APIs to database
 * Coordinates multiple API calls respecting rate limits
 * @param options - Sync options for filtering and behavior
 * @returns Sync result with counts and status
 */
export async function syncAllAnalytics(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    success: false,
    quotaSnapshotsStored: 0,
    sendStatisticsStored: 0,
    identityStatusesStored: 0,
  };

  try {
    await logger.info('Starting SES analytics sync...');

    // Fetch and store quota snapshot
    const quotaSnapshot = await fetchQuotaSnapshot();
    if (quotaSnapshot) {
      await storeQuotaSnapshot(quotaSnapshot);
      result.quotaSnapshotsStored = 1;
    }

    // Fetch and store send statistics
    const stats = await fetchSendStatistics(options.startDate, options.endDate);
    if (stats.length > 0) {
      result.sendStatisticsStored = await storeSendStatistics(stats);
    }

    // Fetch and store identity statuses
    const identities = await fetchIdentityStatuses();
    if (identities.length > 0) {
      await storeIdentityStatuses(identities);
      result.identityStatusesStored = identities.length;
    }

    result.success = true;
    const duration = Date.now() - startTime;
    await logger.info(
      `SES analytics sync completed in ${duration}ms: ` +
        `${result.quotaSnapshotsStored} quota, ` +
        `${result.sendStatisticsStored} statistics, ` +
        `${result.identityStatusesStored} identities`
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.error = errorMessage;
    await logger.logError('SES Analytics Sync', `Sync failed: ${errorMessage}`);
    return result;
  }
}

// ============================================================================
// Cache Utilities
// ============================================================================

/**
 * Get cached quota snapshot or fetch fresh data
 * @param maxAgeMs - Maximum age of cached data before refresh (default: 5 minutes)
 * @returns Quota snapshot (cached or fresh)
 */
export async function getQuotaSnapshotCached(
  maxAgeMs: number = 5 * 60 * 1000
): Promise<QuotaSnapshot | null> {
  // Try to get cached snapshot from database
  const cached = await getLatestQuotaSnapshot();

  if (cached) {
    const ageMs = Date.now() - new Date(cached.recordedAt).getTime();
    if (ageMs < maxAgeMs) {
      // Return cached data
      return {
        max24HourSend: cached.max24HourSend,
        maxSendRate: cached.maxSendRate,
        sentLast24Hours: cached.sentLast24Hours,
        recordedAt: cached.recordedAt,
        source: 'cached',
      };
    }
  }

  // Fetch fresh data
  const fresh = await fetchQuotaSnapshot();
  if (fresh) {
    await storeQuotaSnapshot(fresh);
  }
  return fresh;
}

/**
 * Get send statistics from database cache
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @returns Array of cached send statistics
 */
export async function getSendStatisticsCached(
  startDate: Date,
  endDate: Date
): Promise<SendStatistics[]> {
  const records = await dbGetSendStatistics(startDate, endDate);

  return records.map((record) => ({
    timestamp: record.timestamp,
    deliveryAttempts: Number(record.deliveryAttempts),
    bounces: Number(record.bounces),
    complaints: Number(record.complaints),
    rejects: Number(record.rejects),
    fetchedAt: record.fetchedAt,
  }));
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Test-only exports for dependency injection
 * @internal
 */
export const __test = {
  resetRateLimiter: (): void => {
    // Reset rate limiter state for testing
    // Accessing private field for test cleanup
    (rateLimiter as unknown as { lastRequestTime: number }).lastRequestTime = 0;
  },
  AnalyticsEventEmitter,
  AnalyticsRateLimiter,
};
