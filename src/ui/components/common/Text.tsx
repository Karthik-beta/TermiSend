/**
 * Text
 *
 * Purpose: Styled text wrapper with consistent typography and color options
 * Props: Inherits all Ink Text props plus theme-aware defaults
 * State: None - Presentational component
 * Extension: Add text variants (heading, body, caption), text truncation, or color themes
 */

/** @jsxImportSource react */
import { Text as InkText } from 'ink';
import type React from 'react';
import { colors } from '../../theme.js';

interface TextProps {
  children: React.ReactNode;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  dimColor?: boolean;
  wrap?:
    | 'wrap'
    | 'end'
    | 'middle'
    | 'truncate'
    | 'truncate-start'
    | 'truncate-middle'
    | 'truncate-end';
  inverse?: boolean;
}

export function Text({
  children,
  color = colors.white,
  backgroundColor,
  bold = false,
  italic = false,
  underline = false,
  strikethrough = false,
  dimColor = false,
  wrap,
  inverse = false,
}: TextProps): React.ReactElement {
  return (
    <InkText
      color={color}
      backgroundColor={backgroundColor}
      bold={bold}
      italic={italic}
      underline={underline}
      strikethrough={strikethrough}
      dimColor={dimColor}
      wrap={wrap}
      inverse={inverse}
    >
      {children}
    </InkText>
  );
}

/**
 * Header text variant
 */
export function HeaderText({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Text bold={true} color={colors.primaryBright}>
      {children}
    </Text>
  );
}

/**
 * Label text variant
 */
export function LabelText({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Text bold={true} dimColor={true}>
      {children}
    </Text>
  );
}

/**
 * Muted text variant
 */
export function MutedText({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text dimColor={true}>{children}</Text>;
}

/**
 * Success text variant
 */
export function SuccessText({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={colors.success}>{children}</Text>;
}

/**
 * Error text variant
 */
export function ErrorText({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={colors.error}>{children}</Text>;
}

/**
 * Warning text variant
 */
export function WarningText({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={colors.warning}>{children}</Text>;
}
