/**
 * AnalyticsPanel
 *
 * Purpose: Compact horizontal metrics bar showing campaign analytics.
 * Subscribes to event bus for real-time updates,
 * falls back to polling getAnalyticsCounts() on initial load.
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { getAnalyticsCounts } from '../../db.js';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import { colors, icons } from '../theme.js';

interface AnalyticsState {
  total: number;
  pending: number;
  verified: number;
  sent: number;
  failed: number;
  invalid: number;
  bounced: number;
  complained: number;
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}): React.ReactElement {
  return (
    <Box>
      <Text dimColor={true}>{label}: </Text>
      <Text bold={true} color={color ?? colors.white}>
        {value}
      </Text>
    </Box>
  );
}

function Separator(): React.ReactElement {
  return <Text dimColor={true}> {icons.separator} </Text>;
}

export function AnalyticsPanel(): React.ReactElement {
  const [stats, setStats] = useState<AnalyticsState>({
    total: 0,
    pending: 0,
    verified: 0,
    sent: 0,
    failed: 0,
    invalid: 0,
    bounced: 0,
    complained: 0,
  });

  // Initial fetch from database
  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      try {
        const result = await getAnalyticsCounts();
        if (!mounted) {
          return;
        }
        setStats((prev) => ({ ...prev, ...result }));
      } catch {
        // Silently ignore — will update on next event
      }
    }
    fetchStats();

    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to event bus for real-time updates
  useEffect(() => {
    const handleEvent = (event: AnalyticsEvent) => {
      setStats((prev) => {
        const next = { ...prev };
        switch (event.type) {
          case 'contact:imported':
            next.total += event.count;
            next.pending += event.count;
            break;
          case 'email:sent':
            next.sent += 1;
            if (next.pending > 0) {
              next.pending -= 1;
            }
            break;
          case 'email:failed':
            next.failed += 1;
            if (next.pending > 0) {
              next.pending -= 1;
            }
            break;
          case 'contact:verified':
            if (event.isValid) {
              next.verified += 1;
            } else {
              next.invalid += 1;
            }
            break;
          case 'email:bounced':
            next.bounced += 1;
            break;
          case 'email:complained':
            next.complained += 1;
            break;
        }
        return next;
      });
    };

    eventBus.on('analytics', handleEvent);
    return () => {
      eventBus.off('analytics', handleEvent);
    };
  }, []);

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor={colors.dim}
      paddingX={1}
      justifyContent="space-between"
    >
      {/* Left group — totals */}
      <Box gap={0}>
        <Metric label="Total" value={stats.total} />
        <Separator />
        <Metric
          label="Pending"
          value={stats.pending}
          color={stats.pending > 0 ? colors.warning : colors.dim}
        />
        <Separator />
        <Metric
          label="Verified"
          value={stats.verified}
          color={stats.verified > 0 ? colors.info : colors.dim}
        />
      </Box>

      {/* Right group — outcomes */}
      <Box gap={0}>
        <Metric
          label="Sent"
          value={stats.sent}
          color={stats.sent > 0 ? colors.success : colors.dim}
        />
        <Separator />
        <Metric
          label="Failed"
          value={stats.failed}
          color={stats.failed > 0 ? colors.error : colors.dim}
        />
        <Separator />
        <Metric
          label="Invalid"
          value={stats.invalid}
          color={stats.invalid > 0 ? colors.error : colors.dim}
        />
        {stats.bounced > 0 && (
          <>
            <Separator />
            <Metric label="Bounced" value={stats.bounced} color={colors.warning} />
          </>
        )}
      </Box>
    </Box>
  );
}
