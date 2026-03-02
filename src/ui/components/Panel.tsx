/**
 * Panel
 *
 * Purpose: Reusable bordered container with optional title for dashboard sections
 * Props: { title?: string, children: ReactNode, borderColor?: string, flex?: number }
 * State: None - Presentational container component
 * Extension: Add collapsible sections, scrollable content, or custom header actions
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { borders, colors, spacing } from '../theme.js';

interface PanelProps {
  /** Panel title displayed in header */
  title?: string;
  /** Panel content */
  children: React.ReactNode;
  /** Border color */
  borderColor?: string;
  /** Flex grow value */
  flexGrow?: number;
  /** Flex shrink value */
  flexShrink?: number;
  /** Width of the panel */
  width?: number | string;
  /** Height of the panel */
  height?: number | string;
  /** Minimum height */
  minHeight?: number;
  /** Padding inside panel */
  padding?: number;
  /** Flex direction for content */
  flexDirection?: 'row' | 'column';
  /** Whether to show border */
  border?: boolean;
  /** Title color */
  titleColor?: string;
}

export function Panel({
  title,
  children,
  borderColor = colors.primary,
  flexGrow,
  flexShrink,
  width,
  height,
  minHeight,
  padding = spacing.xs,
  flexDirection = 'column',
  border = true,
  titleColor = colors.primaryBright,
}: PanelProps): React.ReactElement {
  return (
    <Box
      flexDirection={flexDirection}
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      width={width}
      height={height}
      minHeight={minHeight}
      padding={padding}
      borderStyle={border ? borders.single : borders.none}
      borderColor={borderColor}
    >
      {title && (
        <Box marginBottom={spacing.xs}>
          <Text bold={true} color={titleColor}>
            {title}
          </Text>
        </Box>
      )}
      {children}
    </Box>
  );
}

/**
 * Compact panel without padding for dense layouts
 */
export function CompactPanel({
  title,
  children,
  borderColor = colors.gray,
  flexGrow,
  width,
  height,
}: Omit<PanelProps, 'padding'>): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={flexGrow}
      width={width}
      height={height}
      borderStyle={borders.single}
      borderColor={borderColor}
    >
      {title && (
        <Box paddingX={1} paddingY={0} borderStyle={borders.single} borderBottom={true}>
          <Text bold={true} dimColor={true}>
            {title}
          </Text>
        </Box>
      )}
      <Box padding={spacing.xs} flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
