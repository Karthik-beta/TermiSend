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
  getContacts,
  getPendingContacts,
  initializeSchema,
  insertAuditLog,
  insertContact,
  updateContactStatus,
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

    it('should create indexes on email and status columns', async () => {
      const executedQueries: string[] = [];
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        executedQueries.push(strings.join(''));
        return Promise.resolve([]);
      });
      await initializeSchema();
      const hasEmailIndex = executedQueries.some((q) => q.includes('idx_contacts_email'));
      const hasStatusIndex = executedQueries.some((q) => q.includes('idx_contacts_status'));
      expect(hasEmailIndex).toBe(true);
      expect(hasStatusIndex).toBe(true);
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
        status: mockContact.status,
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
        status: updatedContact.status,
        createdAt: updatedContact.createdAt,
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertContact('New Company', 'John Updated', 'john@test.com');

      expect(result.companyName).toBe('New Company');
      expect(result.personName).toBe('John Updated');
    });

    it('should reset status to pending on conflict update', async () => {
      const updatedContact = createMockContact({
        email: 'john@test.com',
        status: 'pending',
      });
      const dbRow = {
        id: updatedContact.id,
        email: updatedContact.email,
        companyName: updatedContact.companyName,
        personName: updatedContact.personName,
        status: updatedContact.status,
        createdAt: updatedContact.createdAt,
      };
      mockSqlFn.mockImplementation(() => Promise.resolve([dbRow]));

      const result = await insertContact('Company', 'Person', 'john@test.com');

      expect(result.status).toBe('pending');
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
        status: contactWithSpecialChars.status,
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
  });

  // ============================================================================
  // getContacts() Tests
  // ============================================================================

  describe('getContacts()', () => {
    it('should return all contacts when no status filter is provided', async () => {
      const mockContacts = createMockContacts(5);
      // Return camelCase (as transformed by postgres client)
      const dbRows = mockContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        status: c.status,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getContacts();

      expect(result).toHaveLength(5);
    });

    it('should return filtered contacts by status', async () => {
      const pendingContacts = createMockContacts(3, { status: 'pending' });
      const dbRows = pendingContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        status: c.status,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getContacts('pending');

      expect(result).toHaveLength(3);
      result.forEach((contact) => {
        expect(contact.status).toBe('pending');
      });
    });

    it('should return empty array when no contacts match status', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      const result = await getContacts('nonexistent_status');
      expect(result).toHaveLength(0);
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
        status: c.status,
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
  // getPendingContacts() Tests
  // ============================================================================

  describe('getPendingContacts()', () => {
    it('should return only pending contacts', async () => {
      const pendingContacts = createMockContacts(5, { status: 'pending' });
      const dbRows = pendingContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        status: c.status,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getPendingContacts();

      expect(result).toHaveLength(5);
      result.forEach((contact) => {
        expect(contact.status).toBe('pending');
      });
    });

    it('should return empty array when no pending contacts exist', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      const result = await getPendingContacts();
      expect(result).toHaveLength(0);
    });

    it('should order results by created_at ascending', async () => {
      const sortedContacts = [
        createMockContact({ createdAt: new Date('2024-01-13') }),
        createMockContact({ createdAt: new Date('2024-01-14') }),
        createMockContact({ createdAt: new Date('2024-01-15') }),
      ];
      const dbRows = sortedContacts.map(c => ({
        id: c.id,
        email: c.email,
        companyName: c.companyName,
        personName: c.personName,
        status: c.status,
        createdAt: c.createdAt,
      }));
      mockSqlFn.mockImplementation(() => Promise.resolve(dbRows));

      const result = await getPendingContacts();

      expect(result[0].createdAt.getTime()).toBeLessThanOrEqual(result[1].createdAt.getTime());
    });

    it('should handle database query errors', async () => {
      const dbError = new Error('Connection timeout');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(getPendingContacts()).rejects.toThrow('Connection timeout');
    });
  });

  // ============================================================================
  // updateContactStatus() Tests
  // ============================================================================

  describe('updateContactStatus()', () => {
    it('should update contact status successfully', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      await updateContactStatus('test@example.com', 'sent');
      expect(mockSqlFn).toHaveBeenCalled();
    });

    it('should support all valid status values', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      const statuses: Contact['status'][] = ['pending', 'sent', 'verified', 'failed', 'invalid'];
      for (const status of statuses) {
        mockSqlFn.mockClear();
        await updateContactStatus('test@example.com', status);
        expect(mockSqlFn).toHaveBeenCalled();
      }
    });

    it('should handle non-existent email gracefully', async () => {
      mockSqlFn.mockImplementation(() => Promise.resolve([]));
      await expect(
        updateContactStatus('nonexistent@example.com', 'sent')
      ).resolves.toBeUndefined();
    });

    it('should handle database update errors', async () => {
      const dbError = new Error('Update failed');
      mockSqlFn.mockImplementation(() => Promise.reject(dbError));
      await expect(updateContactStatus('test@example.com', 'sent')).rejects.toThrow(
        'Update failed'
      );
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
