/**
 * LogOutput
 *
 * Purpose: Activity feed showing recent operations and campaign activity
 * Props: { entries: LogEntry[], maxEntries?: number }
 * State: None - Presentational component
 * Extension: Add filtering by status, timestamps, or export functionality
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { colors, getStatusColor, getStatusIcon } from '../theme.js';
import type { LogEntry } from '../types.js';
import { Panel } from './Panel.js';

interface LogOutputProps {
  /** Log entries to display */
  entries: LogEntry[];
  /** Maximum number of entries to show */
  maxEntries?: number;
  /** Panel title */
  title?: string;
  /** Maximum height for the log output */
  maxHeight?: number;
}

export function LogOutput({
  entries,
  maxEntries = 6,
  title = '📋 Activity Log',
  maxHeight,
}: LogOutputProps): React.ReactElement {
  const recentEntries = entries.slice(-maxEntries);

  return (
    <Panel title={title} borderColor={colors.gray} height={maxHeight} flexGrow={1} flexShrink={0}>
      {recentEntries.length > 0 ? (
        <Box flexDirection="column">
          {recentEntries.map((entry, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Acceptable for static log display
            <Box key={`log-${index}`} flexDirection="row" gap={1}>
              <Text color={getStatusColor(entry.status)}>{getStatusIcon(entry.status)}</Text>
              <Text dimColor={true} wrap="truncate-end">
                {entry.email}
              </Text>
              {entry.message && (
                <Text color={getStatusColor(entry.status)} wrap="truncate-end">
                  {entry.message}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      ) : (
        <Box>
          <Text dimColor={true}>No activity yet...</Text>
        </Box>
      )}
    </Panel>
  );
}
