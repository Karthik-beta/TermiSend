/**
 * Header
 *
 * Purpose: App header displaying title, connection status, and SES quota information
 * Props: { quotaRemaining?: number | null, quotaTotal?: number | null, isConnected?: boolean }
 * State: None - Presentational component
 * Extension: Add user info, notifications, or system alerts
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
}

export function Header({
  quotaRemaining,
  quotaTotal,
  isConnected = true,
}: HeaderProps): React.ReactElement {
  const quotaPercent =
    quotaTotal && quotaTotal > 0 && quotaRemaining !== null && quotaRemaining !== undefined
      ? Math.round(((quotaTotal - quotaRemaining) / quotaTotal) * 100)
      : null;

  return (
    <Box
      borderStyle="round"
      borderColor={colors.primary}
      paddingX={2}
      paddingY={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      {/* App Title */}
      <Box>
        <Text bold={true} color={colors.primaryBright}>
          📧 TermiSend
        </Text>
        <Text dimColor={true}> - Email Outreach Dashboard</Text>
      </Box>

      <Spacer />

      {/* Status Indicators */}
      <Box gap={2}>
        {/* Connection Status */}
        <Box>
          <Text dimColor={true}>DB: </Text>
          <Text color={isConnected ? colors.success : colors.error}>
            {isConnected ? `${icons.success} Connected` : `${icons.error} Disconnected`}
          </Text>
        </Box>

        {/* SES Quota */}
        {quotaPercent !== null && (
          <Box>
            <Text dimColor={true}>SES: </Text>
            <Text
              color={
                quotaPercent > 90
                  ? colors.error
                  : quotaPercent > 70
                    ? colors.warning
                    : colors.success
              }
            >
              {quotaPercent}% used
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
