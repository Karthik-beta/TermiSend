/**
 * CampaignBanner
 *
 * Purpose: Top-of-screen banner showing campaign state and progress.
 * Shows progress bar + current contact when running,
 * or a muted "idle" state when no campaign is active.
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { colors, formatMsToSeconds, getStatusColor, getStatusIcon, icons } from '../theme.js';
import type { CampaignViewStatus, LiveProgress } from '../types.js';
import { CompactProgressBar } from './common/ProgressBar.js';

interface CampaignBannerProps {
  /** Current campaign view status */
  campaignStatus: CampaignViewStatus;
  /** Live progress data (only used when running) */
  progress: LiveProgress;
}

function getStatusText(status: string, waitTimeRemainingMs?: number, message?: string): string {
  switch (status) {
    case 'verifying':
      return 'Verifying email…';
    case 'waiting':
      if (waitTimeRemainingMs && waitTimeRemainingMs > 0) {
        return `Throttle ${formatMsToSeconds(waitTimeRemainingMs)}`;
      }
      return 'Waiting…';
    case 'sending':
      return 'Sending…';
    case 'completed':
      return 'Sent';
    case 'skipped':
      return message || 'Skipped';
    case 'failed':
      return message || 'Failed';
    default:
      return '';
  }
}

export function CampaignBanner({
  campaignStatus,
  progress,
}: CampaignBannerProps): React.ReactElement {
  const isRunning = campaignStatus === 'running';

  if (!isRunning) {
    // Compact idle banner
    return (
      <Box flexDirection="row" borderStyle="single" borderColor={colors.dim} paddingX={1} gap={2}>
        <Text dimColor={true}>{icons.block} Campaign</Text>
        <Text dimColor={true}>
          {campaignStatus === 'success'
            ? '✓ Completed'
            : campaignStatus === 'error'
              ? '✗ Error'
              : 'Idle'}
        </Text>
      </Box>
    );
  }

  // Running banner with progress
  const progressPercent =
    progress.totalContacts > 0
      ? Math.round((progress.currentContact / progress.totalContacts) * 100)
      : 0;

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor={colors.primary}
      paddingX={1}
      gap={2}
      justifyContent="space-between"
    >
      {/* Left: status label */}
      <Box gap={1}>
        <Text bold={true} color={colors.primary}>
          {icons.block} RUNNING
        </Text>
        <Text dimColor={true}>
          {progress.currentContact}/{progress.totalContacts}
        </Text>
      </Box>

      {/* Center: progress bar */}
      <Box>
        <CompactProgressBar progress={progressPercent} width={20} />
        <Text dimColor={true}> {progressPercent}%</Text>
      </Box>

      {/* Right: current email + status */}
      <Box gap={1}>
        <Text wrap="truncate-end" dimColor={true}>
          {progress.currentEmail || '—'}
        </Text>
        <Box gap={1} flexDirection="row">
          <Text color={getStatusColor(progress.status)}>
            {getStatusIcon(progress.status)}{' '}
            {getStatusText(progress.status, progress.waitTimeRemainingMs, progress.message)}
          </Text>
          {progress.status === 'waiting' &&
            progress.waitTimeRemainingMs !== undefined &&
            progress.totalWaitTimeMs !== undefined &&
            progress.totalWaitTimeMs > 0 && (
              <Box marginX={1}>
                <CompactProgressBar
                  progress={
                    100 -
                    Math.round((progress.waitTimeRemainingMs / progress.totalWaitTimeMs) * 100)
                  }
                  width={10}
                  fillColor={colors.warning}
                />
              </Box>
            )}
        </Box>
      </Box>
    </Box>
  );
}
