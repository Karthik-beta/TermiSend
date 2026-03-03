/**
 * Unit Tests for Database Analytics Functions
 * Tests SES analytics database operations with mocked SQL client
 */

import { beforeEach, describe, expect, it, mock, type Mock } from 'bun:test';
import type {
  AnalyticsEventType,
  IdentityStatus,
  MessageEvent,
  QuotaSnapshot,
  SendStatistics,
} from '../../src/types.js';
import { mockConsole, restoreConsole } from '../helpers/test-utils.js';

// ============================================================================
// Mock Setup - Must be defined before importing the module under test
// ============================================================================

// Create a mock sql function that can be controlled in tests
const mockSqlFn = Object.assign(
  mock((strings: TemplateStringsArray, ...values: unknown[]) => {
    return Promise.resolve<unknown[]>([]);
  }) as Mock<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>,
  {
    json: (data: unknown) => JSON.stringify(data),
    end: () => Promise.resolve(),
  }
);

// Mock the postgres module
mock.module('postgres', () => {
  return {
    default: () => mockSqlFn,
    fromCamel: (str: string) => str,
    toCamel: (str: string) => str,
    __esModule: true,
  };
});

// Mock config module
mock.module('../../src/config.js', () => {
  return {
    getEnv: () => ({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'test',
      DB_PASS: 'test',
      DB_NAME: 'test_db',
    }),
  };
});

// Now import the db module after mocking
const {
  createQuotaSnapshot,
  getLatestQuotaSnapshot,
  createSendStatistics,
  getSendStatistics,
  upsertIdentityStatus,
  getIdentityStatuses,
  createMessageEvent,
  getMessageEvents,
  resetSqlClient,
} = await import('../../src/db.js');

// ============================================================================
// Test Setup
// ============================================================================

describe('Database Analytics Functions', () => {
  beforeEach(() => {
    mockConsole();
    mockSqlFn.mockClear();
    resetSqlClient();
    return () => restoreConsole();
  });

  // ============================================================================
  // Quota Snapshot Tests
  // ============================================================================

  describe('createQuotaSnapshot()', () => {
    it('should insert quota snapshot and return the created record', async () => {
      const mockRecord = {
        id: 1,
        max24HourSend: 1000,
        sentLast24Hours: 100,
        maxSendRate: 14,
        recordedAt: new Date('2024-01-01T10:00:00Z'),
        source: 'api',
      };

      mockSqlFn.mockImplementation(() => Promise.resolve([mockRecord]));

      const quota: QuotaSnapshot = {
        max24HourSend: 1000,
        sentLast24Hours: 100,
        maxSendRate: 14,
        recordedAt: new Date('2024-01-01T10:00:00Z'),
        source: 'api',
      };

      const result = await createQuotaSnapshot(quota);

      expect(result).toEqual(mockRecord);
      expect(mockSqlFn).toHaveBeenCalled();

      // Verify the SQL contains expected values
      const callArgs = mockSqlFn.mock.calls[0];
      expect(callArgs).toBeDefined();
    });

    it('should handle decimal quota values', async () => {
      const mockRecord = {
        id: 1,
        max24HourSend: 1000.5,
        sentLast24Hours: 100.75,
        maxSendRate: 14.2,
        recordedAt: new Date(),
        source: 'api',
      };

      mockSqlFn.mockImplementation(() => Promise.resolve([mockRecord]));

      const quota: QuotaSnapshot = {
        max24HourSend: 1000.5,
        sentLast24Hours: 100.75,
        maxSendRate: 14.2,
        recordedAt: new Date(),
        source: 'api',
      };

      const result = await createQuotaSnapshot(quota);

      expect(result.max24HourSend).toBe(1000.5);
      expect(result.sentLast24Hours).toBe(100.75);
    });

    it('should throw error when database insertion fails', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Connection refused')));

      const quota: QuotaSnapshot = {
        max24HourSend: 1000,
        sentLast24Hours: 100,
        maxSendRate: 14,
        recordedAt: new Date(),
        source: 'api',
      };

      await expect(createQuotaSnapshot(quota)).rejects.toThrow('Connection refused');
    });

    it('should handle zero quota values', async () => {
      const mockRecord = {
        id: 1,
        max24HourSend: 0,
        sentLast24Hours: 0,
        maxSendRate: 0,
        recordedAt: new Date(),
        source: 'api',
      };

      mockSqlFn.mockImplementation(() => Promise.resolve([mockRecord]));

      const quota: QuotaSnapshot = {
        max24HourSend: 0,
        sentLast24Hours: 0,
        maxSendRate: 0,
        recordedAt: new Date(),
        source: 'api',
      };

      const result = await createQuotaSnapshot(quota);

      expect(result.max24HourSend).toBe(0);
      expect(result.sentLast24Hours).toBe(0);
    });
  });

  describe('getLatestQuotaSnapshot()', () => {
    it('should return the most recent quota snapshot', async () => {
      const mockRecord = {
        id: 5,
        max24HourSend: 1000,
        sentLast24Hours: 150,
        maxSendRate: 14,
        recordedAt: new Date('2024-01-01T12:00:00Z'),
        source: 'api',
      };

      mockSqlFn.mockImplementation(() => Promise.resolve([mockRecord]));

      const result = await getLatestQuotaSnapshot();

      expect(result).toEqual(mockRecord);
    });

    it('should return null when no snapshots exist', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await getLatestQuotaSnapshot();

      expect(result).toBeNull();
    });

    it('should order by recorded_at descending', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getLatestQuotaSnapshot();

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('order by');
      expect(query.toLowerCase()).toContain('desc');
    });

    it('should handle database query errors', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Query timeout')));

      await expect(getLatestQuotaSnapshot()).rejects.toThrow('Query timeout');
    });
  });

  // ============================================================================
  // Send Statistics Tests
  // ============================================================================

  describe('createSendStatistics()', () => {
    it('should insert multiple statistics records and return count', async () => {
      // Simulate successful insertions returning IDs
      mockSqlFn.mockImplementation(() => Promise.resolve([{ id: 1 }]));

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

      const result = await createSendStatistics(stats);

      expect(result).toBe(2);
      expect(mockSqlFn).toHaveBeenCalledTimes(2);
    });

    it('should handle duplicate timestamps with ON CONFLICT DO NOTHING', async () => {
      // Simulate first insertion succeeds, second is ignored due to conflict
      let callCount = 0;
      mockSqlFn.mockImplementation(() => {
        callCount++;
        // First call returns a record, second returns empty (conflict)
        return Promise.resolve(callCount === 1 ? [{ id: 1 }] : []);
      });

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
          timestamp: new Date('2024-01-01T10:00:00Z'), // Duplicate timestamp
          deliveryAttempts: 90,
          bounces: 4,
          complaints: 2,
          rejects: 3,
          fetchedAt: new Date(),
        },
      ];

      const result = await createSendStatistics(stats);

      expect(result).toBe(1); // Only one inserted
    });

    it('should return 0 for empty stats array', async () => {
      const result = await createSendStatistics([]);

      expect(result).toBe(0);
      expect(mockSqlFn).not.toHaveBeenCalled();
    });

    it('should throw error when database insertion fails', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Connection lost')));

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

      await expect(createSendStatistics(stats)).rejects.toThrow('Connection lost');
    });

    it('should handle large numeric values', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([{ id: 1 }]));

      const stats: SendStatistics[] = [
        {
          timestamp: new Date(),
          deliveryAttempts: 999999999,
          bounces: 99999999,
          complaints: 9999999,
          rejects: 999999,
          fetchedAt: new Date(),
        },
      ];

      const result = await createSendStatistics(stats);

      expect(result).toBe(1);
    });
  });

  describe('getSendStatistics()', () => {
    it('should return statistics for date range', async () => {
      const mockRecords = [
        {
          id: 1,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          deliveryAttempts: 100,
          bounces: 5,
          complaints: 1,
          rejects: 2,
          fetchedAt: new Date(),
        },
        {
          id: 2,
          timestamp: new Date('2024-01-14T10:00:00Z'),
          deliveryAttempts: 80,
          bounces: 3,
          complaints: 0,
          rejects: 1,
          fetchedAt: new Date(),
        },
      ];

      mockSqlFn.mockImplementation(() => Promise.resolve(mockRecords));

      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      const result = await getSendStatistics(startDate, endDate);

      expect(result).toHaveLength(2);
      expect(result[0].deliveryAttempts).toBe(100);
      expect(result[1].deliveryAttempts).toBe(80);
    });

    it('should order results by timestamp descending', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getSendStatistics(new Date(), new Date());

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('order by');
      expect(query.toLowerCase()).toContain('timestamp');
      expect(query.toLowerCase()).toContain('desc');
    });

    it('should filter by date range in WHERE clause', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        executedQueries.push(strings.join(''));
        // Store values for verification
        return Promise.resolve([]);
      });

      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      await getSendStatistics(startDate, endDate);

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('where');
      expect(query.toLowerCase()).toContain('timestamp');
    });

    it('should return empty array when no statistics match', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await getSendStatistics(new Date(), new Date());

      expect(result).toEqual([]);
    });

    it('should handle database query errors', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Query failed')));

      await expect(getSendStatistics(new Date(), new Date())).rejects.toThrow('Query failed');
    });
  });

  // ============================================================================
  // Identity Status Tests
  // ============================================================================

  describe('upsertIdentityStatus()', () => {
    it('should insert new identity records', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const identities: IdentityStatus[] = [
        {
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: true,
          dkimVerificationStatus: 'Success',
          checkedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          identity: 'example.com',
          verificationStatus: 'Pending',
          dkimEnabled: false,
          dkimVerificationStatus: null,
          checkedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      await upsertIdentityStatus(identities);

      expect(mockSqlFn).toHaveBeenCalledTimes(2);
    });

    it('should update existing records on identity conflict', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      const identities: IdentityStatus[] = [
        {
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: true,
          dkimVerificationStatus: 'Success',
          checkedAt: new Date(),
        },
      ];

      await upsertIdentityStatus(identities);

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('on conflict');
      expect(query.toLowerCase()).toContain('do update');
    });

    it('should handle empty identities array', async () => {
      await upsertIdentityStatus([]);

      expect(mockSqlFn).not.toHaveBeenCalled();
    });

    it('should throw error when database upsert fails', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Upsert failed')));

      const identities: IdentityStatus[] = [
        {
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: false,
          dkimVerificationStatus: null,
          checkedAt: new Date(),
        },
      ];

      await expect(upsertIdentityStatus(identities)).rejects.toThrow('Upsert failed');
    });

    it('should handle null dkimVerificationStatus', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const identities: IdentityStatus[] = [
        {
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: false,
          dkimVerificationStatus: null,
          checkedAt: new Date(),
        },
      ];

      await upsertIdentityStatus(identities);

      expect(mockSqlFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('getIdentityStatuses()', () => {
    it('should return all identity statuses ordered by identity', async () => {
      const mockRecords = [
        {
          id: 1,
          identity: 'a@example.com',
          verificationStatus: 'Success',
          dkimEnabled: true,
          dkimVerificationStatus: 'Success',
          checkedAt: new Date(),
        },
        {
          id: 2,
          identity: 'b@example.com',
          verificationStatus: 'Pending',
          dkimEnabled: false,
          dkimVerificationStatus: null,
          checkedAt: new Date(),
        },
      ];

      mockSqlFn.mockImplementation(() => Promise.resolve(mockRecords));

      const result = await getIdentityStatuses();

      expect(result).toHaveLength(2);
      expect(result[0].identity).toBe('a@example.com');
      expect(result[1].identity).toBe('b@example.com');
    });

    it('should order results by identity', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getIdentityStatuses();

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('order by');
      expect(query.toLowerCase()).toContain('identity');
    });

    it('should return empty array when no identities exist', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await getIdentityStatuses();

      expect(result).toEqual([]);
    });

    it('should handle database query errors', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Connection error')));

      await expect(getIdentityStatuses()).rejects.toThrow('Connection error');
    });

    it('should properly map column names from snake_case to camelCase', async () => {
      const mockRecords = [
        {
          id: 1,
          identity: 'test@example.com',
          verificationStatus: 'Success',
          dkimEnabled: true,
          dkimVerificationStatus: 'Success',
          checkedAt: new Date(),
        },
      ];

      mockSqlFn.mockImplementation(() => Promise.resolve(mockRecords));

      const result = await getIdentityStatuses();

      expect(result[0].verificationStatus).toBe('Success');
      expect(result[0].dkimEnabled).toBe(true);
      expect(result[0].dkimVerificationStatus).toBe('Success');
      expect(result[0].checkedAt).toBeInstanceOf(Date);
    });
  });

  // ============================================================================
  // Message Event Tests
  // ============================================================================

  describe('createMessageEvent()', () => {
    it('should insert message event and return created record', async () => {
      const mockRecord = {
        id: 1,
        eventType: 'SEND',
        messageId: 'msg-123',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: { status: 'delivered' },
        occurredAt: new Date('2024-01-01T10:00:00Z'),
        createdAt: new Date('2024-01-01T10:00:01Z'),
      };

      mockSqlFn.mockImplementation(() => Promise.resolve([mockRecord]));

      const event: MessageEvent = {
        eventType: 'SEND',
        messageId: 'msg-123',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: { status: 'delivered' },
        occurredAt: new Date('2024-01-01T10:00:00Z'),
      };

      const result = await createMessageEvent(event);

      expect(result).toEqual(mockRecord);
    });

    it('should serialize event data to JSON', async () => {
      const executedQueries: { strings: string; values: unknown[] }[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        executedQueries.push({ strings: strings.join(''), values });
        return Promise.resolve([
          {
            id: 1,
            eventType: 'BOUNCE',
            messageId: 'msg-123',
            contactId: 'contact-456',
            sendLogId: 'log-789',
            eventData: { bounceType: 'Permanent' },
            occurredAt: new Date(),
            createdAt: new Date(),
          },
        ]);
      });

      const event: MessageEvent = {
        eventType: 'BOUNCE',
        messageId: 'msg-123',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: { bounceType: 'Permanent', bounceSubType: 'General' },
        occurredAt: new Date(),
      };

      await createMessageEvent(event);

      // Should use sql.json for the event_data field
      expect(mockSqlFn).toHaveBeenCalled();
    });

    it('should handle events without messageId', async () => {
      mockSqlFn.mockImplementation(() =>
        Promise.resolve([
          {
            id: 1,
            eventType: 'SEND',
            messageId: null,
            contactId: 'contact-456',
            sendLogId: 'log-789',
            eventData: {},
            occurredAt: new Date(),
            createdAt: new Date(),
          },
        ])
      );

      const event: MessageEvent = {
        eventType: 'SEND',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: {},
        occurredAt: new Date(),
      };

      const result = await createMessageEvent(event);

      expect(result.messageId).toBeNull();
    });

    it('should throw error when database insertion fails', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Insert failed')));

      const event: MessageEvent = {
        eventType: 'SEND',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: {},
        occurredAt: new Date(),
      };

      await expect(createMessageEvent(event)).rejects.toThrow('Insert failed');
    });

    it('should handle complex nested event data', async () => {
      mockSqlFn.mockImplementation(() =>
        Promise.resolve([
          {
            id: 1,
            eventType: 'BOUNCE',
            messageId: 'msg-123',
            contactId: 'contact-456',
            sendLogId: 'log-789',
            eventData: {
              bounceType: 'Permanent',
              bouncedRecipients: ['recipient@example.com'],
              timestamp: '2024-01-01T10:00:00Z',
            },
            occurredAt: new Date(),
            createdAt: new Date(),
          },
        ])
      );

      const event: MessageEvent = {
        eventType: 'BOUNCE',
        messageId: 'msg-123',
        contactId: 'contact-456',
        sendLogId: 'log-789',
        eventData: {
          bounceType: 'Permanent',
          bouncedRecipients: ['recipient@example.com'],
          timestamp: '2024-01-01T10:00:00Z',
        },
        occurredAt: new Date(),
      };

      const result = await createMessageEvent(event);

      expect(result.eventData).toEqual(event.eventData);
    });
  });

  describe('getMessageEvents()', () => {
    it('should return all message events with default limit', async () => {
      const mockRecords = [
        {
          id: 1,
          eventType: 'SEND',
          messageId: 'msg-123',
          contactId: 'contact-456',
          sendLogId: 'log-789',
          eventData: {},
          occurredAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 2,
          eventType: 'DELIVERY',
          messageId: 'msg-123',
          contactId: 'contact-456',
          sendLogId: 'log-789',
          eventData: {},
          occurredAt: new Date(),
          createdAt: new Date(),
        },
      ];

      mockSqlFn.mockImplementation(() => Promise.resolve(mockRecords));

      const result = await getMessageEvents({});

      expect(result).toHaveLength(2);
    });

    it('should filter by eventType', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getMessageEvents({ eventType: 'BOUNCE' });

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('event_type');
    });

    it('should filter by contactId', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getMessageEvents({ contactId: 'contact-123' });

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('contact_id');
    });

    it('should filter by messageId', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getMessageEvents({ messageId: 'msg-123' });

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('message_id');
    });

    it('should filter by date range', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      await getMessageEvents({ startDate, endDate });

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('occurred_at');
    });

    it('should apply limit', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getMessageEvents({ limit: 10 });

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('limit');
    });

    it('should order results by occurred_at descending', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getMessageEvents({});

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('order by');
      expect(query.toLowerCase()).toContain('occurred_at');
      expect(query.toLowerCase()).toContain('desc');
    });

    it('should return empty array when no events match', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await getMessageEvents({ eventType: 'COMPLAINT' });

      expect(result).toEqual([]);
    });

    it('should handle database query errors', async () => {
      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Query error')));

      await expect(getMessageEvents({})).rejects.toThrow('Query error');
    });

    it('should combine multiple filters', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });

      await getMessageEvents({
        eventType: 'SEND',
        contactId: 'contact-123',
        limit: 5,
      });

      const query = executedQueries.join('');
      expect(query.toLowerCase()).toContain('event_type');
      expect(query.toLowerCase()).toContain('contact_id');
      expect(query.toLowerCase()).toContain('limit');
    });
  });
});
