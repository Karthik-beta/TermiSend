/**
 * Unit Tests for Importer Module
 * Tests Excel file import with mocked filesystem and database
 */

import { afterAll, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import type { ImportResult } from '../../src/types.js';

// ============================================================================
// Mock Setup - Must be defined before importing the module under test
// ============================================================================

// Create mock for insertContactSkipDuplicate
const mockInsertContactSkipDuplicate = mock((companyName: string, personName: string, email: string) => {
  return Promise.resolve(true); // Default: insert succeeds
}) as Mock<(companyName: string, personName: string, email: string) => Promise<boolean>>;

// Mock the db module
mock.module('../../src/db.js', () => ({
  insertContactSkipDuplicate: mockInsertContactSkipDuplicate,
}));

// Mock the logger module
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

// Now import the module under test after mocking
const { importExcelFile } = await import('../../src/importer.js');

// Use allowed directory for tests (process.cwd()/data)
const TEST_DIR = resolve(process.cwd(), 'data');

describe('Importer Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockInsertContactSkipDuplicate.mockClear();
    mockLogger.logExcelImportStart.mockClear();
    mockLogger.logExcelImportRowValid.mockClear();
    mockLogger.logExcelImportRowInvalid.mockClear();
    mockLogger.logExcelImportComplete.mockClear();
    mockLogger.logError.mockClear();
    mockLogger.info.mockClear();
  });

  describe('importExcelFile() - Basic functionality', () => {
    it('should validate required columns', async () => {
      // Ensure test directory exists
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-bad-columns.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company', 'Name', 'E-mail']); // Wrong headers
      await workbook.xlsx.writeFile(filePath);

      await expect(importExcelFile(filePath)).rejects.toThrow('Missing required columns');
    });

    it('should handle file not found', async () => {
      await expect(importExcelFile(join(TEST_DIR, 'nonexistent-file.xlsx'))).rejects.toThrow('File not found');
    });

    it('should parse Excel file structure without crashing', async () => {
      // Ensure test directory exists
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-valid.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'john@acme.com']);
      await workbook.xlsx.writeFile(filePath);

      // Mock successful insertion
      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(1);
      expect(result.insertedCount).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });

    it('should import when the first worksheet has a non-sequential sheet ID', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-non-sequential-sheet-id.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.id = 2;
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'john@acme.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(1);
      expect(result.insertedCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });

    it('should handle rows with various data types', async () => {
      // Ensure test directory exists
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-data-types.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      // Mix of strings and numbers
      worksheet.addRow([12345, 67890, 'test@example.com']);
      worksheet.addRow(['', '', '']); // Empty row
      worksheet.addRow(['TechCo', 'Jane', 'jane@techco.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(3);
      expect(result.insertedCount).toBe(2); // Empty row is skipped
    });
  });

  describe('importExcelFile() - Email Normalization', () => {
    it('should normalize email to lowercase and trim whitespace', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-normalization.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Test Corp', 'John', '  John@Example.COM  ']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      await importExcelFile(filePath);

      // Verify the email was normalized before being passed to insertContactSkipDuplicate
      const lastCall = mockInsertContactSkipDuplicate.mock.calls[0];
      expect(lastCall[2]).toBe('john@example.com'); // normalized: lowercase and trimmed
    });

    it('should handle mixed case emails consistently', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-mixed-case.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'USER@EXAMPLE.COM']);
      worksheet.addRow(['Company 2', 'User 2', 'User@Example.com']);
      await workbook.xlsx.writeFile(filePath);

      // First email is inserted, second is caught as file-internal duplicate
      // so insertContactSkipDuplicate is only called once
      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      // First email normalized and inserted, second skipped as file-internal duplicate
      const calls = mockInsertContactSkipDuplicate.mock.calls as unknown[][];
      expect(calls[0][2]).toBe('user@example.com');
      expect(mockInsertContactSkipDuplicate).toHaveBeenCalledTimes(1);
      expect(result.insertedCount).toBe(1);
      expect(result.skippedCount).toBe(1); // File-internal duplicate
    });
  });

  describe('importExcelFile() - File-Internal Duplicate Detection', () => {
    it('should skip duplicate emails within the same file', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-internal-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'john@example.com']);
      worksheet.addRow(['Other Corp', 'Jane Smith', 'john@example.com']); // Duplicate email
      worksheet.addRow(['Third Corp', 'Bob Wilson', 'bob@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      // Only 2 insertions: john@example.com once, bob@example.com once
      // Second john@example.com is skipped as file-internal duplicate
      // insertContactSkipDuplicate is only called for non-duplicate emails
      expect(result.insertedCount).toBe(2);
      expect(result.skippedCount).toBe(1);
      expect(result.successCount).toBe(2);
      expect(mockInsertContactSkipDuplicate).toHaveBeenCalledTimes(2);
    });

    it('should detect duplicates regardless of case or whitespace in file', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-case-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company A', 'User A', 'USER@EXAMPLE.COM']);
      worksheet.addRow(['Company B', 'User B', '  user@example.com  ']);
      worksheet.addRow(['Company C', 'User C', 'User@Example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      // Only first one is inserted, others skipped as duplicates
      expect(result.insertedCount).toBe(1);
      expect(result.skippedCount).toBe(2);
    });

    it('should log duplicate detection errors for file-internal duplicates', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-log-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company A', 'User A', 'duplicate@test.com']);
      worksheet.addRow(['Company B', 'User B', 'duplicate@test.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      await importExcelFile(filePath);

      // Verify logExcelImportRowInvalid was called for the duplicate
      expect(mockLogger.logExcelImportRowInvalid).toHaveBeenCalled();
      const invalidCalls = mockLogger.logExcelImportRowInvalid.mock.calls as unknown[][];
      const invalidCall = invalidCalls.find(
        call => call[1] === 'Duplicate email in file'
      );
      expect(invalidCall).toBeDefined();
      expect(invalidCall![0]).toBe(3); // Row 3 (1-based, including header)
    });
  });

  describe('importExcelFile() - DB Duplicate Detection', () => {
    it('should count existing contacts in existingCount instead of updating', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-db-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Acme Corp', 'John Doe', 'existing@example.com']);
      await workbook.xlsx.writeFile(filePath);

      // Mock returning false (email already exists in DB)
      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(false));

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(0);
      expect(result.existingCount).toBe(1);
      expect(result.successCount).toBe(0);
    });

    it('should handle mixed inserts and existing contacts', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-mixed-duplicates.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'new1@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'existing@example.com']);
      worksheet.addRow(['Company 3', 'User 3', 'new2@example.com']);
      worksheet.addRow(['Company 4', 'User 4', 'existing2@example.com']);
      await workbook.xlsx.writeFile(filePath);

      // Control DB responses for each unique email
      mockInsertContactSkipDuplicate
        .mockImplementationOnce(() => Promise.resolve(true))   // new1 - inserted
        .mockImplementationOnce(() => Promise.resolve(false))  // existing - already in DB
        .mockImplementationOnce(() => Promise.resolve(true))   // new2 - inserted
        .mockImplementationOnce(() => Promise.resolve(false)); // existing2 - already in DB

      const result = await importExcelFile(filePath);

      expect(result.insertedCount).toBe(2);
      expect(result.existingCount).toBe(2);
      expect(result.successCount).toBe(2);
    });
  });

  describe('importExcelFile() - Import Summary Accuracy', () => {
    it('should correctly populate all count fields', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-summary.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'new@example.com']);        // Will be inserted
      worksheet.addRow(['Company 2', 'User 2', 'duplicate@example.com']); // First occurrence
      worksheet.addRow(['Company 3', 'User 3', 'duplicate@example.com']); // File-internal duplicate (skipped)
      worksheet.addRow(['Company 4', 'User 4', 'existing@example.com']);  // Already in DB
      worksheet.addRow(['Company 5', '', 'invalid-email']);               // Validation error
      await workbook.xlsx.writeFile(filePath);

      // Only called for unique valid emails: new@example.com, duplicate@example.com (1st), existing@example.com
      mockInsertContactSkipDuplicate
        .mockImplementationOnce(() => Promise.resolve(true))   // new@example.com - inserted
        .mockImplementationOnce(() => Promise.resolve(true))   // duplicate@example.com (1st) - inserted
        .mockImplementationOnce(() => Promise.resolve(false)); // existing@example.com - already in DB

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(5);
      expect(result.insertedCount).toBe(2); // new@example.com + duplicate@example.com (1st)
      expect(result.skippedCount).toBe(1);  // One file-internal duplicate (2nd duplicate@example.com)
      expect(result.existingCount).toBe(1); // existing@example.com
      expect(result.failedCount).toBe(1);   // Invalid email
      expect(result.successCount).toBe(2);  // Backward compatibility = insertedCount
    });

    it('should maintain backward compatibility with successCount', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-backward-compat.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'user1@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'user2@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      const result = await importExcelFile(filePath);

      // successCount should equal insertedCount for backward compatibility
      expect(result.successCount).toBe(2);
      expect(result.insertedCount).toBe(2);
    });

    it('should pass correct counts to logExcelImportComplete', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-log-complete.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      worksheet.addRow(['Company 1', 'User 1', 'user1@example.com']);
      worksheet.addRow(['Company 2', 'User 2', 'user2@example.com']);
      await workbook.xlsx.writeFile(filePath);

      mockInsertContactSkipDuplicate.mockImplementation(() => Promise.resolve(true));

      await importExcelFile(filePath);

      expect(mockLogger.logExcelImportComplete).toHaveBeenCalledWith({
        totalRows: 2,
        successCount: 2,
        failedCount: 0,
        insertedCount: 2,
        skippedCount: 0,
        existingCount: 0,
      });
    });

    it('should handle empty file with zero counts', async () => {
      try { mkdirSync(TEST_DIR, { recursive: true }); } catch { /* already exists */ }
      const filePath = join(TEST_DIR, 'test-empty.xlsx');

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contacts');
      worksheet.addRow(['Company Name', 'Person Name', 'Email']);
      // No data rows
      await workbook.xlsx.writeFile(filePath);

      const result = await importExcelFile(filePath);

      expect(result.totalRows).toBe(0);
      expect(result.insertedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.existingCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.successCount).toBe(0);
    });
  });
});

afterAll(() => {
  mock.restore();
});
