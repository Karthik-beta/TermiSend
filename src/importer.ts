/**
 * Excel Import module for TermiSend (Part A)
 * Handles reading Excel files, validating data with Zod, and storing contacts
 */

import ExcelJs from 'exceljs';
import { type ZodIssue, z } from 'zod';
import { sql } from './db.js';
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
    email: cellToString(row.Email).toLowerCase(),
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
    const errors = result.error.issues
      .map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
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
  result: ImportResult
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

  try {
    // Insert contact
    await sql`
      INSERT INTO contacts (company_name, person_name, email, status)
      VALUES (${validation.data.companyName}, ${validation.data.personName}, ${validation.data.email}, 'pending')
      ON CONFLICT (email) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        person_name = EXCLUDED.person_name,
        status = 'pending'
    `;

    result.successCount++;
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
    errors: [],
  };

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

    // Get the first worksheet
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }

    // Validate headers
    const headerRow = worksheet.getRow(1);
    const headers = headerRow.values as (string | number)[];
    const headerStrings = headers.map((h) => cellToString(h));

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
      await processRow(worksheet.getRow(rowNumber), rowNumber, headerStrings, result);
    }

    // Log import completion
    await logger.logExcelImportComplete({
      totalRows: result.totalRows,
      successCount: result.successCount,
      failedCount: result.failedCount,
    });

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
