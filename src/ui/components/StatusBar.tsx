/**
 * StatusBar
 *
 * Purpose: Bottom status bar showing keyboard shortcuts and current status
 * Props: { currentView: DashboardView, statusMessage?: string }
 * State: None - Presentational component
 * Extension: Add dynamic shortcuts based on context, notification area
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { colors } from '../theme.js';
import type { DashboardView } from '../types.js';

interface StatusBarProps {
  /** Current active view */
  currentView: DashboardView;
  /** Optional status message to display */
  statusMessage?: string;
}

export function StatusBar({
  currentView,
  statusMessage = 'Ready',
}: StatusBarProps): React.ReactElement {
  const getShortcuts = (view: DashboardView): string[] => {
    switch (view) {
      case 'MENU':
        return ['↑↓ Navigate', 'Enter Select', 'Q Quit'];
      case 'IMPORT':
        return ['Enter Import', 'T Template', 'Esc Back'];
      case 'CAMPAIGN':
        return ['Enter Preview', 'Y Confirm', 'N Cancel', 'Esc Back'];
      case 'RESULTS':
        return ['Esc Back', 'R Refresh'];
      default:
        return ['Esc Back'];
    }
  };

  const shortcuts = getShortcuts(currentView);

  return (
    <Box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderTop={true}
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      borderColor={colors.gray}
      paddingX={1}
    >
      {/* Keyboard Shortcuts */}
      <Box gap={2}>
        {shortcuts.map((shortcut, index) => (
          <Text key={`shortcut-${index}`} dimColor={true}>
            {shortcut}
          </Text>
        ))}
      </Box>

      {/* Status Message */}
      <Box>
        <Text dimColor={true}>{statusMessage}</Text>
      </Box>
    </Box>
  );
}
