/**
 * Excel Import module for TermiSend (Part A)
 * Handles reading Excel files, validating data with Zod, and storing contacts
 */

import ExcelJs from 'exceljs';
import { z } from 'zod';
import { insertContactSkipDuplicate } from './db.js';
import { emitAnalyticsEvent } from './events/bus.js';
import {
  type ContactDuplicateSkippedPayload,
  type ContactImportedPayload,
  createEvent,
  DomainEventType,
  domainEvents,
} from './events/index.js';
import { logger } from './logger.js';
import { validateImportPath } from './path-validator.js';
import type { ContactInput, ImportResult } from './types.js';

// ============================================================================
// Zod Validation Schema
// ============================================================================

const ContactSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  personName: z.string().min(1, 'Person name is required'),
  email: z.string().email('Invalid email format'),
});

type ValidatedContact = z.infer<typeof ContactSchema>;

// ============================================================================
// Excel Column Mapping
// ============================================================================

export const REQUIRED_COLUMNS = ['Company Name', 'Person Name', 'Email'] as const;

interface ExcelRow {
  'Company Name'?: string | number;
  'Person Name'?: string | number;
  Email?: string | number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert cell value to string safely
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return String(value).trim();
}

/**
 * Normalize row data from Excel
 */
function normalizeRow(row: ExcelRow): ContactInput {
  return {
    companyName: cellToString(row['Company Name']),
    personName: cellToString(row['Person Name']),
    email: cellToString(row.Email).toLowerCase().trim(),
  };
}

/**
 * Validate a single contact row
 */
function validateRow(
  rowData: ContactInput,
  _rowNumber: number
): { success: true; data: ValidatedContact } | { success: false; error: string } {
  const result = ContactSchema.safeParse(rowData);

  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { success: false, error: errors };
  }

  return { success: true, data: result.data };
}

// ============================================================================
// Row Processing Helper
// ============================================================================

/**
 * Process a single Excel row and insert into database
 */
async function processRow(
  row: ExcelJs.Row,
  rowNumber: number,
  headerStrings: string[],
  result: ImportResult,
  seenEmails: Set<string>,
  sourceFile: string
): Promise<void> {
  // Skip empty rows
  if (row.values === null || row.values === undefined) {
    return;
  }

  const rowData: ExcelRow = {
    'Company Name': row.getCell(headerStrings.indexOf('Company Name') + 1).value as string | number,
    'Person Name': row.getCell(headerStrings.indexOf('Person Name') + 1).value as string | number,
    Email: row.getCell(headerStrings.indexOf('Email') + 1).value as string | number,
  };

  const normalizedData = normalizeRow(rowData);

  // Skip rows with all empty values
  if (!normalizedData.companyName && !normalizedData.personName && !normalizedData.email) {
    return;
  }

  // Validate row
  const validation = validateRow(normalizedData, rowNumber);

  if (!validation.success) {
    result.failedCount++;
    result.errors.push({
      row: rowNumber,
      error: validation.error,
    });
    await logger.logExcelImportRowInvalid(rowNumber, validation.error, normalizedData);
    return;
  }

  // Check for file-internal duplicates
  const email = validation.data.email;
  if (seenEmails.has(email)) {
    result.skippedCount++;
    await logger.logExcelImportRowInvalid(rowNumber, 'Duplicate email in file', normalizedData);
    // Emit duplicate skipped event for file-internal duplicate
    try {
      const event = createEvent<ContactDuplicateSkippedPayload>(
        DomainEventType.CONTACT_DUPLICATE_SKIPPED,
        {
          email,
          sourceFile,
          rowNumber,
          duplicateSource: 'file',
        }
      );
      domainEvents.emit(event);
    } catch {
      // Silently ignore event emission errors
    }
    return;
  }
  seenEmails.add(email);

  try {
    // Insert contact, skip if already exists in DB
    const insertedContact = await insertContactSkipDuplicate(
      validation.data.companyName,
      validation.data.personName,
      validation.data.email
    );

    if (insertedContact) {
      result.insertedCount++;
      result.successCount++; // Keep for backward compatibility
      // Emit contact imported event
      try {
        const event = createEvent<ContactImportedPayload>(DomainEventType.CONTACT_IMPORTED, {
          contactId: insertedContact.id,
          email: insertedContact.email,
          companyName: insertedContact.companyName,
          personName: insertedContact.personName,
          sourceFile,
          rowNumber,
        });
        domainEvents.emit(event);
      } catch {
        // Silently ignore event emission errors
      }
    } else {
      result.existingCount++;
      // Emit duplicate skipped event for database duplicate
      try {
        const event = createEvent<ContactDuplicateSkippedPayload>(
          DomainEventType.CONTACT_DUPLICATE_SKIPPED,
          {
            email,
            sourceFile,
            rowNumber,
            duplicateSource: 'database',
          }
        );
        domainEvents.emit(event);
      } catch {
        // Silently ignore event emission errors
      }
    }
    await logger.logExcelImportRowValid(rowNumber, { rowNumber });
  } catch (error) {
    result.failedCount++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push({
      row: rowNumber,
      error: errorMsg,
    });
    await logger.logExcelImportRowInvalid(rowNumber, errorMsg, { rowNumber });
  }
}

// ============================================================================
// Main Import Function
// ============================================================================

/**
 * Import contacts from an Excel file
 * @param filePath - Path to the Excel file
 * @returns ImportResult with counts and any errors
 */
export async function importExcelFile(filePath: string): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: 0,
    successCount: 0,
    failedCount: 0,
    insertedCount: 0,
    skippedCount: 0,
    existingCount: 0,
    errors: [],
  };

  // Track emails seen in this file to detect file-internal duplicates
  const seenEmails = new Set<string>();

  // Validate file path for security
  const pathValidation = validateImportPath(filePath);
  if (!pathValidation.valid) {
    throw new Error(`Invalid file path: ${pathValidation.error}`);
  }

  // Use the sanitized path
  const sanitizedPath = pathValidation.sanitizedPath;

  try {
    // Validate file exists and is readable
    const file = Bun.file(sanitizedPath);
    const exists = await file.exists();
    if (!exists) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Read Excel file
    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.readFile(sanitizedPath);

    // Use the first actual worksheet rather than worksheet ID 1.
    // Some valid workbooks can have a first visible sheet with a non-sequential ID.
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }

    // Validate headers
    const headerRow = worksheet.getRow(1);
    const headers = headerRow.values as (string | number)[];
    // Filter out empty strings that result from ExcelJS's 1-based indexing (index 0 is always undefined)
    const headerStrings = headers.map((h) => cellToString(h)).filter((h) => h.length > 0);

    const missingColumns = REQUIRED_COLUMNS.filter((col) => !headerStrings.includes(col));

    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }

    // Count data rows (excluding header)
    const dataRows = worksheet.rowCount - 1;
    result.totalRows = dataRows;

    // Log import start
    await logger.logExcelImportStart(sanitizedPath, dataRows);

    // Process each row
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      await processRow(
        worksheet.getRow(rowNumber),
        rowNumber,
        headerStrings,
        result,
        seenEmails,
        sanitizedPath
      );
    }

    // Log import completion
    await logger.logExcelImportComplete({
      totalRows: result.totalRows,
      successCount: result.successCount,
      failedCount: result.failedCount,
      insertedCount: result.insertedCount,
      skippedCount: result.skippedCount,
      existingCount: result.existingCount,
    });

    // Emit analytics event for imported contacts
    if (result.insertedCount > 0) {
      try {
        emitAnalyticsEvent({ type: 'contact:imported', count: result.insertedCount });
      } catch {
        // Silently ignore event emission errors
      }
    }

    // Simple console summary
    logger.info(
      `Import complete: ${result.insertedCount} inserted, ${result.skippedCount} skipped (duplicates in file), ${result.existingCount} existing (already in DB)`
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError('Excel Import', errorMessage, { filePath: sanitizedPath });
    throw error;
  }
}

// ============================================================================
// Export Schema for External Use
// ============================================================================

export { ContactSchema };
export type { ValidatedContact };
