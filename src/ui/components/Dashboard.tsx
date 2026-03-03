/**
 * Dashboard
 *
 * Purpose: Main dashboard layout composing all panels into a cohesive interface
 * Props: None - Self-contained layout component using hooks for state
 * State: Managed via useNavigation, useContacts, and useCampaign hooks
 * Extension: Add customizable layouts, panel resizing, or tabbed interfaces
 */

/** @jsxImportSource react */
import { Box, Text, useApp, useInput } from 'ink';
import type React from 'react';
import { useCallback } from 'react';
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
  const renderMainContent = (view: DashboardView): React.ReactElement => {
    switch (view) {
      case 'MENU':
        return (
          <Panel title="Welcome" borderColor={colors.primary} flexGrow={1}>
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
      <Box flexGrow={1} flexDirection="row" marginTop={1}>
        {/* Left Sidebar - Menu */}
        <Box width="20%" flexDirection="column">
          <Menu onSelect={handleMenuSelect} />
        </Box>

        {/* Main Content */}
        <Box width="50%" flexDirection="column" paddingX={1}>
          {renderMainContent(currentView)}
        </Box>

        {/* Right Sidebar - Contacts */}
        <Box width="30%" flexDirection="column">
          <ContactList
            contacts={contacts}
            pendingCount={pendingCount}
            isLoading={contactsLoading}
          />
        </Box>
      </Box>

      {/* Bottom Section - Activity Log */}
      <Box flexShrink={0} marginTop={1}>
        <LogOutput entries={logEntries} maxEntries={6} />
      </Box>

      {/* Status Bar */}
      <StatusBar currentView={currentView} />
    </Box>
  );
}
