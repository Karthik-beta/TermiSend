/**
 * StatusBar
 *
 * Purpose: Bottom status bar showing keyboard shortcuts and current status.
 * Streamlined to match the new industrial theme.
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { isDevelopment } from '../../utils/security.js';
import { colors, icons } from '../theme.js';
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
        return ['↑↓ Navigate', 'Enter Select', 'U Unsubscribe', 'Q Quit'];
      case 'IMPORT':
        return ['Enter Import', 'T Template', 'Esc Back', 'Q Quit'];
      case 'CAMPAIGN':
        return ['Enter Preview', 'Y Confirm', 'N Cancel', 'Esc Back', 'Q Quit'];
      case 'UNSUBSCRIBE':
        return ['Enter Save', 'Esc Clear/Back', 'Q Quit'];
      case 'RESULTS':
        return ['Esc Back', 'R Refresh', 'Q Quit'];
      default:
        return ['Esc Back', 'Q Quit'];
    }
  };

  const shortcuts = getShortcuts(currentView);

  return (
    <Box height={1} flexDirection="row" justifyContent="space-between" paddingX={1}>
      {/* Keyboard Shortcuts */}
      <Box gap={1}>
        {shortcuts.map((shortcut, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Acceptable for static shortcut list
          <Text key={`shortcut-${index}`} dimColor={true}>
            {shortcut}
          </Text>
        ))}
      </Box>

      {/* Status + Dev indicator */}
      <Box gap={1}>
        <Text dimColor={true}>{statusMessage}</Text>
        {isDevelopment() && (
          <Text dimColor={true} color={colors.warning}>
            {icons.separator} DEV
          </Text>
        )}
      </Box>
    </Box>
  );
}
