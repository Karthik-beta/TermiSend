/**
 * Excel Template Generator Module
 * Dynamically generates Excel templates based on the importer's schema
 */

import { existsSync } from 'node:fs';
import ExcelJs from 'exceljs';
import { ContactSchema, REQUIRED_COLUMNS } from './importer.js';
import { validateImportPath } from './path-validator.js';

/**
 * Re-export REQUIRED_COLUMNS for convenience
 */
export function getTemplateHeaders(): readonly string[] {
  return REQUIRED_COLUMNS;
}

/**
 * Example data that passes ContactSchema validation
 */
const EXAMPLE_DATA = {
  companyName: 'Example Corp',
  personName: 'John Doe',
  email: 'john@example.com',
};

/**
 * Generate an Excel template file with proper headers and example data
 * @param outputPath - Path where the template file will be saved
 */
export async function generateTemplate(outputPath: string): Promise<void> {
  // Validate the path for security (prevent path traversal attacks)
  const pathValidation = validateImportPath(outputPath);
  if (!pathValidation.valid) {
    throw new Error(`Invalid file path: ${pathValidation.error}`);
  }

  // Use the sanitized path
  const sanitizedPath = pathValidation.sanitizedPath;

  // Check if file already exists to prevent overwriting
  if (existsSync(sanitizedPath)) {
    throw new Error(
      `File already exists: ${sanitizedPath}. Use a different path or delete the existing file.`
    );
  }

  // Validate example data passes schema
  const validation = ContactSchema.safeParse(EXAMPLE_DATA);
  if (!validation.success) {
    throw new Error(
      `Example data validation failed: ${validation.error.issues.map((e) => e.message).join(', ')}`
    );
  }

  // Create a new workbook
  const workbook = new ExcelJs.Workbook();
  workbook.creator = 'TermiSend';
  workbook.created = new Date();

  // Add a worksheet named "Contacts"
  const worksheet = workbook.addWorksheet('Contacts');

  // Define column widths for better readability
  worksheet.columns = [
    { header: REQUIRED_COLUMNS[0], key: 'companyName', width: 25 }, // Company Name
    { header: REQUIRED_COLUMNS[1], key: 'personName', width: 20 }, // Person Name
    { header: REQUIRED_COLUMNS[2], key: 'email', width: 30 }, // Email
  ];

  // Add header row with styling
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };
  headerRow.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };

  // Add example row with valid data
  const exampleRow = worksheet.addRow({
    companyName: EXAMPLE_DATA.companyName,
    personName: EXAMPLE_DATA.personName,
    email: EXAMPLE_DATA.email,
  });

  // Style example row
  exampleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF5F5F5' },
  };

  // Freeze the header row so it stays visible when scrolling
  worksheet.views = [
    {
      state: 'frozen',
      ySplit: 1,
    },
  ];

  // Write the workbook to file
  await workbook.xlsx.writeFile(sanitizedPath);
}
