/**
 * Analytics View Component
 *
 * Displays detailed periodic analytics (Daily, Weekly, Monthly)
 */

/** @jsxImportSource react */
import { exec } from 'node:child_process';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { getPeriodicAnalytics } from '../../db.js';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import type { PeriodicAnalytics } from '../../types.js';
import { colors } from '../theme.js';
import { Panel } from './Panel.js';

export function AnalyticsView(): React.ReactElement {
  const [data, setData] = useState<PeriodicAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetch() {
      try {
        const result = await getPeriodicAnalytics();
        if (mounted) {
          setData(result);
          setIsLoading(false);
        }
      } catch (_err) {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    fetch();
    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to real-time events to increment stats
  useEffect(() => {
    const handleEvent = (event: AnalyticsEvent) => {
      setData((prev) => {
        if (!prev) {
          return prev;
        }
        const next = {
          daily: { ...prev.daily },
          weekly: { ...prev.weekly },
          monthly: { ...prev.monthly },
        };

        const increment = (field: keyof typeof next.daily) => {
          if (typeof next.daily[field] === 'number') {
            (next.daily[field] as number) += 1;
            (next.weekly[field] as number) += 1;
            (next.monthly[field] as number) += 1;
          }
        };

        switch (event.type) {
          case 'email:sent':
            increment('sent');
            break;
          case 'email:delivered':
            increment('delivered');
            break;
          case 'email:opened':
            increment('opened');
            break;
          case 'email:clicked':
            increment('clicked');
            break;
          case 'email:failed':
            increment('failed');
            break;
          case 'contact:verified':
            if (event.isValid) {
              increment('verified');
            } else {
              increment('invalid');
            }
            break;
          case 'email:bounced':
            increment('bounced');
            break;
          case 'email:complained':
            increment('complained');
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

  // This useInput is for copying data to clipboard
  useInput((input, _key) => {
    if (input.toLowerCase() === 'c' && data) {
      let table = 'TermiSend Analytics Snapshot\n';
      table += '----------------------------------------------------------\n';
      table += `${'Metric'.padEnd(15)}${'Last 24h'.padEnd(12)}${'Last 7d'.padEnd(12)}Last 30d\n`;
      table += '----------------------------------------------------------\n';
      const rows = [
        ['Sent', 'sent'],
        ['Delivered', 'delivered'],
        ['Opened', 'opened'],
        ['Clicked', 'clicked'],
        ['Failed', 'failed'],
        ['Verified', 'verified'],
        ['Invalid', 'invalid'],
        ['Bounced', 'bounced'],
        ['Complained', 'complained'],
      ] as const;

      for (const [label, field] of rows) {
        table += `${label.padEnd(15)}${String(data.daily[field]).padEnd(12)}${String(data.weekly[field]).padEnd(12)}${String(data.monthly[field])}\n`;
      }

      table += '\nRates\n';
      table += '----------------------------------------------------------\n';

      const rateRows = [
        ['Delivery Rate', 'delivered', 'sent'],
        ['Open Rate', 'opened', 'delivered'],
        ['Click Rate', 'clicked', 'opened'],
      ] as const;

      for (const [label, num, denom] of rateRows) {
        table += `${label.padEnd(15)}${calculateRate(Number(data.daily[num]), Number(data.daily[denom])).padEnd(12)}${calculateRate(Number(data.weekly[num]), Number(data.weekly[denom])).padEnd(12)}${calculateRate(Number(data.monthly[num]), Number(data.monthly[denom]))}\n`;
      }

      table += '----------------------------------------------------------\n';

      const proc = exec('clip', (error) => {
        if (error) {
          setCopyStatus('Failed to copy');
        } else {
          setCopyStatus('Copied to clipboard!');
        }
        setTimeout(() => setCopyStatus(null), 3000);
      });

      if (proc.stdin) {
        proc.stdin.write(table);
        proc.stdin.end();
      }
    }
  });

  if (isLoading) {
    return (
      <Panel title="Detailed Analytics" padding={1}>
        <Text color={colors.primary}>Loading Analytics...</Text>
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Detailed Analytics" padding={1}>
        <Text color={colors.error}>Failed to load analytics data.</Text>
      </Panel>
    );
  }

  const renderRow = (label: string, field: keyof typeof data.daily, color?: string) => (
    <Box flexDirection="row" marginBottom={1}>
      <Box width={15}>
        <Text color={color ?? colors.white}>{label}</Text>
      </Box>
      <Box width={12}>
        <Text>{String(data.daily[field])}</Text>
      </Box>
      <Box width={12}>
        <Text>{String(data.weekly[field])}</Text>
      </Box>
      <Box width={12}>
        <Text>{String(data.monthly[field])}</Text>
      </Box>
    </Box>
  );

  const calculateRate = (numerator: number, denominator: number) => {
    if (denominator === 0) {
      return '0%';
    }
    return `${Math.round((numerator / denominator) * 100)}%`;
  };

  const renderRateRow = (
    label: string,
    fieldNum: keyof typeof data.daily,
    fieldDenom: keyof typeof data.daily
  ) => (
    <Box flexDirection="row" marginBottom={1}>
      <Box width={15}>
        <Text color={colors.info}>{label}</Text>
      </Box>
      <Box width={12}>
        <Text>{calculateRate(Number(data.daily[fieldNum]), Number(data.daily[fieldDenom]))}</Text>
      </Box>
      <Box width={12}>
        <Text>{calculateRate(Number(data.weekly[fieldNum]), Number(data.weekly[fieldDenom]))}</Text>
      </Box>
      <Box width={12}>
        <Text>
          {calculateRate(Number(data.monthly[fieldNum]), Number(data.monthly[fieldDenom]))}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Panel title="Detailed Analytics" padding={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Box width={15}>
            <Text bold={true} color={colors.primary}>
              Metric
            </Text>
          </Box>
          <Box width={12}>
            <Text bold={true} color={colors.primary}>
              Last 24h
            </Text>
          </Box>
          <Box width={12}>
            <Text bold={true} color={colors.primary}>
              Last 7d
            </Text>
          </Box>
          <Box width={12}>
            <Text bold={true} color={colors.primary}>
              Last 30d
            </Text>
          </Box>
        </Box>

        {renderRow('Sent', 'sent', colors.success)}
        {renderRow('Delivered', 'delivered', colors.successBright)}
        {renderRow('Opened', 'opened', colors.primary)}
        {renderRow('Clicked', 'clicked', colors.primaryBright)}
        {renderRow('Failed', 'failed', colors.error)}
        {renderRow('Verified', 'verified', colors.info)}
        {renderRow('Invalid', 'invalid', colors.error)}
        {renderRow('Bounced', 'bounced', colors.warning)}
        {renderRow('Complained', 'complained', colors.error)}

        <Box marginTop={1} marginBottom={1}>
          <Text dimColor={true}>-------------------------------------------</Text>
        </Box>

        {renderRateRow('Delivery Rate', 'delivered', 'sent')}
        {renderRateRow('Open Rate', 'opened', 'delivered')}
        {renderRateRow('Click Rate', 'clicked', 'opened')}
      </Box>

      <Box marginTop={2} flexDirection="column">
        {copyStatus && (
          <Box marginBottom={1}>
            <Text color={copyStatus.includes('Failed') ? colors.error : colors.success}>
              {copyStatus}
            </Text>
          </Box>
        )}
        <Box flexDirection="row">
          <Text dimColor={true}>Press </Text>
          <Text color={colors.primary}>[C]</Text>
          <Text dimColor={true}> to copy to clipboard | Press </Text>
          <Text color={colors.primary}>[Esc]</Text>
          <Text dimColor={true}> to go back.</Text>
        </Box>
      </Box>
    </Panel>
  );
}
