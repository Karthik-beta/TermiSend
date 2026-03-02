/**
 * CampaignStatus
 *
 * Purpose: Displays campaign progress with progress bar and current status
 * Props: { progress: LiveProgress, isRunning: boolean }
 * State: None - Presentational component
 * Extension: Add ETA estimation, throughput metrics, or pause/resume controls
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { colors, formatMsToSeconds, getStatusColor, getStatusIcon } from '../theme.js';
import type { LiveProgress } from '../types.js';
import { ProgressBar } from './common/ProgressBar.js';
import { Panel } from './Panel.js';

interface CampaignStatusProps {
  /** Current campaign progress */
  progress: LiveProgress;
  /** Whether campaign is currently running */
  isRunning: boolean;
}

export function CampaignStatus({ progress, isRunning }: CampaignStatusProps): React.ReactElement {
  const progressPercent =
    progress.totalContacts > 0
      ? Math.round((progress.currentContact / progress.totalContacts) * 100)
      : 0;

  const getStatusText = (status: string, waitTimeRemainingMs?: number): string => {
    switch (status) {
      case 'verifying':
        return 'Verifying email...';
      case 'waiting':
        if (waitTimeRemainingMs && waitTimeRemainingMs > 0) {
          return `Waiting ${formatMsToSeconds(waitTimeRemainingMs)} before next send...`;
        }
        return 'Waiting before next send...';
      case 'sending':
        return 'Sending email...';
      case 'completed':
        return 'Completed';
      case 'skipped':
        return progress.message || 'Skipped';
      case 'failed':
        return progress.message || 'Failed';
      default:
        return '';
    }
  };

  if (!isRunning) {
    return (
      <Panel title="📤 Campaign" borderColor={colors.warning}>
        <Text dimColor={true}>No campaign running</Text>
      </Panel>
    );
  }

  return (
    <Panel title="📤 Campaign Progress" borderColor={colors.warning}>
      <Box flexDirection="column" gap={1}>
        {/* Progress Bar */}
        <ProgressBar
          progress={progressPercent}
          label={`Contact ${progress.currentContact} of ${progress.totalContacts}`}
        />

        {/* Current Email */}
        <Box flexDirection="column">
          <Text dimColor={true}>Current:</Text>
          <Text wrap="truncate-end">{progress.currentEmail || '-'}</Text>
        </Box>

        {/* Status */}
        <Box>
          <Text color={getStatusColor(progress.status)}>
            {getStatusIcon(progress.status)}{' '}
            {getStatusText(progress.status, progress.waitTimeRemainingMs)}
          </Text>
        </Box>
      </Box>
    </Panel>
  );
}
