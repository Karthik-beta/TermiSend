/**
 * ProgressBar
 *
 * Purpose: Visual progress indicator with percentage display
 * Props: { progress: number (0-100), width?: number, showPercentage?: boolean }
 * State: None - Presentational component
 * Extension: Add animated transitions, color gradients, or segmented display
 */

/** @jsxImportSource react */
import type React from 'react';
import { colors, layout } from '../../theme.js';
import { Box } from './Box.js';
import { Text } from './Text.js';

interface ProgressBarProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Width of the progress bar in characters */
  width?: number;
  /** Whether to show percentage text */
  showPercentage?: boolean;
  /** Color for filled portion */
  fillColor?: string;
  /** Color for empty portion */
  emptyColor?: string;
  /** Label to display above progress bar */
  label?: string;
}

export function ProgressBar({
  progress,
  width = layout.progressBarWidth,
  showPercentage = true,
  fillColor = colors.success,
  emptyColor = colors.gray,
  label,
}: ProgressBarProps): React.ReactElement {
  // Clamp progress between 0 and 100
  const clampedProgress = Math.max(0, Math.min(100, progress));

  // Calculate filled and empty portions
  const filledBars = Math.round((clampedProgress / 100) * width);
  const emptyBars = width - filledBars;

  return (
    <Box flexDirection="column" gap={1}>
      {label && <Text dimColor={true}>{label}</Text>}
      <Box flexDirection="row">
        <Text color={fillColor}>{'█'.repeat(filledBars)}</Text>
        <Text color={emptyColor}>{'░'.repeat(emptyBars)}</Text>
        {showPercentage && <Text dimColor={true}> {clampedProgress}%</Text>}
      </Box>
    </Box>
  );
}

/**
 * Compact progress bar for tight spaces
 */
export function CompactProgressBar({
  progress,
  width = 20,
  fillColor = colors.success,
}: Omit<ProgressBarProps, 'showPercentage' | 'label'>): React.ReactElement {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const filledBars = Math.round((clampedProgress / 100) * width);
  const emptyBars = width - filledBars;

  return (
    <Box flexDirection="row">
      <Text color={fillColor}>{'█'.repeat(filledBars)}</Text>
      <Text color={colors.gray}>{'░'.repeat(emptyBars)}</Text>
    </Box>
  );
}
