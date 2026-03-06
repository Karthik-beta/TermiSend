/**
 * Menu
 *
 * Purpose: Navigation menu for switching between dashboard views
 * Props: { onSelect: (item: MenuItem) => void, activeItem?: string }
 * State: None - Uses SelectInput for selection state
 * Extension: Add nested menus, icons, or disabled states for items
 */

import { Box, Text } from 'ink';
/** @jsxImportSource react */
import SelectInput from 'ink-select-input';
import type React from 'react';
import { colors, icons } from '../theme.js';
import type { MenuItem } from '../types.js';

interface MenuProps {
  /** Callback when menu item is selected */
  onSelect: (item: MenuItem) => void;
}

const menuItems: MenuItem[] = [
  { label: `${icons.import} Import Contacts`, value: 'import', shortcut: 'I' },
  { label: `${icons.campaign} Send Campaign`, value: 'campaign', shortcut: 'C' },
  { label: `${icons.analytics} View Analytics`, value: 'analytics', shortcut: 'A' },
  { label: `${icons.quit} Quit`, value: 'quit', shortcut: 'Q' },
];

export function Menu({ onSelect }: MenuProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold={true} color={colors.primary}>
          ☰ Menu
        </Text>
      </Box>

      <SelectInput
        items={menuItems}
        onSelect={onSelect}
        itemComponent={({ label, isSelected }) => (
          <Text color={isSelected ? colors.primary : colors.white}>
            {isSelected ? '> ' : '  '}
            {label}
          </Text>
        )}
      />

      {/* Keyboard hints */}
      <Box marginTop={2} flexDirection="column">
        <Text dimColor={true}>Navigation:</Text>
        <Text dimColor={true}> ↑/↓ - Move selection</Text>
        <Text dimColor={true}> Enter - Select item</Text>
      </Box>
    </Box>
  );
}

export { menuItems };
