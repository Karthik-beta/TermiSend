/**
 * Analytics View Component
 *
 * Displays detailed periodic analytics (Daily, Weekly, Monthly)
 */

/** @jsxImportSource react */
import { spawn } from 'node:child_process';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { getPeriodicAnalytics } from '../../db.js';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import type { PeriodicAnalytics } from '../../types.js';
import { colors } from '../theme.js';
import { generateAnalyticsCardJpeg, warmAnalyticsCardRenderer } from '../utils/analytics-card.js';
import { Panel } from './Panel.js';

export function AnalyticsView(): React.ReactElement {
  const [data, setData] = useState<PeriodicAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    warmAnalyticsCardRenderer().catch(() => {
      // Ignore warmup errors
    });

    async function refreshData() {
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

    refreshData();

    const handleEvent = (event: AnalyticsEvent) => {
      switch (event.type) {
        case 'email:sent':
        case 'email:delivered':
        case 'email:opened':
        case 'email:clicked':
        case 'email:failed':
        case 'email:bounced':
        case 'email:complained':
        case 'contact:verified':
          refreshData().catch(() => {
            // Ignore refresh errors
          });
          break;
      }
    };

    eventBus.on('analytics', handleEvent);
    return () => {
      mounted = false;
      eventBus.off('analytics', handleEvent);
    };
  }, []);

  // This useInput is for copying data to clipboard
  useInput((input, _key) => {
    if (input.toLowerCase() === 'c' && data) {
      setCopyStatus('Rendering share card...');
      copyAnalyticsCardToClipboard(data, setCopyStatus).catch(() => {
        setCopyStatus('Failed to copy image');
      });
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
              Today IST
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
        {renderRow('Total Opens', 'totalOpens', colors.primary)}
        {renderRow('Total Clicks', 'totalClicks', colors.primaryBright)}
        {renderRow('Failed', 'failed', colors.error)}
        {renderRow('Verified', 'verified', colors.info)}
        {renderRow('Invalid', 'invalid', colors.error)}
        {renderRow('Bounced', 'bounced', colors.warning)}
        {renderRow('Hard Bounce', 'hardBounced', colors.warning)}
        {renderRow('Soft Bounce', 'softBounced', colors.info)}
        {renderRow('Complained', 'complained', colors.error)}
        {renderRow('Avg Deliv ms', 'averageDeliveryTimeMs', colors.info)}

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
          <Text dimColor={true}> to copy shareable image | Press </Text>
          <Text color={colors.primary}>[Esc]</Text>
          <Text dimColor={true}> to go back.</Text>
        </Box>
      </Box>
    </Panel>
  );
}

async function copyAnalyticsCardToClipboard(
  data: PeriodicAnalytics,
  setCopyStatus: (value: string | null) => void
): Promise<void> {
  try {
    const imagePath = await generateAnalyticsCardJpeg(data);
    const escapedPath = imagePath.replaceAll("'", "''");
    const powershellArgs = [
      '-NoProfile',
      '-STA',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${escapedPath}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`,
    ];

    const ps = spawn('powershell.exe', powershellArgs);

    ps.on('close', (code) => {
      if (code !== 0) {
        setCopyStatus('Failed to copy image');
      } else {
        setCopyStatus('Shareable image copied!');
      }
      setTimeout(() => setCopyStatus(null), 3000);
    });

    ps.on('error', () => {
      setCopyStatus('Failed to start copy process');
      setTimeout(() => setCopyStatus(null), 3000);
    });
  } catch {
    setCopyStatus('Failed to render image');
    setTimeout(() => setCopyStatus(null), 3000);
  }
}
