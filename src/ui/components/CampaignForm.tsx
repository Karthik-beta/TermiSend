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
  const campaign = useCampaign();
  const { status, loadPendingCount, confirmCampaign, reset } = campaign;

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

  return renderMainContent(campaign);
}

function renderMainContent(campaign: ReturnType<typeof useCampaign>): React.ReactElement {
  const { status } = campaign;

  switch (status) {
    case 'running':
      return renderRunningState(campaign);
    case 'success':
      return renderSuccessState(campaign);
    case 'error':
      return renderErrorState(campaign);
    case 'confirm':
      return renderConfirmState(campaign);
    default:
      return renderInputForm(campaign);
  }
}

function renderRunningState(campaign: ReturnType<typeof useCampaign>): React.ReactElement {
  const { campaignId, isContinuous, liveProgress, logEntries } = campaign;
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor={true}>Campaign: {campaignId.slice(0, 8)}...</Text>
        <Text color={colors.success}>{isContinuous ? '● Continuous Mode' : ''}</Text>
      </Box>
      <CampaignStatus progress={liveProgress} isRunning={true} />
      <Panel title="📋 Campaign Log" borderColor={colors.gray}>
        {logEntries.slice(-5).map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Acceptable for static log display
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

function renderSuccessState(campaign: ReturnType<typeof useCampaign>): React.ReactElement {
  const { campaignId, result } = campaign;
  if (!result) {
    return <Text>No result</Text>;
  }

  return (
    <Panel title={`${icons.success} Campaign Complete`} borderColor={colors.success}>
      <Box flexDirection="column" gap={spacing.xs}>
        <Box>
          <Text dimColor={true}>Campaign ID: {campaignId}</Text>
        </Box>
        <Box marginTop={1}>
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

function renderErrorState(campaign: ReturnType<typeof useCampaign>): React.ReactElement {
  const { campaignId, error } = campaign;
  return (
    <Panel title={`${icons.error} Campaign Failed`} borderColor={colors.error}>
      <Box flexDirection="column" gap={spacing.xs}>
        <Box>
          <Text dimColor={true}>Campaign ID: {campaignId}</Text>
        </Box>
        <ErrorText>{error}</ErrorText>
        <Box marginTop={1}>
          <Text dimColor={true}>Press Escape to go back</Text>
        </Box>
      </Box>
    </Panel>
  );
}

function renderConfirmState(campaign: ReturnType<typeof useCampaign>): React.ReactElement {
  const { campaignId, pendingCount, isContinuous, templatePath, preview } = campaign;
  if (!preview) {
    return <Text>No preview</Text>;
  }

  return (
    <Panel title="📤 Campaign Preview" borderColor={colors.warning}>
      <Box flexDirection="column" gap={spacing.xs}>
        <Box>
          <Text>Campaign ID: </Text>
          <Text bold={true} color={colors.primary}>
            {campaignId.slice(0, 8)}...
          </Text>
        </Box>
        <Box>
          <Text>Pending Contacts: </Text>
          <Text bold={true} color={pendingCount > 0 ? colors.success : colors.error}>
            {pendingCount}
          </Text>
        </Box>
        <Box>
          <Text>Continuous Mode: </Text>
          <Text bold={true} color={isContinuous ? colors.success : colors.gray}>
            {isContinuous ? 'YES (Automatic polling enabled)' : 'NO (Run once)'}
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

function renderInputForm(campaign: ReturnType<typeof useCampaign>): React.ReactElement {
  const {
    campaignId,
    pendingCount,
    templatePath,
    setTemplatePath,
    generateCampaignPreview,
    isContinuous,
    status,
  } = campaign;

  return (
    <Panel title="📤 Send Email Campaign" borderColor={colors.primary}>
      <Box flexDirection="column" gap={spacing.xs}>
        {/* Campaign Info */}
        <Box>
          <Text dimColor={true}>New Campaign ID: {campaignId.slice(0, 8)}...</Text>
        </Box>

        {/* Pending Count */}
        <Box marginTop={1}>
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

        {/* Continuous mode hint */}
        <Box marginTop={1}>
          <Text dimColor={true}>
            Continuous mode is {isContinuous ? 'ENABLED' : 'DISABLED'}.
            {isContinuous ? ' New leads will be picked up automatically.' : ''}
          </Text>
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
