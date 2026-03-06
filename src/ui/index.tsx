/**
 * TermiSend Dashboard UI - Main Entry Point
 *
 * Purpose: Exports the dashboard App component for use in the main application.
 * The Dashboard component handles the full layout internally.
 */

/** @jsxImportSource react */
import { Box } from 'ink';
import type React from 'react';
import { Dashboard } from './components/Dashboard.js';

/**
 * Main App component for the TermiSend Dashboard
 */
export default function App(): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <Dashboard />
    </Box>
  );
}

// Re-export components for advanced use cases
export {
  ActivityFeed,
  AnalyticsDashboard,
  AnalyticsPanel,
  AnalyticsView,
  CampaignBanner,
  CampaignForm,
  CampaignStatus,
  ContactList,
  Dashboard,
  Header,
  ImportForm,
  LogOutput,
  Menu,
  Panel,
  StatusBar,
} from './components/index.js';

// Re-export hooks
export {
  useActivityFeed,
  useCampaign,
  useContacts,
  useImport,
  useNavigation,
} from './hooks/index.js';

// Re-export theme
export {
  borders,
  colors,
  formatMsToSeconds,
  getSourceColor,
  getStatusColor,
  getStatusIcon,
  icons,
  layout,
  spacing,
  typography,
} from './theme.js';

// Re-export types
export type {
  ActivityEvent,
  ActivitySource,
  CampaignState,
  ContactsState,
  DashboardView,
  ImportState,
  LiveProgress,
  LogEntry,
  MenuItem,
} from './types.js';
