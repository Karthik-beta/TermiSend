/**
 * Unit Tests for Importer Module
 * Tests Excel file import with mocked filesystem and database
 */

import { afterAll, beforeEach, describe, expect, it, mock, type Mock } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import type { Contact, ContactSuppression } from '../../src/types.js';

function createMockContact(
  companyName: string,
  personName: string,
  email: string,
  id: string = `contact-${email}`
): Contact {
  return {
    id,
    companyName,
    personName,
    email,
    createdAt: new Date(),
  };
}

const mockInsertContactSkipDuplicate = mock((companyName: string, personName: string, email: string) => {
  return Promise.resolve(createMockContact(companyName, personName, email));
}) as Mock<
  (companyName: string, personName: string, email: string) => Promise<Contact | null>
>;

const mockGetContactSuppressionByEmail = mock((_email: string) => {
  return Promise.resolve(null);
}) as Mock<(email: string) => Promise<ContactSuppression | null>>;

mock.module('../../src/db.js', () => ({
  getContactSuppressionByEmail: mockGetContactSuppressionByEmail,
  insertContactSkipDuplicate: mockInsertContactSkipDuplicate,
  sql: mock(() => Promise.resolve([])),
}));

const mockLogger = {
  logExcelImportStart: mock(() => Promise.resolve()),
  logExcelImportRowValid: mock(() => Promise.resolve()),
  logExcelImportRowInvalid: mock(() => Promise.resolve()),
  logExcelImportComplete: mock(() => Promise.resolve()),
  logError: mock(() => Promise.resolve()),
  info: mock(() => Promise.resolve()),
};

mock.module('../../src/logger.js', () => ({
  logger: mockLogger,
}));

const { importExcelFile } = await import('../../src/importer.js');

const TEST_DIR = resolve(process.cwd(), 'data');

describe('Importer Module', () => {
  beforeEach(() => {
    mockInsertContactSkipDuplicate.mockClear();
    mockGetContactSuppressionByEmail.mockClear();
    mockLogger.logExcelImportStart.mockClear();
    mockLogger.logExcelImportRowValid.mockClear();
    mockLogger.logExcelImportRowInvalid.mockClear();
    mockLogger.logExcelImportComplete.mockClear();
    mockLogger.logError.mockClear();
    mockLogger.info.mockClear();

    mockInsertContactSkipDuplicate.mockImplementation((companyName, personName, email) =>
      Promise.resolve(createMockContact(companyName, personName, email))
    );
    mockGetContactSuppressionByEmail.mockImplementation(() => Promise.resolve(null));
  });

  describe('importExcelFile() - Basic functionality', () => {
    it('should validate required columns', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-bad-columns.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company', 'Name', 'E-mail']);
      await workbook.xlsx.writeFile(filePath);

      await expect(importExcelFile(filePath)).rejects.toThrow('Missing required columns');
    });

    it('should handle file not found', async () => {
      await expect(importExcelFile(join(TEST_DIR, 'nonexistent-file.xlsx'))).rejects.toThrow(
        'File not found'
      );
    });

    it('should parse Excel file structure without crashing', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-valid.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'john@acme.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(1);
      expect(result.insertedCount).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.blockedCount).toBe(0);
    });

    it('should import when the first worksheet has a non-sequential sheet ID', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-non-sequential-sheet-id.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.id = 2;
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'john@acme.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(1);
      expect(result.insertedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.blockedCount).toBe(0);
    });

    it('should handle rows with various data types', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-data-types.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow([12345, 67890, 'test@example.com']);
      worksheet.addRow(['', '', '']);
      worksheet.addRow(['TechCo', 'Jane', 'jane@techco.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(3);
      expect(result.insertedCount).toBe(2);
      expect(result.blockedCount).toBe(0);
    });
  });

  describe('importExcelFile() - Email Normalization', () => {
    it('should normalize email to lowercase and trim whitespace', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-normalization.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Test Corp', 'John', '  John@Example.COM  ']);
      await workbook.xlsx.writeFile(filePath);

      await importExcelFile(filePath);

      const lastCall = mockInsertContactSkipDuplicate.mock.calls[0];
      expect(lastCall[2]).toBe('john@example.com');
    });

    it('should handle mixed case emails consistently', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-mixed-case.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'USER@EXAMPLE.COM']);
      worksheet.addRow(['Company 2', 'User 2', 'User@Example.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      const calls = mockInsertContactSkipDuplicate.mock.calls as unknown[][];
      expect(calls[0][2]).toBe('user@example.com');
      expect(mockInsertContactSkipDuplicate).toHaveBeenCalledTimes(1);
      expect(result.insertedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
    });
  });

  describe('importExcelFile() - File-Internal Duplicate Detection', () => {
    it('should skip duplicate emails within the same file', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-internal-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'john@example.com']);
      worksheet.addRow(['Other Corp', 'Jane Smith', 'john@example.com']);
      worksheet.addRow(['Third Corp', 'Bob Wilson', 'bob@example.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.successCount).toBe(2);
      expect(mockInsertContactSkipDuplicate).toHaveBeenCalledTimes(2);
    });

    it('should detect duplicates regardless of case or whitespace in file', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-case-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company A', 'User A', 'USER@EXAMPLE.COM']);
      worksheet.addRow(['Company B', 'User B', '  user@example.com  ']);
      worksheet.addRow(['Company C', 'User C', 'User@Example.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(1);
      expect(result.skippedCount).toBe(2);
    });

    it('should log duplicate detection errors for file-internal duplicates', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-log-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company A', 'User A', 'duplicate@test.com']);
      worksheet.addRow(['Company B', 'User B', 'duplicate@test.com']);
      await workbook.xlsx.writeFile(filePath);

      await importExcelFile(filePath);

      expect(mockLogger.logExcelImportRowInvalid).toHaveBeenCalled();
      const invalidCalls = mockLogger.logExcelImportRowInvalid.mock.calls as unknown[][];
      const invalidCall = invalidCalls.find((call) => call[1] === 'Duplicate email in file');
      expect(invalidCall).toBeDefined();
      expect(invalidCall?.[0]).toBe(3);
    });
  });

  describe('importExcelFile() - DB Duplicate Detection', () => {
    it('should count existing contacts in existingCount instead of updating', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-db-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'existing@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(null));

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(0);
      expect(result.existingCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.blockedCount).toBe(0);
    });

    it('should handle mixed inserts and existing contacts', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-mixed-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'new1@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'existing@example.com']);
      worksheet.addRow(['Company 3', 'User 3', 'new2@example.com']);
      worksheet.addRow(['Company 4', 'User 4', 'existing2@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate
        .mockImplementationOnce((companyName, personName, email) =>
          Promise.resolve(createMockContact(companyName, personName, email))
        )
        .mockImplementationOnce(() => Promise.resolve(null))
        .mockImplementationOnce((companyName, personName, email) =>
          Promise.resolve(createMockContact(companyName, personName, email))
        )
        .mockImplementationOnce(() => Promise.resolve(null));

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(2);
      expect(result.existingCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.blockedCount).toBe(0);
    });
  });

  describe('importExcelFile() - Suppressed Contacts', () => {
    it('should count inserted suppressed emails as blocked', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-suppressed-insert.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Blocked Co', 'User One', 'blocked@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockGetContactSuppressionByEmail.mockImplementation(() =>
        Promise.resolve({
          id: 'suppression-1',
          contactId: null,
          email: 'blocked@example.com',
          suppressionType: 'bounce',
          suppressionReason: 'Bounce: Transient / MailboxFull',
          sesMessageId: null,
          suppressedAt: new Date(),
        })
      );

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.blockedCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });

    it('should count existing suppressed emails as blocked without failing import', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-suppressed-existing.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Blocked Co', 'User One', 'blocked-existing@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockGetContactSuppressionByEmail.mockImplementation(() =>
        Promise.resolve({
          id: 'suppression-2',
          contactId: 'contact-existing',
          email: 'blocked-existing@example.com',
          suppressionType: 'bounce',
          suppressionReason: 'Bounce: Permanent / General',
          sesMessageId: null,
          suppressedAt: new Date(),
        })
      );
      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(null));

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(0);
      expect(result.existingCount).toBe(1);
      expect(result.blockedCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });
  });

  describe('importExcelFile() - Import Summary Accuracy', () => {
    it('should correctly populate all count fields', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-summary.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'new@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'duplicate@example.com']);
      worksheet.addRow(['Company 3', 'User 3', 'duplicate@example.com']);
      worksheet.addRow(['Company 4', 'User 4', 'existing@example.com']);
      worksheet.addRow(['Company 5', '', 'invalid-email']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate
        .mockImplementationOnce((companyName, personName, email) =>
          Promise.resolve(createMockContact(companyName, personName, email))
        )
        .mockImplementationOnce((companyName, personName, email) =>
          Promise.resolve(createMockContact(companyName, personName, email))
        )
        .mockImplementationOnce(() => Promise.resolve(null));

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(5);
      expect(result.insertedCount).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.existingCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.successCount).toBe(2);
      expect(result.blockedCount).toBe(0);
    });

    it('should maintain backward compatibility with successCount', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-backward-compat.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'user1@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'user2@example.com']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.successCount).toBe(2);
      expect(result.insertedCount).toBe(2);
      expect(result.blockedCount).toBe(0);
    });

    it('should pass correct counts to logExcelImportComplete', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-log-complete.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'user1@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'user2@example.com']);
      await workbook.xlsx.writeFile(filePath);

      await importExcelFile(filePath);

      expect(mockLogger.logExcelImportComplete).toHaveBeenCalledWith({
        totalRows: 2,
        successCount: 2,
        failedCount: 0,
        insertedCount: 2,
        skippedCount: 0,
        existingCount: 0,
        blockedCount: 0,
      });
    });

    it('should handle empty file with zero counts', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch {}
      const filePath = join(TEST_DIR, 'test-empty.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(0);
      expect(result.insertedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.existingCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.blockedCount).toBe(0);
    });
  });
});

afterAll(() => {
  mock.restore();
});
