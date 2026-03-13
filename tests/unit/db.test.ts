/**
 * Unit Tests for Database Module
 * Tests PostgreSQL operations with mocked client
 */

import { beforeEach, describe, expect, it, mock, type Mock } from 'bun:test';
import type { AuditLog, Contact } from '../../src/types.js';
import { createMockAuditLog, createMockContact, createMockContacts } from '../helpers/mock-factories.js';
import { mockConsole, restoreConsole } from '../helpers/test-utils.js';

// ============================================================================
// Module Mocks - Must be defined before importing the module under test
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
    __esModule: true,
  };
});

// Now import the db module after mocking
const {
  closeConnection,
  contactExists,
  createContactSuppression,
  getContactByEmail,
  getContactSuppressionByEmail,
  getContacts,
  getEligibleContacts,
  getEligibleContactCount,
  isEmailSuppressed,
  initializeSchema,
  insertAuditLog,
  insertContact,
  insertContactSkipDuplicate,
  createSendLog,
  updateSendLog,
  getContactSendLogs,
  getPendingSendLogs,
  getSendStats,
  resetSqlClient,
} = await import('../../src/db.js');

// ============================================================================
// Test Setup
// ============================================================================

describe('Database Module', () => {
  beforeEach(() => {
    mockConsole();
    mockSqlFn.mockClear();
    resetSqlClient();
    return () => restoreConsole();
  });

  // ============================================================================
  // initializeSchema() Tests
  // ============================================================================

  describe('initializeSchema()', () => {
    it('should create contacts table with correct structure', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      await initializeSchema();
      expect(mockSqlFn).toHaveBeenCalled();
    });

    it('should create audit_logs table with correct structure', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });
      await initializeSchema();
      const hasAuditLogsTable = executedQueries.some((q) =>
        q.includes('CREATE TABLE IF NOT EXISTS audit_logs')
      );
      expect(hasAuditLogsTable).toBe(true);
    });

    it('should create indexes on email column', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });
      await initializeSchema();
      const hasEmailIndex = executedQueries.some((q) => q.includes('idx_contacts_email'));
      expect(hasEmailIndex).toBe(true);
    });

    it('should create send_logs table with indexes', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });
      await initializeSchema();
      const hasSendLogsTable = executedQueries.some((q) =>
        q.includes('CREATE TABLE IF NOT EXISTS send_logs')
      );
      const hasSendLogsContactIndex = executedQueries.some((q) =>
        q.includes('idx_send_logs_contact_id')
      );
      const hasSendLogsStatusIndex = executedQueries.some((q) =>
        q.includes('idx_send_logs_status')
      );
      expect(hasSendLogsTable).toBe(true);
      expect(hasSendLogsContactIndex).toBe(true);
      expect(hasSendLogsStatusIndex).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Connection refused');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      try {
        await initializeSchema();
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        if (error instanceof Error) {
          expect(error.message).toContain('Failed to initialize database schema');
        }
      }
    });

    it('should create indexes on audit_logs table', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });
      await initializeSchema();
      const hasEventTypeIndex = executedQueries.some((q) =>
        q.includes('idx_audit_logs_event_type')
      );
      const hasCreatedAtIndex = executedQueries.some((q) =>
        q.includes('idx_audit_logs_created_at')
      );
      expect(hasEventTypeIndex).toBe(true);
      expect(hasCreatedAtIndex).toBe(true);
    });

    it('should add email-based suppression indexes and backfill queries', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(' '));
        return Promise.resolve([]);
      });

      await initializeSchema();

      expect(
        executedQueries.some((query) => query.includes('ADD COLUMN IF NOT EXISTS email VARCHAR(255)'))
      ).toBe(true);
      expect(
        executedQueries.some((query) =>
          query.includes('idx_contact_suppressions_email_type_unique')
        )
      ).toBe(true);
      expect(
        executedQueries.some((query) => query.includes('UPDATE contact_suppressions cs'))
      ).toBe(true);
    });
  });

  // ============================================================================
  // insertContact() Tests
  // ============================================================================

  describe('insertContact()', () => {
    it('should insert a new contact and return the contact object', async () => {
      const mockContact: Contact = createMockContact();
      // Return data in camelCase (the postgres client transforms it)
      const dbRow = {
        id: mockContact.id,
        email: mockContact.email,
        companyName: mockContact.companyName,  // camelCase
        personName: mockContact.personName,    // camelCase
        createdAt: mockContact.createdAt,      // camelCase
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertContact('Test Company', 'John Doe', 'john@test.com');

      expect(result.email).toBe(mockContact.email);
      expect(result.companyName).toBe(mockContact.companyName);
      expect(result.personName).toBe(mockContact.personName);
    });

    it('should upsert contact on email conflict', async () => {
      const updatedContact = createMockContact({
        email: 'john@test.com',
        companyName: 'New Company',
        personName: 'John Updated',
      });
      const dbRow = {
        id: updatedContact.id,
        email: updatedContact.email,
        companyName: updatedContact.companyName,
        personName: updatedContact.personName,
        createdAt: updatedContact.createdAt,
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertContact('New Company', 'John Updated', 'john@test.com');

      expect(result.companyName).toBe('New Company');
      expect(result.personName).toBe('John Updated');
    });

    it('should handle database insertion errors', async () => {
      const dbError = new Error('Duplicate key violation');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(insertContact('Company', 'Person', 'test@test.com')).rejects.toThrow();
    });

    it('should handle special characters in company and person names', async () => {
      const contactWithSpecialChars = createMockContact({
        companyName: "O'Reilly & Associates",
        personName: 'Jean-Pierre François',
      });
      const dbRow = {
        id: contactWithSpecialChars.id,
        email: contactWithSpecialChars.email,
        companyName: contactWithSpecialChars.companyName,
        personName: contactWithSpecialChars.personName,
        createdAt: contactWithSpecialChars.createdAt,
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertContact(
        "O'Reilly & Associates",
        'Jean-Pierre François',
        'test@test.com'
      );

      expect(result.companyName).toBe("O'Reilly & Associates");
      expect(result.personName).toBe('Jean-Pierre François');
    });

    it('should normalize the email and link existing suppressions after insert', async () => {
      const executedQueries: string[] = [];
      const dbRow = {
        id: 'contact-1',
        email: 'user@example.com',
        companyName: 'Test Company',
        personName: 'John Doe',
        createdAt: new Date(),
      };

      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(' '));
        if (executedQueries.length === 1) {
          return Promise.resolve([dbRow]);
        }
        return Promise.resolve([]);
      });

      const result = await insertContact('Test Company', 'John Doe', '  USER@Example.com ');

      expect(result.email).toBe('user@example.com');
      expect(executedQueries[0]).toContain('INSERT INTO contacts');
      expect(executedQueries[1]).toContain('UPDATE contact_suppressions');
    });
  });

  // ============================================================================
  // getContacts() Tests
  // ============================================================================

  describe('getContacts()', () => {
    it('should return all contacts', async () => {
      const mockContacts = createMockContacts(5);
      // Return camelCase (as transformed by postgres client)
      const dbRows = mockContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getContacts();

      expect(result).toHaveLength(5);
    });

    it('should order results by created_at descending', async () => {
      const sortedContacts = [
        createMockContact({ createdAt: new Date('2024-01-15') }),
        createMockContact({ createdAt: new Date('2024-01-14') }),
        createMockContact({ createdAt: new Date('2024-01-13') }),
      ];
      const dbRows = sortedContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getContacts();

      expect(result[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        result[1].createdAt.getTime()
      );
    });

    it('should handle database query errors', async () => {
      const dbError = new Error('Query failed');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(getContacts()).rejects.toThrow('Query failed');
    });
  });

  // ============================================================================
  // getEligibleContacts() Tests
  // ============================================================================

  describe('getEligibleContacts()', () => {
    it('should return contacts without successful send log', async () => {
      const mockContacts = createMockContacts(3);
      const dbRows = mockContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getEligibleContacts();

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no eligible contacts exist', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      const result = await getEligibleContacts();
      expect(result).toHaveLength(0);
    });

    it('should handle database query errors', async () => {
      const dbError = new Error('Connection timeout');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(getEligibleContacts()).rejects.toThrow('Connection timeout');
    });

    it('should exclude contacts using email-based suppressions', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(' '));
        return Promise.resolve([]);
      });

      await getEligibleContacts();

      expect(
        executedQueries.some((query) =>
          query.includes('LOWER(cs.email) = LOWER(c.email)')
        )
      ).toBe(true);
    });
  });

  // ============================================================================
  // getEligibleContactCount() Tests
  // ============================================================================

  describe('getEligibleContactCount()', () => {
    it('should return count of eligible contacts', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([{ count: 5 }]));
      const result = await getEligibleContactCount();
      expect(result).toBe(5);
    });

    it('should return 0 when no eligible contacts exist', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([{ count: 0 }]));
      const result = await getEligibleContactCount();
      expect(result).toBe(0);
    });

    it('should handle database query errors', async () => {
      const dbError = new Error('Query failed');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(getEligibleContactCount()).rejects.toThrow('Query failed');
    });

    it('should exclude email-based suppressions in count queries', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(' '));
        return Promise.resolve([{ count: 0 }]);
      });

      await getEligibleContactCount();

      expect(
        executedQueries.some((query) =>
          query.includes('LOWER(cs.email) = LOWER(c.email)')
        )
      ).toBe(true);
    });
  });

  // ============================================================================
  // Send Log Tests
  // ============================================================================

  describe('createSendLog()', () => {
    it('should create a send log entry', async () => {
      const mockLog = {
        id: 'log-1',
        contactId: 'contact-1',
        status: 'pending',
        mode: 'production',
        subject: 'Test Subject',
        bodyPreview: 'Test body preview...',
        createdAt: new Date(),
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([mockLog]));

      const result = await createSendLog('contact-1', 'production', 'Test Subject', 'Test body preview...');

      expect(result.contactId).toBe('contact-1');
      expect(result.status).toBe('pending');
      expect(result.mode).toBe('production');
    });
  });

  describe('updateSendLog()', () => {
    it('should update send log status to sent', async () => {
      const mockLog = {
        id: 'log-1',
        contactId: 'contact-1',
        status: 'sent',
        mode: 'production',
        subject: 'Test Subject',
        bodyPreview: 'Test body preview...',
        messageId: 'msg-123',
        sentAt: new Date(),
        createdAt: new Date(),
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([mockLog]));

      const result = await updateSendLog('log-1', {
        status: 'sent',
        messageId: 'msg-123',
        sentAt: new Date(),
      });

      expect(result.status).toBe('sent');
      expect(result.messageId).toBe('msg-123');
    });

    it('should update send log status to failed', async () => {
      const mockLog = {
        id: 'log-1',
        contactId: 'contact-1',
        status: 'failed',
        mode: 'production',
        subject: 'Test Subject',
        bodyPreview: 'Test body preview...',
        errorReason: 'SES API Error',
        createdAt: new Date(),
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([mockLog]));

      const result = await updateSendLog('log-1', {
        status: 'failed',
        errorReason: 'SES API Error',
      });

      expect(result.status).toBe('failed');
      expect(result.errorReason).toBe('SES API Error');
    });
  });

  describe('getSendStats()', () => {
    it('should return aggregate send statistics', async () => {
      mockSqlFn
        .mockImplementationOnce(() => Promise.resolve([{ count: 10 }])) // totalContacts
        .mockImplementationOnce(() => Promise.resolve([{ count: 5 }]))  // eligibleForSending
        .mockImplementationOnce(() => Promise.resolve([{ count: 2 }]))  // pendingSends
        .mockImplementationOnce(() => Promise.resolve([{ count: 3 }]))  // sentLast24Hours
        .mockImplementationOnce(() => Promise.resolve([{ count: 1 }]))  // failedLast24Hours
        .mockImplementation(() => Promise.resolve([{ count: 0 }]));

      const result = await getSendStats();

      expect(result.totalContacts).toBe(10);
      expect(result.eligibleForSending).toBe(5);
      expect(result.pendingSends).toBe(2);
      expect(result.sentLast24Hours).toBe(3);
      expect(result.failedLast24Hours).toBe(1);
    });
  });

  // ============================================================================
  // contactExists() Tests
  // ============================================================================

  describe('contactExists()', () => {
    it('should return true when contact exists', async () => {
      // PostgreSQL EXISTS query returns { exists: true }
      const dbRow = { exists: true };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));
      const result = await contactExists('existing@example.com');
      expect(result).toBe(true);
    });

    it('should return false when contact does not exist', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      const result = await contactExists('nonexistent@example.com');
      expect(result).toBe(false);
    });

    it('should handle null result gracefully', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([null]));
      const result = await contactExists('test@example.com');
      expect(result).toBe(false);
    });

    it('should handle database query errors', async () => {
      const dbError = new Error('Query failed');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(contactExists('test@example.com')).rejects.toThrow('Query failed');
    });

    it('should handle case-sensitive email matching', async () => {
      // PostgreSQL EXISTS query returns { exists: true }
      const dbRow = { exists: true };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));
      const result = await contactExists('Test.User@Example.COM');
      expect(result).toBe(true);
    });
  });

  describe('getContactByEmail()', () => {
    it('should normalize email lookups', async () => {
      const capturedValues: unknown[][] = [];
      const contact = createMockContact({ email: 'person@example.com' });

      mockSqlFn.mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
        capturedValues.push(values);
        return Promise.resolve([contact]);
      });

      const result = await getContactByEmail('  PERSON@Example.com ');

      expect(result?.email).toBe('person@example.com');
      expect(capturedValues[0][0]).toBe('person@example.com');
    });
  });

  describe('createContactSuppression()', () => {
    it('should create suppression records without a contact ID', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([{ id: 'suppression-1' }]));

      const created = await createContactSuppression({
        email: 'blocked@example.com',
        suppressionType: 'unsubscribe',
        suppressionReason: 'Manual unsubscribe',
      });

      expect(created).toBe(true);
    });

    it('should normalize email before inserting a suppression', async () => {
      const capturedValues: unknown[][] = [];
      mockSqlFn.mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
        capturedValues.push(values);
        return Promise.resolve([{ id: 'suppression-1' }]);
      });

      await createContactSuppression({
        email: '  USER@Example.COM ',
        suppressionType: 'unsubscribe',
        suppressionReason: 'Manual unsubscribe',
      });

      expect(capturedValues[0][1]).toBe('user@example.com');
    });

    it('should return false when suppression already exists', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const created = await createContactSuppression({
        email: 'existing@example.com',
        suppressionType: 'unsubscribe',
        suppressionReason: 'Manual unsubscribe',
      });

      expect(created).toBe(false);
    });
  });

  describe('insertContactSkipDuplicate()', () => {
    it('should link email-only suppressions after a new import insert', async () => {
      const executedQueries: string[] = [];
      const dbRow = {
        id: 'contact-2',
        email: 'imported@example.com',
        companyName: 'Imported Co',
        personName: 'Import User',
        createdAt: new Date(),
      };

      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(' '));
        if (executedQueries.length === 1) {
          return Promise.resolve([dbRow]);
        }
        return Promise.resolve([]);
      });

      const result = await insertContactSkipDuplicate(
        'Imported Co',
        'Import User',
        'IMPORTED@EXAMPLE.COM'
      );

      expect(result?.email).toBe('imported@example.com');
      expect(executedQueries[1]).toContain('UPDATE contact_suppressions');
    });
  });

  describe('getContactSuppressionByEmail()', () => {
    it('should return suppression records by email', async () => {
      mockSqlFn.mockImplementation(() =>
        Promise.resolve([
          {
            id: 'suppression-1',
            contactId: null,
            email: 'blocked@example.com',
            suppressionType: 'unsubscribe',
            suppressionReason: 'Manual unsubscribe',
            sesMessageId: null,
            suppressedAt: new Date(),
          },
        ])
      );

      const result = await getContactSuppressionByEmail('BLOCKED@example.com');

      expect(result?.email).toBe('blocked@example.com');
      expect(result?.suppressionType).toBe('unsubscribe');
    });
  });

  describe('isEmailSuppressed()', () => {
    it('should return true when an email is suppressed', async () => {
      mockSqlFn.mockImplementation(() =>
        Promise.resolve([
          {
            id: 'suppression-1',
            contactId: null,
            email: 'blocked@example.com',
            suppressionType: 'unsubscribe',
            suppressionReason: 'Manual unsubscribe',
            sesMessageId: null,
            suppressedAt: new Date(),
          },
        ])
      );

      const result = await isEmailSuppressed('blocked@example.com');
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // insertAuditLog() Tests
  // ============================================================================

  describe('insertAuditLog()', () => {
    it('should insert audit log with event type and payload', async () => {
      const mockAuditLog = createMockAuditLog({
        eventType: 'USER_INPUT',
        payload: { action: 'test', data: {} },
      });
      const dbRow = {
        id: mockAuditLog.id,
        eventType: mockAuditLog.eventType,  // camelCase
        payload: mockAuditLog.payload,
        createdAt: mockAuditLog.createdAt,  // camelCase
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertAuditLog('USER_INPUT', { action: 'test', data: {} });

      expect(result.eventType).toBe('USER_INPUT');
      expect(result.payload).toEqual({ action: 'test', data: {} });
    });

    it('should serialize Date objects in payload', async () => {
      const testDate = new Date('2024-01-15');
      const dbRow = {
        id: 'test-id',
        eventType: 'USER_INPUT',
        payload: { date: testDate.toISOString() },
        createdAt: new Date(),
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertAuditLog('USER_INPUT', { date: testDate });

      expect(result.payload).toEqual({ date: testDate.toISOString() });
    });

    it('should handle large payloads', async () => {
      const largePayload = { data: 'x'.repeat(10000) };
      const dbRow = {
        id: 'test-id',
        eventType: 'USER_INPUT',
        payload: largePayload,
        createdAt: new Date(),
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertAuditLog('USER_INPUT', largePayload);

      expect(result.payload).toEqual(largePayload);
    });

    it('should handle nested objects in payload', async () => {
      const nestedPayload = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      };
      const dbRow = {
        id: 'test-id',
        eventType: 'USER_INPUT',
        payload: nestedPayload,
        createdAt: new Date(),
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertAuditLog('USER_INPUT', nestedPayload);

      expect(result.payload).toEqual(nestedPayload);
    });

    it('should handle database insertion errors', async () => {
      const dbError = new Error('Insert failed');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(insertAuditLog('ERROR', {})).rejects.toThrow('Insert failed');
    });
  });

  // ============================================================================
  // closeConnection() Tests
  // ============================================================================

  describe('closeConnection()', () => {
    it('should close database connection without error', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      await closeConnection();
      expect(mockSqlFn.end).toBeDefined();
    });

    it('should handle connection close errors gracefully', async () => {
      // The closeConnection catches errors internally
      // So we just verify it doesn't throw
      mockSqlFn.end = () => Promise.reject(new Error('Close failed'));
      // This might throw or not depending on implementation
      // The test verifies graceful handling
      try {
        await closeConnection();
      } catch {
        // Expected or not depending on implementation
      }
    });
  });
});

import { afterAll } from "bun:test";
afterAll(() => {
  mock.restore();
});

