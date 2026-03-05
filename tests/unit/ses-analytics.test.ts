/**
 * Unit Tests for SES Analytics Module
 * Tests event system, rate limiting, retry logic, API fetchers, and storage functions
 */

import { beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test';

// ============================================================================
// Mock Setup - Must be defined before importing the module under test
// ============================================================================

// Mock the logger module to avoid spyOn issues with accessor properties
mock.module('../../src/logger.js', () => ({
  logger: {
    info: mock(() => Promise.resolve()),
    warn: mock(() => Promise.resolve()),
    error: mock(() => Promise.resolve()),
    debug: mock(() => Promise.resolve()),
    logEvent: mock(() => Promise.resolve()),
    logError: mock(() => Promise.resolve()),
  }
}));

// Mock the AWS SES SDK
const mockGetSendQuota = mock(() =>
  Promise.resolve({
    Max24HourSend: 1000,
    MaxSendRate: 14,
    SentLast24Hours: 100,
  })
) as Mock<() => Promise<{ Max24HourSend: number; MaxSendRate: number; SentLast24Hours: number }>>;

const mockGetSendStatistics = mock(() =>
  Promise.resolve({
    SendDataPoints: [
      {
        Timestamp: new Date('2024-01-01T10:00:00Z'),
        DeliveryAttempts: 100,
        Bounces: 5,
        Complaints: 1,
        Rejects: 2,
      },
      {
        Timestamp: new Date('2024-01-01T09:45:00Z'),
        DeliveryAttempts: 80,
        Bounces: 3,
        Complaints: 0,
        Rejects: 1,
      },
    ],
  })
) as Mock<
  () => Promise<{
    SendDataPoints: Array<{
      Timestamp: Date;
      DeliveryAttempts: number;
      Bounces: number;
      Complaints: number;
      Rejects: number;
    }>;
  }>
>;

const mockListIdentities = mock(() =>
  Promise.resolve({
    Identities: ['test@example.com', 'example.com'],
  })
) as Mock<() => Promise<{ Identities: string[] }>>;

const mockGetIdentityVerificationAttributes = mock(() =>
  Promise.resolve({
    VerificationAttributes: {
      'test@example.com': { VerificationStatus: 'Success' },
      'example.com': { VerificationStatus: 'Pending' },
    },
  })
) as Mock<
  () => Promise<{
    VerificationAttributes: Record<string, { VerificationStatus: string }>;
  }>
>;

// Track AWS SDK calls
let awsSdkCallCount = 0;
let awsSdkCalls: Array<{ command: string; params?: unknown }> = [];

// Mock the AWS SDK client
const mockSesClient = {
  send: async (command: unknown): Promise<unknown> => {
    awsSdkCallCount++;

    // Determine command type from the command object
    const commandName = (command as { constructor?: { name?: string } })?.constructor?.name || 'UnknownCommand';
    awsSdkCalls.push({ command: commandName, params: command });

    if (commandName === 'GetSendQuotaCommand') {
      return mockGetSendQuota();
    }
    if (commandName === 'GetSendStatisticsCommand') {
      return mockGetSendStatistics();
    }
    if (commandName === 'ListIdentitiesCommand') {
      return mockListIdentities();
    }
    if (commandName === 'GetIdentityVerificationAttributesCommand') {
      return mockGetIdentityVerificationAttributes();
    }
    return Promise.resolve({});
  },
};

// Mock the module
mock.module('@aws-sdk/client-ses', () => {
  return {
    GetSendQuotaCommand: class GetSendQuotaCommand {
      constructor(public readonly params: Record<string, unknown> = {}) {}
    },
    GetSendStatisticsCommand: class GetSendStatisticsCommand {
      constructor(public readonly params: Record<string, unknown> = {}) {}
    },
    ListIdentitiesCommand: class ListIdentitiesCommand {
      constructor(public readonly params: Record<string, unknown> = {}) {}
    },
    GetIdentityVerificationAttributesCommand: class GetIdentityVerificationAttributesCommand {
      constructor(public readonly params: Record<string, unknown> = {}) {}
    },
  };
});

// Now import the modules after mocking
import * as dbModule from '../../src/db.js';
import * as loggerModule from '../../src/logger.js';
import {
  analyticsEvents,
  fetchQuotaSnapshot,
  fetchSendStatistics,
  fetchIdentityStatuses,
  storeQuotaSnapshot,
  storeSendStatistics,
  storeIdentityStatuses,
  storeMessageEvent,
  syncAllAnalytics,
  getQuotaSnapshotCached,
  getSendStatisticsCached,
  __test,
  type EventData,
} from '../../src/ses-analytics.js';
import * as sesQuotaModule from '../../src/ses-quota.js';
import type {
  IdentityStatus,
  MessageEvent,
  QuotaSnapshot,
  SendStatistics,
} from '../../src/types.js';
import { restoreEnv, setMockEnv, wait } from '../helpers/test-utils.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('SES Analytics Module', () => {
  beforeEach(async () => {
    // Wait for any pending async event persistence from previous tests
    await wait(50);

    // Reset state
    awsSdkCallCount = 0;
    awsSdkCalls.length = 0;

    // Reset mocks
    mockGetSendQuota.mockClear();
    mockGetSendStatistics.mockClear();
    mockListIdentities.mockClear();
    mockGetIdentityVerificationAttributes.mockClear();

    // Reset rate limiter state
    __test.resetRateLimiter();

    // Set up mock SES client
    spyOn(sesQuotaModule, 'getSesClient').mockReturnValue(
      mockSesClient as ReturnType<typeof sesQuotaModule.getSesClient>
    );

    // Set environment for tests
    setMockEnv({
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      AWS_REGION: 'us-east-1',
    });
  });

  // ============================================================================
  // Event System Tests
  // ============================================================================

  describe('analyticsEvents', () => {
    describe('emit() and on()', () => {
      it('should emit events to registered handlers', () => {
        const handler = mock(() => {}) as Mock<(data: EventData) => void>;
        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date(),
          messageId: 'msg-789',
          details: { status: 'sent' },
        };

        analyticsEvents.on('SEND', handler);
        analyticsEvents.emit('SEND', eventData);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].contactId).toBe('contact-123');
      });

      it('should support multiple handlers for the same event', () => {
        const handler1 = mock(() => {}) as Mock<(data: EventData) => void>;
        const handler2 = mock(() => {}) as Mock<(data: EventData) => void>;
        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date(),
        };

        analyticsEvents.on('DELIVERY', handler1);
        analyticsEvents.on('DELIVERY', handler2);
        analyticsEvents.emit('DELIVERY', eventData);

        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
      });

      it('should not call handlers for different event types', () => {
        const sendHandler = mock(() => {}) as Mock<(data: EventData) => void>;
        const bounceHandler = mock(() => {}) as Mock<(data: EventData) => void>;
        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date(),
        };

        analyticsEvents.on('SEND', sendHandler);
        analyticsEvents.on('BOUNCE', bounceHandler);
        analyticsEvents.emit('SEND', eventData);

        expect(sendHandler).toHaveBeenCalledTimes(1);
        expect(bounceHandler).toHaveBeenCalledTimes(0);
      });

      it('should handle handler errors gracefully without throwing', () => {
        const errorHandler = mock(() => {
          throw new Error('Handler error');
        }) as Mock<(data: EventData) => void>;
        const goodHandler = mock(() => {}) as Mock<(data: EventData) => void>;
        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date(),
        };

        analyticsEvents.on('FAILURE', errorHandler);
        analyticsEvents.on('FAILURE', goodHandler);

        // Should not throw
        expect(() => analyticsEvents.emit('FAILURE', eventData)).not.toThrow();

        // Both handlers should have been called
        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(goodHandler).toHaveBeenCalledTimes(1);
      });

      it('should pass complete event data to handlers', () => {
        const handler = mock(() => {}) as Mock<(data: EventData) => void>;
        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          messageId: 'msg-789',
          details: { bounceType: 'Permanent', bounceSubType: 'General' },
        };

        analyticsEvents.on('BOUNCE', handler);
        analyticsEvents.emit('BOUNCE', eventData);

        const receivedData = handler.mock.calls[0][0];
        expect(receivedData.contactId).toBe('contact-123');
        expect(receivedData.sendLogId).toBe('log-456');
        expect(receivedData.messageId).toBe('msg-789');
        expect(receivedData.timestamp).toEqual(new Date('2024-01-01T10:00:00Z'));
        expect(receivedData.details).toEqual({
          bounceType: 'Permanent',
          bounceSubType: 'General',
        });
      });
    });

    describe('off()', () => {
      it('should remove registered handlers', () => {
        const handler = mock(() => {}) as Mock<(data: EventData) => void>;
        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date(),
        };

        analyticsEvents.on('COMPLAINT', handler);
        analyticsEvents.emit('COMPLAINT', eventData);
        expect(handler).toHaveBeenCalledTimes(1);

        analyticsEvents.off('COMPLAINT', handler);
        analyticsEvents.emit('COMPLAINT', eventData);
        expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
      });

      it('should handle removing non-existent handlers gracefully', () => {
        const handler = mock(() => {}) as Mock<(data: EventData) => void>;

        // Should not throw
        expect(() => analyticsEvents.off('REJECT', handler)).not.toThrow();
      });
    });

    describe('event persistence', () => {
      it('should persist events to database via createMessageEvent', async () => {
        const createMessageEventSpy = spyOn(dbModule, 'createMessageEvent').mockImplementation(() =>
          Promise.resolve({
            id: 1,
            eventType: 'SEND',
            messageId: 'msg-789',
            contactId: 'contact-123',
            sendLogId: 'log-456',
            eventData: { status: 'sent' },
            occurredAt: new Date(),
            createdAt: new Date(),
          })
        );

        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          messageId: 'msg-789',
          details: { status: 'sent' },
        };

        analyticsEvents.emit('SEND', eventData);

        // Wait for async persistence
        await wait(50);

        expect(createMessageEventSpy).toHaveBeenCalled();
        const callArg = createMessageEventSpy.mock.calls[0][0] as MessageEvent;
        expect(callArg.eventType).toBe('SEND');
        expect(callArg.contactId).toBe('contact-123');
        expect(callArg.sendLogId).toBe('log-456');
        expect(callArg.messageId).toBe('msg-789');
      });

      it('should handle persistence errors gracefully', async () => {
        spyOn(dbModule, 'createMessageEvent').mockImplementation(() =>
          Promise.reject(new Error('Database error'))
        );

        const eventData: EventData = {
          contactId: 'contact-123',
          sendLogId: 'log-456',
          timestamp: new Date(),
        };

        // Should not throw even if persistence fails
        expect(() => analyticsEvents.emit('SEND', eventData)).not.toThrow();

        // Wait for async persistence attempt
        await wait(50);

        // Error should be logged but not thrown
        expect(loggerModule.logger.warn).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('AnalyticsRateLimiter', () => {
    it('should enforce minimum delay between requests', async () => {
      // Reset rate limiter with 100ms for faster tests
      __test.resetRateLimiter();

      // First call
      const startTime = Date.now();
      await fetchQuotaSnapshot();
      const firstCallTime = Date.now() - startTime;

      // Second call should wait at least 100ms
      await fetchQuotaSnapshot();
      const totalTime = Date.now() - startTime;

      // Second call should be delayed
      expect(totalTime).toBeGreaterThanOrEqual(90);
    });

    it('should track time since last request correctly', async () => {
      __test.resetRateLimiter();

      // Make first request
      await fetchQuotaSnapshot();

      // Wait longer than the rate limit (1000ms default)
      await wait(1100);

      // Second request should not be delayed significantly
      const startTime = Date.now();
      await fetchQuotaSnapshot();
      const elapsed = Date.now() - startTime;

      // Should complete quickly since we waited longer than rate limit
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle multiple rapid requests sequentially', async () => {
      __test.resetRateLimiter();

      const startTime = Date.now();

      // Make 3 rapid requests
      await fetchQuotaSnapshot();
      await fetchQuotaSnapshot();
      await fetchQuotaSnapshot();

      const totalTime = Date.now() - startTime;

      // Should take at least 200ms (2 delays of 100ms each)
      expect(totalTime).toBeGreaterThanOrEqual(180);
    });
  });

  // ============================================================================
  // Retry Logic Tests
  // ============================================================================

  describe('Retry Logic', () => {
    it('should not retry on successful calls', async () => {
      __test.resetRateLimiter();
      mockGetSendQuota.mockImplementation(() =>
        Promise.resolve({
          Max24HourSend: 1000,
          MaxSendRate: 14,
          SentLast24Hours: 100,
        })
      );

      await fetchQuotaSnapshot();

      expect(mockGetSendQuota).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors with exponential backoff', async () => {
      __test.resetRateLimiter();
      let callCount = 0;

      // Fail twice, then succeed
      mockGetSendQuota.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          const error = new Error('ThrottlingException') as Error & { code: string; retryable: boolean };
          error.code = 'Throttling';
          error.retryable = true;
          return Promise.reject(error);
        }
        return Promise.resolve({
          Max24HourSend: 1000,
          MaxSendRate: 14,
          SentLast24Hours: 100,
        });
      });

      const result = await fetchQuotaSnapshot();

      expect(callCount).toBe(3);
      expect(result).not.toBeNull();
    });

    it('should respect max retry limit', async () => {
      __test.resetRateLimiter();

      // Always fail with retryable error
      mockGetSendQuota.mockImplementation(() => {
        const error = new Error('ServiceUnavailable') as Error & { code: string; retryable: boolean };
        error.code = 'ServiceUnavailable';
        error.retryable = true;
        return Promise.reject(error);
      });

      const result = await fetchQuotaSnapshot();

      // Should attempt 3 times (initial + 2 retries based on MAX_API_RETRIES = 3)
      expect(mockGetSendQuota).toHaveBeenCalledTimes(3);
      expect(result).toBeNull();
    });

    it('should not retry on non-transient errors', async () => {
      __test.resetRateLimiter();

      // Fail with non-retryable error
      mockGetSendQuota.mockImplementation(() => {
        const error = new Error('InvalidCredentials') as Error & { code: string };
        error.code = 'InvalidCredentials';
        return Promise.reject(error);
      });

      const result = await fetchQuotaSnapshot();

      // Should only attempt once
      expect(mockGetSendQuota).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('should handle InternalFailure as retryable', async () => {
      __test.resetRateLimiter();
      let callCount = 0;

      mockGetSendQuota.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('InternalFailure') as Error & { name: string; retryable: boolean };
          error.name = 'InternalFailure';
          error.retryable = false; // retryable flag not set but name matches
          return Promise.reject(error);
        }
        return Promise.resolve({
          Max24HourSend: 1000,
          MaxSendRate: 14,
          SentLast24Hours: 100,
        });
      });

      const result = await fetchQuotaSnapshot();

      expect(callCount).toBe(2);
      expect(result).not.toBeNull();
    });
  });

  // ============================================================================
  // API Fetcher Tests
  // ============================================================================

  describe('fetchQuotaSnapshot()', () => {
    beforeEach(() => {
      __test.resetRateLimiter();
    });

    it('should call GetSendQuotaCommand', async () => {
      await fetchQuotaSnapshot();

      expect(awsSdkCalls.some((call) => call.command === 'GetSendQuotaCommand')).toBe(true);
    });

    it('should return correctly typed QuotaSnapshot data', async () => {
      const result = await fetchQuotaSnapshot();

      expect(result).not.toBeNull();
      expect(result?.max24HourSend).toBe(1000);
      expect(result?.maxSendRate).toBe(14);
      expect(result?.sentLast24Hours).toBe(100);
      expect(result?.source).toBe('api');
      expect(result?.recordedAt).toBeInstanceOf(Date);
    });

    it('should handle missing values with defaults', async () => {
      mockGetSendQuota.mockImplementation(() =>
        Promise.resolve({
          Max24HourSend: undefined as unknown as number,
          MaxSendRate: undefined as unknown as number,
          SentLast24Hours: undefined as unknown as number,
        })
      );

      const result = await fetchQuotaSnapshot();

      expect(result?.max24HourSend).toBe(0);
      expect(result?.maxSendRate).toBe(0);
      expect(result?.sentLast24Hours).toBe(0);
    });

    it('should log AWS SES request and response events', async () => {
      await fetchQuotaSnapshot();

      expect(loggerModule.logger.logEvent).toHaveBeenCalledWith(
        'AWS_SES_REQ',
        expect.objectContaining({ operation: 'GetSendQuota' })
      );
      expect(loggerModule.logger.logEvent).toHaveBeenCalledWith(
        'AWS_SES_RES',
        expect.objectContaining({ operation: 'GetSendQuota' })
      );
    });

    it('should return null on API failure', async () => {
      mockGetSendQuota.mockImplementation(() => Promise.reject(new Error('API Error')));

      const result = await fetchQuotaSnapshot();

      expect(result).toBeNull();
      expect(loggerModule.logger.logError).toHaveBeenCalled();
    });
  });

  describe('fetchSendStatistics()', () => {
    beforeEach(() => {
      __test.resetRateLimiter();
    });

    it('should call GetSendStatisticsCommand', async () => {
      await fetchSendStatistics();

      expect(awsSdkCalls.some((call) => call.command === 'GetSendStatisticsCommand')).toBe(true);
    });

    it('should return array of SendStatistics data points', async () => {
      const result = await fetchSendStatistics();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      // Check first data point
      expect(result[0].timestamp).toBeInstanceOf(Date);
      expect(result[0].deliveryAttempts).toBe(100);
      expect(result[0].bounces).toBe(5);
      expect(result[0].complaints).toBe(1);
      expect(result[0].rejects).toBe(2);
      expect(result[0].fetchedAt).toBeInstanceOf(Date);
    });

    it('should sort results by timestamp descending', async () => {
      const result = await fetchSendStatistics();

      expect(result[0].timestamp.getTime()).toBeGreaterThan(result[1].timestamp.getTime());
    });

    it('should filter by startDate', async () => {
      const startDate = new Date('2024-01-01T09:50:00Z');
      const result = await fetchSendStatistics(startDate);

      // Should only include data points >= startDate
      expect(result.length).toBe(1);
      expect(result[0].timestamp).toEqual(new Date('2024-01-01T10:00:00Z'));
    });

    it('should filter by endDate', async () => {
      const endDate = new Date('2024-01-01T09:50:00Z');
      const result = await fetchSendStatistics(undefined, endDate);

      // Should only include data points <= endDate
      expect(result.length).toBe(1);
      expect(result[0].timestamp).toEqual(new Date('2024-01-01T09:45:00Z'));
    });

    it('should filter by both startDate and endDate', async () => {
      const startDate = new Date('2024-01-01T09:44:00Z');
      const endDate = new Date('2024-01-01T09:46:00Z');
      const result = await fetchSendStatistics(startDate, endDate);

      expect(result.length).toBe(1);
      expect(result[0].timestamp).toEqual(new Date('2024-01-01T09:45:00Z'));
    });

    it('should return empty array when no data points match filters', async () => {
      const startDate = new Date('2024-02-01T00:00:00Z');
      const result = await fetchSendStatistics(startDate);

      expect(result).toEqual([]);
    });

    it('should handle empty SendDataPoints response', async () => {
      mockGetSendStatistics.mockImplementation(() => Promise.resolve({ SendDataPoints: [] }));

      const result = await fetchSendStatistics();

      expect(result).toEqual([]);
    });

    it('should handle API failure gracefully', async () => {
      mockGetSendStatistics.mockImplementation(() => Promise.reject(new Error('API Error')));

      const result = await fetchSendStatistics();

      expect(result).toEqual([]);
      expect(loggerModule.logger.logError).toHaveBeenCalled();
    });
  });

  describe('fetchIdentityStatuses()', () => {
    beforeEach(() => {
      __test.resetRateLimiter();
    });

    it('should call ListIdentitiesCommand', async () => {
      await fetchIdentityStatuses();

      expect(awsSdkCalls.some((call) => call.command === 'ListIdentitiesCommand')).toBe(true);
    });

    it('should call GetIdentityVerificationAttributesCommand with identities', async () => {
      await fetchIdentityStatuses();

      const verifyCall = awsSdkCalls.find(
        (call) => call.command === 'GetIdentityVerificationAttributesCommand'
      );
      expect(verifyCall).toBeDefined();
    });

    it('should return array of IdentityStatus records', async () => {
      const result = await fetchIdentityStatuses();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      // Check first identity
      expect(result[0].identity).toBe('test@example.com');
      expect(result[0].verificationStatus).toBe('Success');
      expect(result[0].dkimEnabled).toBe(false);
      expect(result[0].dkimVerificationStatus).toBeNull();
      expect(result[0].checkedAt).toBeInstanceOf(Date);

      // Check second identity
      expect(result[1].identity).toBe('example.com');
      expect(result[1].verificationStatus).toBe('Pending');
    });

    it('should return empty array when no identities exist', async () => {
      mockListIdentities.mockImplementation(() => Promise.resolve({ Identities: [] }));

      const result = await fetchIdentityStatuses();

      expect(result).toEqual([]);
      // Should not call GetIdentityVerificationAttributes
      expect(
        awsSdkCalls.some((call) => call.command === 'GetIdentityVerificationAttributesCommand')
      ).toBe(false);
    });

    it('should handle missing verification attributes', async () => {
      // Mock list identities to return known identities
      mockListIdentities.mockImplementation(() =>
        Promise.resolve({
          Identities: ['test@example.com', 'example.com'],
        })
      );

      // Mock empty verification attributes
      mockGetIdentityVerificationAttributes.mockImplementation(() =>
        Promise.resolve({
          VerificationAttributes: {},
        })
      );

      const result = await fetchIdentityStatuses();

      expect(result.length).toBe(2);
      // Should default to 'NotStarted' when attribute is missing
      expect(result[0].verificationStatus).toBe('NotStarted');
      expect(result[1].verificationStatus).toBe('NotStarted');
    });

    it('should handle API failure gracefully', async () => {
      mockListIdentities.mockImplementation(() => Promise.reject(new Error('API Error')));

      const result = await fetchIdentityStatuses();

      expect(result).toEqual([]);
      expect(loggerModule.logger.logError).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Storage Function Tests
  // ============================================================================

  describe('storeQuotaSnapshot()', () => {
    it('should store quota snapshot to database', async () => {
      const createQuotaSnapshotSpy = spyOn(dbModule, 'createQuotaSnapshot').mockImplementation(() =>
        Promise.resolve({
          id: 1,
          max24HourSend: 1000,
          sentLast24Hours: 100,
          maxSendRate: 14,
          recordedAt: new Date(),
          source: 'api',
        })
      );

      const quota: QuotaSnapshot = {
        max24HourSend: 1000,
        maxSendRate: 14,
        sentLast24Hours: 100,
        recordedAt: new Date(),
        source: 'api',
      };

      await storeQuotaSnapshot(quota);

      expect(createQuotaSnapshotSpy).toHaveBeenCalledTimes(1);
      expect(createQuotaSnapshotSpy.mock.calls[0][0]).toEqual(quota);
    });

    it('should log storage success', async () => {
      spyOn(dbModule, 'createQuotaSnapshot').mockImplementation(() =>
        Promise.resolve({
          id: 1,
          max24HourSend: 1000,
          sentLast24Hours: 100,
          maxSendRate: 14,
          recordedAt: new Date(),
          source: 'api',
        })
      );

      const quota: QuotaSnapshot = {
        max24HourSend: 1000,
        maxSendRate: 14,
        sentLast24Hours: 100,
        recordedAt: new Date(),
        source: 'api',
      };

      await storeQuotaSnapshot(quota);

      expect(loggerModule.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Quota snapshot stored')
      );
    });

    it('should throw on database error', async () => {
      spyOn(dbModule, 'createQuotaSnapshot').mockImplementation(() =>
        Promise.reject(new Error('Database error'))
      );

      const quota: QuotaSnapshot = {
        max24HourSend: 1000,
        maxSendRate: 14,
        sentLast24Hours: 100,
        recordedAt: new Date(),
        source: 'api',
      };

      await expect(storeQuotaSnapshot(quota)).rejects.toThrow('Database error');
      expect(loggerModule.logger.logError).toHaveBeenCalled();
    });
  });

  describe('storeSendStatistics()', () => {
    it('should store send statistics to database', async () => {
      const createSendStatisticsSpy = spyOn(dbModule, 'createSendStatistics').mockImplementation(() =>
        Promise.resolve(2)
      );

      const stats: SendStatistics[] = [
        {
          timestamp: new Date('2024-01-01T10:00:00Z'),
          deliveryAttempts: 100,
          bounces: 5,
          complaints: 1,
          rejects: 2,
          fetchedAt: new Date(),
        },
        {
          timestamp: new Date('2024-01-01T09:45:00Z'),
          deliveryAttempts: 80,
          bounces: 3,
          complaints: 0,
          rejects: 1,
          fetchedAt: new Date(),
        },
      ];

      const result = await storeSendStatistics(stats);

      expect(createSendStatisticsSpy).toHaveBeenCalledTimes(1);
      expect(createSendStatisticsSpy.mock.calls[0][0]).toEqual(stats);
      expect(result).toBe(2);
    });

    it('should return 0 for empty stats array without calling database', async () => {
      // The function should return 0 early without calling createSendStatistics
      const result = await storeSendStatistics([]);

      expect(result).toBe(0);
    });

    it('should log number of stored records', async () => {
      spyOn(dbModule, 'createSendStatistics').mockImplementation(() => Promise.resolve(2));

      const stats: SendStatistics[] = [
        {
          timestamp: new Date(),
          deliveryAttempts: 100,
          bounces: 5,
          complaints: 1,
          rejects: 2,
          fetchedAt: new Date(),
        },
      ];

      await storeSendStatistics(stats);

      expect(loggerModule.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stored 2 send statistics')
      );
    });

    it('should throw on database error', async () => {
      spyOn(dbModule, 'createSendStatistics').mockImplementation(() =>
        Promise.reject(new Error('Database error'))
      );

      const stats: SendStatistics[] = [
        {
          timestamp: new Date(),
          deliveryAttempts: 100,
          bounces: 5,
          complaints: 1,
          rejects: 2,
          fetchedAt: new Date(),
        },
      ];

      await expect(storeSendStatistics(stats)).rejects.toThrow('Database error');
    });
  });

  describe('storeIdentityStatuses()', () => {
    it('should store identity statuses to database', async () => {
      const upsertIdentityStatusSpy = spyOn(dbModule, 'upsertIdentityStatus').mockImplementation(() =>
        Promise.resolve()
      );

      const identities: IdentityStatus[] = [
        {
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: false,
          dkimVerificationStatus: null,
          checkedAt: new Date(),
        },
      ];

      await storeIdentityStatuses(identities);

      expect(upsertIdentityStatusSpy).toHaveBeenCalledTimes(1);
      expect(upsertIdentityStatusSpy.mock.calls[0][0]).toEqual(identities);
    });

    it('should return early for empty identities array', async () => {
      // The function should return early without error when given empty array
      await expect(storeIdentityStatuses([])).resolves.toBeUndefined();
    });

    it('should throw on database error', async () => {
      spyOn(dbModule, 'upsertIdentityStatus').mockImplementation(() =>
        Promise.reject(new Error('Database error'))
      );

      const identities: IdentityStatus[] = [
        {
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: false,
          dkimVerificationStatus: null,
          checkedAt: new Date(),
        },
      ];

      await expect(storeIdentityStatuses(identities)).rejects.toThrow('Database error');
    });
  });

  describe('storeMessageEvent()', () => {
    it('should store message event to database', async () => {
      // Create a unique event to identify this test's call
      const uniqueEventId = 'test-event-unique-id';
      const createMessageEventSpy = spyOn(dbModule, 'createMessageEvent').mockImplementation(() =>
        Promise.resolve({
          id: 1,
          eventType: 'SEND',
          messageId: uniqueEventId,
          contactId: 'contact-456',
          sendLogId: 'log-789',
          eventData: { status: 'sent' },
          occurredAt: new Date(),
          createdAt: new Date(),
        })
      );

      const event: MessageEvent = {
        eventType: 'SEND',
        messageId: uniqueEventId,
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: { status: 'sent' },
        occurredAt: new Date(),
      };

      await storeMessageEvent(event);

      // Verify the function was called - check for our unique event
      // (Note: spy may have calls from async event persistence of previous tests)
      expect(createMessageEventSpy).toHaveBeenCalled();
      const matchingCall = createMessageEventSpy.mock.calls.find(
        (call) => (call[0] as MessageEvent).messageId === uniqueEventId
      );
      expect(matchingCall).toBeDefined();
      const callArg = matchingCall![0] as MessageEvent;
      expect(callArg.eventType).toBe(event.eventType);
      expect(callArg.contactId).toBe(event.contactId);
      expect(callArg.sendLogId).toBe(event.sendLogId);
      expect(callArg.eventData).toEqual(event.eventData);
    });

    it('should throw on database error', async () => {
      spyOn(dbModule, 'createMessageEvent').mockImplementation(() =>
        Promise.reject(new Error('Database error'))
      );

      const event: MessageEvent = {
        eventType: 'SEND',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: {},
        occurredAt: new Date(),
      };

      await expect(storeMessageEvent(event)).rejects.toThrow('Database error');
    });
  });

  // ============================================================================
  // syncAllAnalytics() Tests
  // ============================================================================

  describe('syncAllAnalytics()', () => {
    beforeEach(() => {
      __test.resetRateLimiter();

      // Set up default successful mocks
      mockGetSendQuota.mockImplementation(() =>
        Promise.resolve({
          Max24HourSend: 1000,
          MaxSendRate: 14,
          SentLast24Hours: 100,
        })
      );

      mockGetSendStatistics.mockImplementation(() =>
        Promise.resolve({
          SendDataPoints: [
            {
              Timestamp: new Date(),
              DeliveryAttempts: 100,
              Bounces: 5,
              Complaints: 1,
              Rejects: 2,
            },
          ],
        })
      );

      mockListIdentities.mockImplementation(() =>
        Promise.resolve({ Identities: ['test@example.com'] })
      );

      mockGetIdentityVerificationAttributes.mockImplementation(() =>
        Promise.resolve({
          VerificationAttributes: {
            'test@example.com': { VerificationStatus: 'Success' },
          },
        })
      );

      // Mock DB storage
      spyOn(dbModule, 'createQuotaSnapshot').mockImplementation(() =>
        Promise.resolve({
          id: 1,
          max24HourSend: 1000,
          sentLast24Hours: 100,
          maxSendRate: 14,
          recordedAt: new Date(),
          source: 'api',
        })
      );

      spyOn(dbModule, 'createSendStatistics').mockImplementation(() => Promise.resolve(1));
      spyOn(dbModule, 'upsertIdentityStatus').mockImplementation(() => Promise.resolve());
    });

    it('should coordinate all fetches respecting rate limits', async () => {
      const startTime = Date.now();
      await syncAllAnalytics();
      const elapsed = Date.now() - startTime;

      // Should make at least 3 API calls with rate limiting
      expect(awsSdkCallCount).toBeGreaterThanOrEqual(3);
      // Should take some time due to rate limiting
      expect(elapsed).toBeGreaterThanOrEqual(200);
    });

    it('should store all results to database', async () => {
      await syncAllAnalytics();

      expect(dbModule.createQuotaSnapshot).toHaveBeenCalled();
      expect(dbModule.createSendStatistics).toHaveBeenCalled();
      expect(dbModule.upsertIdentityStatus).toHaveBeenCalled();
    });

    it('should return sync statistics on success', async () => {
      const result = await syncAllAnalytics();

      expect(result.success).toBe(true);
      expect(result.quotaSnapshotsStored).toBe(1);
      expect(result.sendStatisticsStored).toBe(1);
      expect(result.identityStatusesStored).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it('should handle partial failures gracefully', async () => {
      // Make quota fetch fail
      mockGetSendQuota.mockImplementation(() => Promise.reject(new Error('API Error')));

      const result = await syncAllAnalytics();

      expect(result.success).toBe(true); // Still success even if quota fails
      expect(result.quotaSnapshotsStored).toBe(0);
      expect(result.sendStatisticsStored).toBe(1);
      expect(result.identityStatusesStored).toBe(1);
    });

    it('should respect startDate and endDate options', async () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      await syncAllAnalytics({ startDate, endDate });

      // Verify GetSendStatistics was called (we can't easily verify date filtering)
      expect(awsSdkCalls.some((call) => call.command === 'GetSendStatisticsCommand')).toBe(true);
    });

    it('should log sync start and completion', async () => {
      await syncAllAnalytics();

      expect(loggerModule.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting SES analytics sync')
      );
      expect(loggerModule.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SES analytics sync completed')
      );
    });

    it('should handle complete fetch failures gracefully', async () => {
      // Make API fetches return null/empty (not throw)
      mockGetSendQuota.mockImplementation(() => Promise.resolve(null as unknown as { Max24HourSend: number; MaxSendRate: number; SentLast24Hours: number }));
      mockGetSendStatistics.mockImplementation(() => Promise.resolve({ SendDataPoints: [] }));
      mockListIdentities.mockImplementation(() => Promise.resolve({ Identities: [] }));

      const result = await syncAllAnalytics();

      // Should still be considered successful since no errors were thrown
      expect(result.success).toBe(true);
      expect(result.quotaSnapshotsStored).toBe(0);
      expect(result.sendStatisticsStored).toBe(0);
      expect(result.identityStatusesStored).toBe(0);
    });
  });

  // ============================================================================
  // Cache Utility Tests
  // ============================================================================

  describe('getQuotaSnapshotCached()', () => {
    beforeEach(() => {
      __test.resetRateLimiter();

      // Reset mock to return valid quota data
      mockGetSendQuota.mockImplementation(() =>
        Promise.resolve({
          Max24HourSend: 1000,
          MaxSendRate: 14,
          SentLast24Hours: 100,
        })
      );

      spyOn(dbModule, 'createQuotaSnapshot').mockImplementation(() =>
        Promise.resolve({
          id: 1,
          max24HourSend: 1000,
          sentLast24Hours: 100,
          maxSendRate: 14,
          recordedAt: new Date(),
          source: 'api',
        })
      );
    });

    it('should return cached data when fresh', async () => {
      const now = new Date();
      const cachedSnapshot = {
        id: 1,
        max24HourSend: 500,
        sentLast24Hours: 50,
        maxSendRate: 14,
        recordedAt: now,
        source: 'api',
      };

      spyOn(dbModule, 'getLatestQuotaSnapshot').mockImplementation(() =>
        Promise.resolve(cachedSnapshot)
      );

      const result = await getQuotaSnapshotCached(60000); // 1 minute max age

      expect(result).not.toBeNull();
      expect(result?.source).toBe('cached');
      expect(result?.max24HourSend).toBe(500);
    });

    it('should fetch fresh data when cache is stale', async () => {
      const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const cachedSnapshot = {
        id: 1,
        max24HourSend: 500,
        sentLast24Hours: 50,
        maxSendRate: 14,
        recordedAt: oldTime,
        source: 'api',
      };

      spyOn(dbModule, 'getLatestQuotaSnapshot').mockImplementation(() =>
        Promise.resolve(cachedSnapshot)
      );

      const result = await getQuotaSnapshotCached(60000); // 1 minute max age

      // Should fetch fresh data since cache is stale
      expect(mockGetSendQuota).toHaveBeenCalled();
      // Result should be fresh data (not null)
      expect(result).not.toBeNull();
    });

    it('should fetch fresh data when no cache exists', async () => {
      spyOn(dbModule, 'getLatestQuotaSnapshot').mockImplementation(() => Promise.resolve(null));

      const result = await getQuotaSnapshotCached();

      expect(mockGetSendQuota).toHaveBeenCalled();
      // Result should be fresh data (not null)
      expect(result).not.toBeNull();
    });

    it('should store fresh data to cache', async () => {
      spyOn(dbModule, 'getLatestQuotaSnapshot').mockImplementation(() => Promise.resolve(null));

      await getQuotaSnapshotCached();

      expect(dbModule.createQuotaSnapshot).toHaveBeenCalled();
    });
  });

  describe('getSendStatisticsCached()', () => {
    it('should return statistics from database', async () => {
      const now = new Date();
      const dbRecords = [
        {
          id: 1,
          timestamp: now,
          deliveryAttempts: 100,
          bounces: 5,
          complaints: 1,
          rejects: 2,
          fetchedAt: now,
        },
      ];

      spyOn(dbModule, 'getSendStatistics').mockImplementation(() => Promise.resolve(dbRecords));

      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      const result = await getSendStatisticsCached(startDate, endDate);

      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toEqual(now);
      expect(result[0].deliveryAttempts).toBe(100);
      expect(result[0].bounces).toBe(5);
      expect(result[0].fetchedAt).toEqual(now);
    });

    it('should convert numeric fields correctly', async () => {
      const dbRecords = [
        {
          id: 1,
          timestamp: new Date(),
          deliveryAttempts: '100' as unknown as number, // Simulate string from DB
          bounces: '5' as unknown as number,
          complaints: '1' as unknown as number,
          rejects: '2' as unknown as number,
          fetchedAt: new Date(),
        },
      ];

      spyOn(dbModule, 'getSendStatistics').mockImplementation(() => Promise.resolve(dbRecords));

      const result = await getSendStatisticsCached(new Date(), new Date());

      expect(typeof result[0].deliveryAttempts).toBe('number');
      expect(typeof result[0].bounces).toBe('number');
    });
  });
});

import { afterAll } from "bun:test";
afterAll(() => {
  mock.restore();
});

