/**
 * CampaignForm
 *
 * Purpose: Campaign setup form with template path input and preview/confirmation
 * Props: { onCampaignComplete?: () => void, initialPendingCount?: number }
 * State: Uses useCampaign hook for form state
 * Extension: Add template preview, A/B testing options, or scheduling
 */

/** @jsxImportSource react */
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type React from 'react';
import { useEffect } from 'react';
import { useCampaign } from '../hooks/useCampaign.js';
import { colors, icons, spacing } from '../theme.js';
import { CampaignStatus } from './CampaignStatus.js';
import { ErrorText, SuccessText, WarningText } from './common/Text.js';
import { Panel } from './Panel.js';

interface CampaignFormProps {
  /** Callback when campaign completes */
  onCampaignComplete?: () => void;
}

export function CampaignForm({ onCampaignComplete }: CampaignFormProps): React.ReactElement {
  const {
    status,
    templatePath,
    pendingCount,
    result,
    error,
    preview,
    liveProgress,
    logEntries,
    setTemplatePath,
    loadPendingCount,
    generateCampaignPreview,
    confirmCampaign,
    reset,
  } = useCampaign();

  // Load pending count on mount
  useEffect(() => {
    loadPendingCount().catch(() => {
      // Error is non-critical
    });
  }, [loadPendingCount]);

  // Handle keyboard shortcuts
  useInput((input, key) => {
    if (key.escape && status !== 'running') {
      reset();
    }
    if (status === 'confirm') {
      if (input === 'y' || input === 'Y') {
        confirmCampaign(true).catch(() => {
          // Error handled by hook
        });
      }
      if (input === 'n' || input === 'N') {
        confirmCampaign(false).catch(() => {
          // Error handled by hook
        });
      }
    }
  });

  // Notify parent on successful completion
  useEffect(() => {
    if (status === 'success' && onCampaignComplete) {
      onCampaignComplete();
    }
  }, [status, onCampaignComplete]);

  // Render running state with progress
  if (status === 'running') {
    return (
      <Box flexDirection="column" gap={1}>
        <CampaignStatus progress={liveProgress} isRunning={true} />
        <Panel title="📋 Campaign Log" borderColor={colors.gray}>
          {logEntries.slice(-5).map((entry, index) => (
            <Box key={`log-${index}`}>
              <Text>
                {entry.email} - {entry.status}
              </Text>
            </Box>
          ))}
        </Panel>
      </Box>
    );
  }

  // Render success state
  if (status === 'success' && result) {
    return (
      <Panel title={`${icons.success} Campaign Complete`} borderColor={colors.success}>
        <Box flexDirection="column" gap={spacing.xs}>
          <Box>
            <Text>Total Contacts: </Text>
            <Text bold={true}>{result.totalContacts}</Text>
          </Box>
          <Box>
            <Text>Emails Sent: </Text>
            <SuccessText>{result.sentCount}</SuccessText>
          </Box>
          <Box>
            <Text>Skipped (Invalid): </Text>
            <WarningText>{result.skippedCount}</WarningText>
          </Box>
          <Box>
            <Text>Failed: </Text>
            <Text color={result.failedCount > 0 ? colors.error : colors.success}>
              {result.failedCount}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor={true}>Press Escape to go back</Text>
          </Box>
        </Box>
      </Panel>
    );
  }

  // Render error state
  if (status === 'error') {
    return (
      <Panel title={`${icons.error} Campaign Failed`} borderColor={colors.error}>
        <Box flexDirection="column" gap={spacing.xs}>
          <ErrorText>{error}</ErrorText>
          <Box marginTop={1}>
            <Text dimColor={true}>Press Escape to go back</Text>
          </Box>
        </Box>
      </Panel>
    );
  }

  // Render confirmation state
  if (status === 'confirm' && preview) {
    return (
      <Panel title="📤 Campaign Preview" borderColor={colors.warning}>
        <Box flexDirection="column" gap={spacing.xs}>
          <Box>
            <Text>Pending Contacts: </Text>
            <Text bold={true} color={pendingCount > 0 ? colors.success : colors.error}>
              {pendingCount}
            </Text>
          </Box>
          <Box>
            <Text>Template: </Text>
            <Text dimColor={true}>{templatePath}</Text>
          </Box>

          <Box marginTop={1} borderStyle="single" padding={1}>
            <Box>
              <Text bold={true}>Subject: {preview.subject}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor={true} wrap="truncate-end">
                {preview.textBody.slice(0, 200)}...
              </Text>
            </Box>
          </Box>

          <Box marginTop={2}>
            <Text bold={true} color={colors.warning}>
              Start campaign? (y/n)
            </Text>
          </Box>
        </Box>
      </Panel>
    );
  }

  // Render input form
  return (
    <Panel title="📤 Send Email Campaign" borderColor={colors.primary}>
      <Box flexDirection="column" gap={spacing.xs}>
        {/* Pending Count */}
        <Box>
          <Text>Pending Contacts: </Text>
          <Text bold={true} color={pendingCount > 0 ? colors.success : colors.warning}>
            {pendingCount}
          </Text>
        </Box>

        {/* Template Path Input */}
        <Box marginTop={1}>
          <Text>Template Path: </Text>
          <TextInput
            value={templatePath}
            onChange={setTemplatePath}
            onSubmit={() => {
              generateCampaignPreview().catch(() => {
                // Error handled by hook
              });
            }}
            placeholder="./template.md"
          />
        </Box>

        {/* Loading indicator */}
        {status === 'loading' && (
          <Box marginTop={1}>
            <Text color={colors.warning}>Loading preview...</Text>
          </Box>
        )}

        {/* Help text */}
        {status !== 'loading' && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor={true}>Enter the path to your markdown template and press Enter</Text>
            <Text dimColor={true}>Press Escape to cancel</Text>
          </Box>
        )}
      </Box>
    </Panel>
  );
}
