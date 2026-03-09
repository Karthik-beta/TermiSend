/**
 * Unit Tests for Template Generator Module
 * Ensures template stays in sync with the importer
 */

import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'bun:test';
import { join, resolve } from 'node:path';
import { unlinkSync, mkdirSync, existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { REQUIRED_COLUMNS, ContactSchema } from '../../src/importer.js';
import { generateTemplate, getTemplateHeaders } from '../../src/template-generator.js';

// Use allowed directory for tests (process.cwd()/data)
const TEST_DIR = resolve(process.cwd(), 'data');
const TEMPLATE_FILE = join(TEST_DIR, 'test-template-sync.xlsx');

describe('Template Generator', () => {
  // Ensure test directory exists
  beforeAll(() => {
    try {
      mkdirSync(TEST_DIR, { recursive: true });
    } catch {
      // Directory already exists
    }
  });

  // Delete template file before each test to avoid "file already exists" error
  beforeEach(() => {
    if (existsSync(TEMPLATE_FILE)) {
      try {
        unlinkSync(TEMPLATE_FILE);
      } catch {
        // File may not exist or already deleted
      }
    }
  });

  // Cleanup temp files after all tests
  afterAll(() => {
    if (existsSync(TEMPLATE_FILE)) {
      try {
        unlinkSync(TEMPLATE_FILE);
      } catch {
        // File may not exist or already deleted
      }
    }
  });

  describe('getTemplateHeaders()', () => {
    it('should return exactly the same array as REQUIRED_COLUMNS', () => {
      const headers = getTemplateHeaders();
      
      expect(headers).toBeDefined();
      expect(Array.isArray(headers)).toBe(true);
      expect(headers.length).toBe(REQUIRED_COLUMNS.length);
      
      // Verify each header matches
      headers.forEach((header, index) => {
        expect(header).toBe(REQUIRED_COLUMNS[index]);
      });
      
      // Verify arrays are equal
      expect(headers).toEqual([...REQUIRED_COLUMNS]);
    });

    it('should return array that mirrors REQUIRED_COLUMNS', () => {
      const headers = getTemplateHeaders();
      
      // Verify the returned array has same values (not frozen, but acts as source of truth)
      expect(Array.isArray(headers)).toBe(true);
      expect(headers.length).toBe(REQUIRED_COLUMNS.length);
      
      // Verify each value matches
      headers.forEach((header, index) => {
        expect(header).toBe(REQUIRED_COLUMNS[index]);
      });
    });
  });

  describe('Template headers match importer requirements', () => {
    it('should generate Excel file with headers matching REQUIRED_COLUMNS exactly', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      // Get first worksheet
      const worksheet = workbook.getWorksheet(1);
      expect(worksheet).toBeDefined();
      
      // Get header row
      const headerRow = worksheet!.getRow(1);
      const headers = headerRow.values as (string | number)[];
      
      // Convert to string array (skip first element which is empty in ExcelJS)
      const headerStrings = headers.slice(1).map(String);
      
      // Verify headers match REQUIRED_COLUMNS exactly
      expect(headerStrings).toHaveLength(REQUIRED_COLUMNS.length);
      expect(headerStrings).toEqual([...REQUIRED_COLUMNS]);
    });

    it('should have correct column order matching importer', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      const worksheet = workbook.getWorksheet(1);
      const headerRow = worksheet!.getRow(1);
      const headers = (headerRow.values as (string | number)[]).slice(1).map(String);
      
      // Verify specific column positions
      expect(headers[0]).toBe('Company Name');
      expect(headers[1]).toBe('Person Name');
      expect(headers[2]).toBe('Email');
    });
  });

  describe('Template has valid example row', () => {
    it('should contain at least one data row after header', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      const worksheet = workbook.getWorksheet(1);
      
      // Should have at least 2 rows (header + example)
      expect(worksheet!.rowCount).toBeGreaterThanOrEqual(2);
    });

    it('should contain example data that passes ContactSchema validation', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      const worksheet = workbook.getWorksheet(1);
      const dataRow = worksheet!.getRow(2); // Row 1 is header, Row 2 is example
      
      const rowData = {
        companyName: String(dataRow.getCell(1).value || ''),
        personName: String(dataRow.getCell(2).value || ''),
        email: String(dataRow.getCell(3).value || ''),
      };
      
      // Verify data passes ContactSchema validation
      const validation = ContactSchema.safeParse(rowData);
      
      expect(validation.success).toBe(true);
      
      if (validation.success) {
        expect(validation.data.companyName).toBeTruthy();
        expect(validation.data.personName).toBeTruthy();
        expect(validation.data.email).toBeTruthy();
      }
    });

    it('should have example data in all three columns', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      const worksheet = workbook.getWorksheet(1);
      const dataRow = worksheet!.getRow(2);
      
      const companyName = dataRow.getCell(1).value;
      const personName = dataRow.getCell(2).value;
      const email = dataRow.getCell(3).value;
      
      // All cells should have values
      expect(companyName).toBeDefined();
      expect(companyName).not.toBe('');
      expect(personName).toBeDefined();
      expect(personName).not.toBe('');
      expect(email).toBeDefined();
      expect(email).not.toBe('');
    });
  });

  describe('Template is importable by importer', () => {
    it('should have valid Excel structure with worksheet named Contacts', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      // Should have at least one worksheet
      expect(workbook.worksheets.length).toBeGreaterThan(0);
      
      // First worksheet should be named "Contacts"
      const worksheet = workbook.getWorksheet(1);
      expect(worksheet!.name).toBe('Contacts');
    });

    it('should have column structure that matches ContactSchema fields', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      const worksheet = workbook.getWorksheet(1);
      const columns = worksheet!.columns;
      
      // Verify columns array has correct length (3 columns for ContactSchema)
      expect(columns).toHaveLength(3);
      
      // Verify the worksheet has proper header row structure
      // by reading the actual header values from the first row
      const headerRow = worksheet!.getRow(1);
      const headerValues = (headerRow.values as (string | number)[]).slice(1).map(String);
      
      expect(headerValues).toEqual(['Company Name', 'Person Name', 'Email']);
    });

    it('should have proper header row structure that importer can parse', async () => {
      // Generate template file
      await generateTemplate(TEMPLATE_FILE);
      
      // Read the generated Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(TEMPLATE_FILE);
      
      const worksheet = workbook.getWorksheet(1);
      const headerRow = worksheet!.getRow(1);
      const headers = headerRow.values as (string | number)[];
      
      // Should have 3 headers (plus empty first position in ExcelJS array)
      expect(headers.length).toBeGreaterThanOrEqual(3);
      
      // All headers should be non-empty strings
      const headerStrings = headers.slice(1).filter(Boolean);
      expect(headerStrings.length).toBe(3);
      headerStrings.forEach(header => {
        expect(typeof header).toBe('string');
        expect((header as string).length).toBeGreaterThan(0);
      });
    });
  });
});
