/**
 * ActivityFeed
 *
 * Purpose: Scrolling live event log showing recent system activity.
 * Displays source tag, timestamp, and message for each event.
 * Keeps the most recent entries visible.
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { colors, getSourceColor, icons, layout } from '../theme.js';
import type { ActivityEvent } from '../types.js';

interface ActivityFeedProps {
  /** Activity events to display */
  events: ActivityEvent[];
  /** Maximum visible entries */
  maxVisible?: number;
  /** Fixed height for the feed panel */
  height?: number;
}

/**
 * Format timestamp as relative seconds/minutes ago
 */
function formatTimeAgo(timestamp: Date): string {
  const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
  if (seconds < 5) {
    return 'now';
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  if (mins < 60) {
    return `${mins}m`;
  }
  return `${Math.floor(mins / 60)}h`;
}

/**
 * Get status indicator character
 */
function getStatusIndicator(status: ActivityEvent['status']): { char: string; color: string } {
  switch (status) {
    case 'success':
      return { char: icons.success, color: colors.success };
    case 'error':
      return { char: icons.error, color: colors.error };
    case 'warning':
      return { char: icons.warning, color: colors.warning };
    default:
      return { char: icons.bullet, color: colors.dim };
  }
}

export function ActivityFeed({
  events,
  maxVisible = layout.visibleFeedEntries,
  height,
}: ActivityFeedProps): React.ReactElement {
  const visibleEvents = events.slice(-maxVisible);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={colors.dim}
      height={height}
      overflow="hidden"
    >
      {/* Header */}
      <Box paddingX={1}>
        <Text bold={true} color={colors.primary}>
          {icons.block} Activity
        </Text>
      </Box>

      {/* Event List */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {visibleEvents.length > 0 ? (
          visibleEvents.map((event) => {
            const indicator = getStatusIndicator(event.status);
            return (
              <Box key={event.id} flexDirection="row" gap={1}>
                {/* Status dot */}
                <Text color={indicator.color}>{indicator.char}</Text>

                {/* Timestamp */}
                <Text dimColor={true}>{formatTimeAgo(event.timestamp).padStart(4)}</Text>

                {/* Source tag */}
                <Text color={getSourceColor(event.source)} bold={true}>
                  [{event.source.toUpperCase()}]
                </Text>

                {/* Message */}
                <Text wrap="truncate-end">{event.message}</Text>
              </Box>
            );
          })
        ) : (
          <Box>
            <Text dimColor={true}>Waiting for activity…</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
