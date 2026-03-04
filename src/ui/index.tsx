/**
 * TermiSend Dashboard UI - Main Entry Point
 *
 * Purpose: Exports the dashboard App component for use in the main application
 * Props: N/A - Module exports
 * State: N/A - Entry point
 * Extension: Add theme providers, error boundaries, or global state providers
 */

/** @jsxImportSource react */
import { Box } from 'ink';
import type React from 'react';
import { AnalyticsDashboard } from './components/AnalyticsDashboard.js';
import { Dashboard } from './components/Dashboard.js';

/**
 * Main App component for the TermiSend Dashboard
 * Wraps the dashboard with any global providers if needed
 */
export default function App(): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <AnalyticsDashboard />
      <Dashboard />
    </Box>
  );
}

// Re-export components for advanced use cases
export {
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
export { useCampaign, useContacts, useImport, useNavigation } from './hooks/index.js';

// Re-export theme
export {
  borders,
  colors,
  formatMsToSeconds,
  getStatusColor,
  getStatusIcon,
  icons,
  layout,
  spacing,
  typography,
} from './theme.js';

// Re-export types
export type {
  CampaignState,
  ContactsState,
  DashboardView,
  ImportState,
  LiveProgress,
  LogEntry,
  MenuItem,
} from './types.js';
