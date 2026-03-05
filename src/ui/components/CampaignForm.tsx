/**
 * CampaignForm
 *
 * Purpose: Campaign setup form with preview/confirmation (template loaded from .env).
 * During running state, campaign progress is shown via the CampaignBanner
 * and events flow to the ActivityFeed — this component only renders
 * the campaign-specific controls.
 */

/** @jsxImportSource react */
import { Box, Text, useApp, useInput } from 'ink';
import type React from 'react';
import { useEffect } from 'react';
import { shutdown } from '../../shutdown.js';
import type { UseCampaignReturn } from '../hooks/useCampaign.js';
import { colors, icons, spacing } from '../theme.js';
import { ErrorText, SuccessText, WarningText } from './common/Text.js';
import { Panel } from './Panel.js';

interface CampaignFormProps {
  /** Callback on campaign completion */
  onCampaignComplete: () => void;
  /** Campaign state and actions passed from parent */
  campaign: UseCampaignReturn;
}

export function CampaignForm({
  onCampaignComplete,
  campaign,
}: CampaignFormProps): React.ReactElement {
  const { exit } = useApp();
  const { status, loadPendingCount, confirmCampaign, reset } = campaign;

  // Load pending count on mount
  useEffect(() => {
    loadPendingCount().catch(() => {
      // Error is non-critical
    });
  }, [loadPendingCount]);

  // Push campaign events to activity feed
  // (We do not manually add 'Verifying...' or 'Sending to...' on every render loop
  // to avoid spamming the ActivityFeed. SES and Verifier domain events will automatically
  // log success/failure/skip in the ActivityFeed).

  // Handle keyboard shortcuts
  useInput((input, key) => {
    // Global quit shortcut
    if (input === 'q' || input === 'Q') {
      shutdown();
      exit();
      setTimeout(() => process.exit(0), 100);
      return;
    }

    if (key.escape && status !== 'running') {
      reset();
    }
    if (status === 'idle' && key.return) {
      campaign.generateCampaignPreview().catch(() => {
        // Error handled by hook
      });
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

function renderMainContent(campaign: UseCampaignReturn): React.ReactElement {
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

function renderRunningState(campaign: UseCampaignReturn): React.ReactElement {
  const { isContinuous, liveProgress } = campaign;

  // During running state, the CampaignBanner handles progress display
  // This area shows campaign metadata and last few log entries
  return (
    <Panel title={`${icons.block} Campaign Running`} borderColor={colors.primary}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor={true}>Sending emails...</Text>
          <Text color={colors.success}>{isContinuous ? '● Continuous' : ''}</Text>
        </Box>
        <Box>
          <Text dimColor={true}>
            Processing contact {liveProgress.currentContact} of {liveProgress.totalContacts}
          </Text>
        </Box>
        <Box>
          <Text dimColor={true}>Progress and activity shown in banner and feed above/below.</Text>
        </Box>
      </Box>
    </Panel>
  );
}

function renderSuccessState(campaign: UseCampaignReturn): React.ReactElement {
  const { result } = campaign;
  if (!result) {
    return <Text>No result</Text>;
  }

  return (
    <Panel title={`${icons.success} Campaign Complete`} borderColor={colors.success}>
      <Box flexDirection="column" gap={spacing.xs}>
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

function renderErrorState(campaign: UseCampaignReturn): React.ReactElement {
  const { error } = campaign;
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

function renderConfirmState(campaign: UseCampaignReturn): React.ReactElement {
  const { pendingCount, isContinuous, preview } = campaign;
  if (!preview) {
    return <Text>No preview</Text>;
  }

  return (
    <Panel title="Campaign Preview" borderColor={colors.warning}>
      <Box flexDirection="column" gap={spacing.xs}>
        <Box>
          <Text>Pending Contacts: </Text>
          <Text bold={true} color={pendingCount > 0 ? colors.success : colors.error}>
            {pendingCount}
          </Text>
        </Box>
        <Box>
          <Text>Continuous Mode: </Text>
          <Text bold={true} color={isContinuous ? colors.success : colors.dim}>
            {isContinuous ? 'YES (Auto polling)' : 'NO (Run once)'}
          </Text>
        </Box>

        <Box marginTop={1} borderStyle="single" padding={1}>
          <Box>
            <Text bold={true}>Subject: {preview.subject}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor={true} wrap="truncate-end">
              {preview.textBody.slice(0, 200)}…
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

function renderInputForm(campaign: UseCampaignReturn): React.ReactElement {
  const { pendingCount, isContinuous, status } = campaign;

  return (
    <Panel title="Send Email Campaign" borderColor={colors.primary}>
      <Box flexDirection="column" gap={spacing.xs}>
        {/* Pending Count */}
        <Box marginTop={1}>
          <Text>Pending Contacts: </Text>
          <Text bold={true} color={pendingCount > 0 ? colors.success : colors.warning}>
            {pendingCount}
          </Text>
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
            <Text color={colors.warning}>Loading preview…</Text>
          </Box>
        )}

        {/* Help text */}
        {status !== 'loading' && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor={true}>Press Enter to generate preview and start campaign</Text>
            <Text dimColor={true}>Press Escape to cancel</Text>
          </Box>
        )}
      </Box>
    </Panel>
  );
}
