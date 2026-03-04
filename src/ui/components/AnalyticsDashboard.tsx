/**
 * Analytics Dashboard Component
 *
 * Real-time analytics display using Ink TUI.
 * Subscribes to analytics events and updates state accordingly.
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { getAnalyticsCounts } from '../../db.js';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';

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

export function AnalyticsDashboard(): React.ReactElement {
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
        // Silently ignore fetch errors - will retry on next event
      }
    }
    fetchStats();

    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to events
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
    <Box flexDirection="column" padding={1}>
      <Text bold={true} underline={true}>
        Analytics Dashboard
      </Text>
      <Box marginTop={1} flexDirection="row" gap={4}>
        <Box flexDirection="column">
          <Text>Total: {stats.total}</Text>
          <Text color="yellow">Pending: {stats.pending}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="green">Verified: {stats.verified}</Text>
          <Text color="red">Invalid: {stats.invalid}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="green">Sent: {stats.sent}</Text>
          <Text color="red">Failed: {stats.failed}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="yellow">Bounced: {stats.bounced}</Text>
          <Text color="red">Complained: {stats.complained}</Text>
        </Box>
      </Box>
    </Box>
  );
}
