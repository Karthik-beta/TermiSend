/**
 * Dashboard
 *
 * Purpose: Main dashboard layout composing all panels into a cohesive interface
 * Props: None - Self-contained layout component using hooks for state
 * State: Managed via useNavigation, useContacts, and useCampaign hooks
 * Extension: Add customizable layouts, panel resizing, or tabbed interfaces
 */

/** @jsxImportSource react */
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import { shutdown } from '../../shutdown.js';
import { useCampaign, useContacts, useNavigation } from '../hooks/index.js';
import { colors } from '../theme.js';
import type { DashboardView } from '../types.js';
import { CampaignForm } from './CampaignForm.js';
import { ContactList } from './ContactList.js';
import { Header } from './Header.js';
import { ImportForm } from './ImportForm.js';
import { LogOutput } from './LogOutput.js';
import { Menu } from './Menu.js';
import { Panel } from './Panel.js';
import { StatusBar } from './StatusBar.js';

/**
 * Main dashboard layout component
 */
export function Dashboard(): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Get terminal dimensions and calculate responsive layout
  const terminalHeight = stdout.rows;
  const terminalWidth = stdout.columns;

  // Fixed element heights
  const HEADER_HEIGHT = 3; // Header with border
  const STATUS_BAR_HEIGHT = 1; // Status bar height
  const MARGINS = 1; // Reduced top and bottom margins

  // Calculate available height for content
  const availableHeight = useMemo(
    () => Math.max(10, terminalHeight - HEADER_HEIGHT - STATUS_BAR_HEIGHT - MARGINS),
    [terminalHeight]
  );

  // Calculate heights for different sections
  const sidebarHeight = availableHeight;
  const logHeight = Math.max(3, Math.min(6, Math.floor(terminalHeight * 0.10)));
  const mainContentHeight = Math.max(6, availableHeight - logHeight);

  // Calculate max entries for log output based on log panel height
  // Each log entry takes 1 line, and panel has padding + title
  const logMaxEntries = Math.max(2, logHeight - 2);

  // Calculate max contacts to display based on available height
  // Header stats take ~3 lines, each contact takes 2 lines, plus some padding
  const contactMaxDisplay = Math.max(3, Math.floor((mainContentHeight - 4) / 2));

  // Navigation state
  const { currentView, navigateTo, handleMenuSelect, goToMenu } = useNavigation(exit);

  // Contact data
  const {
    contacts,
    pendingCount,
    isLoading: contactsLoading,
    refresh: refreshContacts,
  } = useContacts();

  // Campaign state for log display
  const { logEntries, status: campaignStatus } = useCampaign();

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    // Global quit shortcut
    if (input === 'q' || input === 'Q') {
      shutdown(); // Signal campaign to stop first
      exit();
    }

    // Navigation shortcuts
    if (currentView === 'MENU') {
      if (input === 'i' || input === 'I') {
        navigateTo('IMPORT');
      }
      if (input === 'c' || input === 'C') {
        navigateTo('CAMPAIGN');
      }
    }

    // Escape to go back
    if (key.escape && campaignStatus !== 'running') {
      goToMenu();
    }
  });

  // Refresh contacts when returning to menu after import
  const handleImportComplete = useCallback(() => {
    refreshContacts().catch(() => {
      // Error handled by hook
    });
  }, [refreshContacts]);

  // Render main content based on current view
  const renderMainContent = (view: DashboardView, contentHeight: number): React.ReactElement => {
    switch (view) {
      case 'MENU':
        return (
          <Panel title="Welcome" borderColor={colors.primary} flexGrow={1} minHeight={contentHeight - 2}>
            <Box flexDirection="column" gap={1}>
              <Text>
                Welcome to <Text bold={true}>TermiSend</Text> - Email Outreach Dashboard
              </Text>
              <Box marginTop={1} flexDirection="column">
                <Text dimColor={true}>Quick Start:</Text>
                <Text dimColor={true}> 1. Import contacts from Excel file</Text>
                <Text dimColor={true}> 2. Create email template in markdown</Text>
                <Text dimColor={true}> 3. Launch campaign to send emails</Text>
              </Box>
              <Box marginTop={2}>
                <Text dimColor={true}>Select an option from the menu to begin →</Text>
              </Box>
            </Box>
          </Panel>
        );

      case 'IMPORT':
        return <ImportForm onImportComplete={handleImportComplete} />;

      case 'CAMPAIGN':
        return <CampaignForm onCampaignComplete={goToMenu} />;

      default:
        return (
          <Panel title="Error" borderColor={colors.error}>
            <Text color={colors.error}>Unknown view: {view}</Text>
          </Panel>
        );
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Header isConnected={true} />

      {/* Main Content Area */}
      <Box
        flexGrow={1}
        flexDirection="row"
        marginTop={0}
        height={mainContentHeight}
        overflow="hidden"
      >
        {/* Left Sidebar - Menu */}
        <Box width="20%" flexDirection="column" height={sidebarHeight}>
          <Menu onSelect={handleMenuSelect} />
        </Box>

        {/* Main Content */}
        <Box width="50%" flexDirection="column" paddingX={1} height={sidebarHeight}>
          {renderMainContent(currentView, mainContentHeight)}
        </Box>

        {/* Right Sidebar - Contacts */}
        <Box width="30%" flexDirection="column" height={sidebarHeight}>
          <ContactList
            contacts={contacts}
            pendingCount={pendingCount}
            isLoading={contactsLoading}
            maxDisplay={contactMaxDisplay}
            maxHeight={sidebarHeight}
          />
        </Box>
      </Box>

      {/* Bottom Section - Activity Log */}
      <Box flexShrink={0} marginTop={0} height={logHeight} overflow="hidden">
        <LogOutput entries={logEntries} maxEntries={logMaxEntries} maxHeight={logHeight} />
      </Box>

      {/* Status Bar */}
      <StatusBar currentView={currentView} />
    </Box>
  );
}
