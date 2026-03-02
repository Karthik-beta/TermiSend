/**
 * useImport Hook
 *
 * Purpose: Manages Excel import operations and template generation state
 * Props: None - Self-contained hook
 * State: importState, templateState, filePath
 * Extension: Add import history, batch imports, or validation preview
 */

import { useCallback, useState } from 'react';
import { importExcelFile } from '../../importer.js';
import { generateTemplate } from '../../template-generator.js';
import type { ImportResult } from '../../types.js';
import type { ImportStatus, TemplateStatus } from '../types.js';

/**
 * Import operation actions
 */
interface ImportActions {
  /** Set the file path for import */
  setFilePath: (path: string) => void;
  /** Execute the import operation */
  executeImport: () => Promise<void>;
  /** Download the Excel template */
  downloadTemplate: () => Promise<void>;
  /** Reset import state to idle */
  reset: () => void;
  /** Clear any errors */
  clearErrors: () => void;
}

/**
 * Combined import hook return type
 */
interface UseImportReturn extends ImportActions {
  // Import state
  importStatus: ImportStatus;
  importResult: ImportResult | null;
  importError: string | null;
  filePath: string;
  // Template state
  templateStatus: TemplateStatus;
  templateFilePath: string | null;
  templateError: string | null;
}

/**
 * Hook for managing import operations
 * @returns Import state and actions
 */
export function useImport(): UseImportReturn {
  // Import state
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [filePath, setFilePathState] = useState<string>('');

  // Template state
  const [templateStatus, setTemplateStatus] = useState<TemplateStatus>('idle');
  const [templateFilePath, setTemplateFilePath] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const setFilePath = useCallback((path: string) => {
    setFilePathState(path);
  }, []);

  const executeImport = useCallback(async () => {
    if (!filePath.trim()) {
      setImportError('Please enter a file path');
      setImportStatus('error');
      return;
    }

    setImportStatus('loading');
    setImportError(null);
    setImportResult(null);

    try {
      const result = await importExcelFile(filePath.trim());
      setImportResult(result);
      setImportStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setImportError(errorMessage);
      setImportStatus('error');
    }
  }, [filePath]);

  const downloadTemplate = useCallback(async () => {
    setTemplateStatus('downloading');
    setTemplateError(null);
    setTemplateFilePath(null);

    try {
      const outputPath = './contacts-template.xlsx';
      await generateTemplate(outputPath);
      setTemplateFilePath(outputPath);
      setTemplateStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setTemplateError(errorMessage);
      setTemplateStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    setImportStatus('idle');
    setImportResult(null);
    setImportError(null);
    setFilePathState('');
    setTemplateStatus('idle');
    setTemplateFilePath(null);
    setTemplateError(null);
  }, []);

  const clearErrors = useCallback(() => {
    setImportError(null);
    setTemplateError(null);
  }, []);

  return {
    // Import state
    importStatus,
    importResult,
    importError,
    filePath,

    // Template state
    templateStatus,
    templateFilePath,
    templateError,

    // Actions
    setFilePath,
    executeImport,
    downloadTemplate,
    reset,
    clearErrors,
  };
}
