/**
 * ImportForm
 *
 * Purpose: Excel import form with file path input and template download
 * Props: { onImportComplete?: () => void }
 * State: Uses useImport hook for form state
 * Extension: Add drag-and-drop, file browser, or import preview
 */

/** @jsxImportSource react */
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type React from 'react';
import { useEffect } from 'react';
import { shutdown } from '../../shutdown.js';
import { useImport } from '../hooks/useImport.js';
import { colors, icons, spacing } from '../theme.js';
import { ErrorText, SuccessText, WarningText } from './common/Text.js';
import { Panel } from './Panel.js';

interface ImportFormProps {
  /** Callback when import completes successfully */
  onImportComplete?: () => void;
}

export function ImportForm({ onImportComplete }: ImportFormProps): React.ReactElement {
  const { exit } = useApp();
  const {
    importStatus,
    importResult,
    importError,
    filePath,
    templateStatus,
    templateFilePath,
    templateError,
    setFilePath,
    executeImport,
    downloadTemplate,
    reset,
  } = useImport();

  // Handle keyboard shortcuts
  useInput((input, key) => {
    // Global quit shortcut - always available
    if (input === 'q' || input === 'Q') {
      shutdown(); // Signal campaign to stop first
      exit(); // Signal Ink to unmount
      // Force process exit after brief delay to ensure cleanup
      setTimeout(() => process.exit(0), 100);
      return;
    }

    if (key.escape && importStatus !== 'loading') {
      reset();
    }
    // Template download on 'T' key when not typing
    if (
      (input === 't' || input === 'T') &&
      !filePath &&
      importStatus !== 'loading' &&
      templateStatus === 'idle'
    ) {
      downloadTemplate().catch(() => {
        // Error handled by hook
      });
    }
  });

  // Notify parent on successful import
  useEffect(() => {
    if (importStatus === 'success' && onImportComplete) {
      onImportComplete();
    }
  }, [importStatus, onImportComplete]);

  // Render success state
  if (importStatus === 'success' && importResult) {
    return (
      <Panel title={`${icons.success} Import Complete`} borderColor={colors.success}>
        <Box flexDirection="column" gap={spacing.xs}>
          <Box>
            <Text>Total Rows: </Text>
            <Text bold={true}>{importResult.totalRows}</Text>
          </Box>
          <Box>
            <Text>Successfully Imported: </Text>
            <SuccessText>{importResult.successCount}</SuccessText>
          </Box>
          <Box>
            <Text>Inserted: </Text>
            <Text color={colors.success}>{importResult.insertedCount}</Text>
          </Box>
          <Box>
            <Text>Skipped (duplicates): </Text>
            <WarningText>{importResult.skippedCount}</WarningText>
          </Box>
          <Box>
            <Text>Failed: </Text>
            <Text color={importResult.failedCount > 0 ? colors.error : colors.success}>
              {importResult.failedCount}
            </Text>
          </Box>

          {/* Error details */}
          {importResult.errors.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <WarningText>Errors:</WarningText>
              {importResult.errors.slice(0, 5).map((err) => (
                <Box key={`error-${err.row}`}>
                  <Text dimColor={true}>
                    Row {err.row}: {err.error}
                  </Text>
                </Box>
              ))}
              {importResult.errors.length > 5 && (
                <Text dimColor={true}>...and {importResult.errors.length - 5} more</Text>
              )}
            </Box>
          )}
        </Box>
      </Panel>
    );
  }

  // Render error state
  if (importStatus === 'error') {
    return (
      <Panel title={`${icons.error} Import Failed`} borderColor={colors.error}>
        <Box flexDirection="column" gap={spacing.xs}>
          <ErrorText>{importError}</ErrorText>
          <Box marginTop={1}>
            <Text dimColor={true}>Press Escape to go back</Text>
          </Box>
        </Box>
      </Panel>
    );
  }

  // Render input form
  return (
    <Panel title="📥 Import Excel Contacts" borderColor={colors.primary}>
      <Box flexDirection="column" gap={spacing.xs}>
        {/* File Path Input */}
        <Box>
          <Text>Excel File Path: </Text>
          <TextInput
            value={filePath}
            onChange={setFilePath}
            onSubmit={() => {
              executeImport().catch(() => {
                // Error handled by hook
              });
            }}
            placeholder="./contacts.xlsx"
          />
        </Box>

        {/* Loading indicator */}
        {importStatus === 'loading' && (
          <Box marginTop={1}>
            <Text color={colors.warning}>Importing contacts...</Text>
          </Box>
        )}

        {/* Help text */}
        {importStatus !== 'loading' && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor={true}>Enter the path to your Excel file and press Enter</Text>
            <Text dimColor={true}>Press Escape to cancel</Text>
          </Box>
        )}

        {/* Template section */}
        <Box marginTop={2} borderStyle="round" borderColor={colors.secondary} padding={1}>
          <Box marginBottom={1}>
            <Text bold={true} color={colors.secondary}>
              Template Options
            </Text>
          </Box>

          <Box>
            <Text>Press </Text>
            <Text bold={true} color={colors.warning}>
              T
            </Text>
            <Text> to download template</Text>
          </Box>

          {templateStatus === 'downloading' && (
            <Box marginTop={1}>
              <Text color={colors.warning}>Generating template...</Text>
            </Box>
          )}

          {templateStatus === 'success' && templateFilePath && (
            <Box marginTop={1}>
              <SuccessText>✓ Template saved to: {templateFilePath}</SuccessText>
            </Box>
          )}

          {templateStatus === 'error' && templateError && (
            <Box marginTop={1}>
              <ErrorText>✗ Template error: {templateError}</ErrorText>
            </Box>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
