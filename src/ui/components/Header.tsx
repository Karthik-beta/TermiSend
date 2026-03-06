/**
 * Header
 *
 * Purpose: Compact single-line app header with connection indicators.
 * Industrial aesthetic — block character, separator line, status dots.
 */

/** @jsxImportSource react */
import { Box, Spacer, Text } from 'ink';
import type React from 'react';
import { colors, icons } from '../theme.js';

interface HeaderProps {
  /** Remaining SES quota */
  quotaRemaining?: number | null;
  /** Total SES quota */
  quotaTotal?: number | null;
  /** Database connection status */
  isConnected?: boolean;
  /** MyEmailVerifier credits */
  verifierCredits?: number | null;
}

export function Header({
  quotaRemaining,
  quotaTotal,
  isConnected = true,
  verifierCredits,
}: HeaderProps): React.ReactElement {
  const quotaPercent =
    quotaTotal && quotaTotal > 0 && quotaRemaining !== null && quotaRemaining !== undefined
      ? ((quotaTotal - quotaRemaining) / quotaTotal) * 100
      : null;
  const quotaPercentLabel =
    quotaPercent === null
      ? null
      : quotaPercent > 0 && quotaPercent < 1
        ? `${quotaPercent.toFixed(2)}%`
        : `${quotaPercent.toFixed(1)}%`;

  return (
    <Box flexDirection="row" paddingX={1}>
      {/* App Title */}
      <Text bold={true} color={colors.primary}>
        {icons.block}TermiSend
      </Text>
      <Text dimColor={true}> {icons.line.repeat(3)} Email Outreach</Text>

      <Spacer />

      {/* Status Indicators */}
      <Box gap={2}>
        <Box>
          <Text dimColor={true}>DB:</Text>
          <Text color={isConnected ? colors.success : colors.error}>
            {isConnected ? icons.success : icons.error}
          </Text>
        </Box>

        {quotaPercent !== null && (
          <Box>
            <Text dimColor={true}>SES:</Text>
            <Text
              color={
                quotaPercent > 90
                  ? colors.error
                  : quotaPercent > 70
                    ? colors.warning
                    : colors.success
              }
            >
              {quotaPercentLabel}
            </Text>
          </Box>
        )}

        <Box>
          <Text dimColor={true}>Credits:</Text>
          {verifierCredits !== undefined && verifierCredits !== null ? (
            <Text color={colors.info}>{verifierCredits}</Text>
          ) : (
            <Text color={colors.gray}>-</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
