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
}

export function LogOutput({
  entries,
  maxEntries = 15,
  title = '📋 Activity Log',
}: LogOutputProps): React.ReactElement {
  const recentEntries = entries.slice(-maxEntries);

  return (
    <Panel title={title} borderColor={colors.gray} height={maxEntries + 3}>
      {recentEntries.length > 0 ? (
        <Box flexDirection="column">
          {recentEntries.map((entry, index) => (
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
