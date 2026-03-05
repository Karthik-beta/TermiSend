/**
 * Dashboard
 *
 * Purpose: Main dashboard layout — vertical single-column flow.
 * Layout: Header → Campaign Banner → Analytics → Main Content → Activity Feed → Status Bar
 *
 * The UI shows campaign progress, analytics, and live events at all times.
 * Main content area switches between Menu, Import, and Campaign views.
 */

/** @jsxImportSource react */
import { Box, useApp, useInput, useStdout } from 'ink';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEmailVerifierCredits } from '../../db.js';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import { logger } from '../../logger.js';
import { fetchQuotaStatus } from '../../ses-quota.js';
import { shutdown } from '../../shutdown.js';
import type { QuotaStatus } from '../../types.js';
import { useCampaign, useContacts, useNavigation } from '../hooks/index.js';
import { useActivityFeed } from '../hooks/useActivityFeed.js';
import { layout } from '../theme.js';
import type { DashboardView } from '../types.js';
import { ActivityFeed } from './ActivityFeed.js';
import { AnalyticsPanel } from './AnalyticsPanel.js';
import { CampaignBanner } from './CampaignBanner.js';
import { CampaignForm } from './CampaignForm.js';
import { Header } from './Header.js';
import { ImportForm } from './ImportForm.js';
import { Menu } from './Menu.js';
import { StatusBar } from './StatusBar.js';

/**
 * Main dashboard layout component
 */
export function Dashboard(): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Terminal dimensions
  const terminalHeight = stdout.rows;

  // Fixed section heights
  const fixedHeight =
    layout.headerHeight + layout.bannerHeight + layout.analyticsHeight + layout.statusBarHeight;

  // Activity feed height — 30% of remaining space, min 5 lines
  const remainingHeight = Math.max(10, terminalHeight - fixedHeight);
  const feedHeight = Math.max(5, Math.min(layout.feedHeight, Math.floor(remainingHeight * 0.35)));
  const mainContentHeight = Math.max(6, remainingHeight - feedHeight);

  // Feed visible entries (each entry = 1 line, minus header line)
  const feedVisibleEntries = Math.max(3, feedHeight - 2);

  // Navigation state
  const { currentView, navigateTo, handleMenuSelect, goToMenu } = useNavigation(exit);

  // Contact data
  const { refresh: refreshContacts } = useContacts();

  // Campaign state (LIFTED to share between Banner and Form)
  const campaign = useCampaign();
  const { liveProgress, status: campaignStatus } = campaign;

  // SES Quota state
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  // Activity feed
  const activityFeed = useActivityFeed();

  // Verifier Credits state
  const [verifierCredits, setVerifierCredits] = useState<number | null>(null);

  // Fetch verifier credits initially and periodically
  useEffect(() => {
    let mounted = true;
    const fetchCredits = async () => {
      try {
        const res = await getEmailVerifierCredits();
        if (mounted && res) {
          setVerifierCredits(res.credits);
        }
      } catch (error) {
        // Log error for debugging but don't crash UI
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to fetch MyEmailVerifier credits', { error: errorMessage });
      }
    };

    fetchCredits();
    // Refresh credits every 60 seconds (less frequent than SES quota)
    const interval = setInterval(fetchCredits, 60000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);
  // Fetch SES quota periodically
  useEffect(() => {
    let mounted = true;
    const fetchQuota = async () => {
      try {
        const status = await fetchQuotaStatus();
        if (mounted && status) {
          setQuota(status);
        }
      } catch {
        // Silently ignore
      }
    };

    fetchQuota();
    const interval = setInterval(fetchQuota, 30000); // Refresh every 30s

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);
  // Subscribe to verifier credits updates
  useEffect(() => {
    const handleEvent = (event: AnalyticsEvent) => {
      if (event.type === 'verifier:credits_updated') {
        setVerifierCredits(event.credits);
      }
    };
    eventBus.on('analytics', handleEvent);
    return () => {
      eventBus.off('analytics', handleEvent);
    };
  }, []);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Global quit shortcut
    if (input === 'q' || input === 'Q') {
      shutdown();
      exit();
      process.exit(0);
    }

    // Navigation shortcuts from menu
    if (currentView === 'MENU') {
      if (input === 'i' || input === 'I') {
        navigateTo('IMPORT');
      }
      if (input === 'c' || input === 'C') {
        navigateTo('CAMPAIGN');
      }
    }

    // Escape to go back (not during running campaign)
    if (key.escape && campaignStatus !== 'running') {
      goToMenu();
    }
  });

  // Refresh contacts when returning after import
  const handleImportComplete = useCallback(() => {
    refreshContacts().catch(() => {
      // Error handled by hook
    });
  }, [refreshContacts]);

  // Render main content based on current view
  const renderMainContent = useMemo(() => {
    return (view: DashboardView): React.ReactElement => {
      switch (view) {
        case 'IMPORT':
          return <ImportForm onImportComplete={handleImportComplete} />;
        case 'CAMPAIGN':
          return <CampaignForm onCampaignComplete={goToMenu} campaign={campaign} />;
        default:
          return <Menu onSelect={handleMenuSelect} />;
      }
    };
  }, [handleImportComplete, goToMenu, handleMenuSelect, campaign]);

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {/* Header — 1 line */}
      <Header
        isConnected={true}
        verifierCredits={verifierCredits}
        quotaRemaining={quota?.remainingQuota}
        quotaTotal={quota?.max24HourSend}
      />

      {/* Campaign Banner — 3 lines */}
      <CampaignBanner campaignStatus={campaignStatus} progress={liveProgress} />

      {/* Analytics Panel — compact metrics row */}
      <AnalyticsPanel />

      {/* Main Content Area — flex grow */}
      <Box flexGrow={1} flexDirection="column" height={mainContentHeight} overflow="hidden">
        {renderMainContent(currentView)}
      </Box>

      {/* Activity Feed — bottom section */}
      <ActivityFeed
        events={activityFeed.events}
        maxVisible={feedVisibleEntries}
        height={feedHeight}
      />

      {/* Status Bar — 1 line */}
      <StatusBar currentView={currentView} />
    </Box>
  );
}
