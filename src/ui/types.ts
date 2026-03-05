/**
 * UI-Specific Type Definitions for TermiSend Dashboard
 *
 * Purpose: Type definitions specific to the dashboard UI layer
 * Props: N/A - Type exports
 * State: N/A - Type definitions
 * Extension: Add new view types, menu items, or UI state as features expand
 */

import type { CampaignResult, Contact, ImportResult, SendStatus } from '../types.js';

// ============================================================================
// Navigation Types
// ============================================================================

/**
 * Available dashboard views
 */
export type DashboardView = 'MENU' | 'IMPORT' | 'CAMPAIGN' | 'RESULTS';

/**
 * Navigation menu item
 */
export interface MenuItem {
  label: string;
  value: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
}

// ============================================================================
// Import State Types
// ============================================================================

export type ImportStatus = 'idle' | 'loading' | 'success' | 'error';
export type TemplateStatus = 'idle' | 'downloading' | 'success' | 'error';

/**
 * Import operation state
 */
export interface ImportState {
  status: ImportStatus;
  result: ImportResult | null;
  error: string | null;
  filePath: string;
}

/**
 * Template download state
 */
export interface TemplateState {
  status: TemplateStatus;
  filePath: string | null;
  error: string | null;
}

// ============================================================================
// Campaign State Types
// ============================================================================

export type CampaignViewStatus =
  | 'idle'
  | 'loading'
  | 'preview'
  | 'confirm'
  | 'running'
  | 'success'
  | 'error';

/**
 * Campaign operation state
 */
export interface CampaignState {
  status: CampaignViewStatus;
  templatePath: string;
  pendingCount: number;
  result: CampaignResult | null;
  error: string | null;
  preview: {
    subject: string;
    textBody: string;
  } | null;
}

/**
 * Live campaign progress
 */
export interface LiveProgress {
  currentContact: number;
  totalContacts: number;
  currentEmail: string;
  status: SendStatus;
  waitTimeRemainingMs?: number;
  totalWaitTimeMs?: number;
  message?: string;
}

/**
 * Log entry for activity feed
 */
export interface LogEntry {
  email: string;
  status: SendStatus;
  message?: string;
  timestamp?: Date;
}

// ============================================================================
// Activity Feed Types
// ============================================================================

/**
 * Source tag for activity feed events
 */
export type ActivitySource = 'verifier' | 'ses' | 'import' | 'system';

/**
 * Single event in the live activity feed
 */
export interface ActivityEvent {
  id: number;
  source: ActivitySource;
  message: string;
  status: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
}

// ============================================================================
// Contact State Types
// ============================================================================

/**
 * Contact data management state
 */
export interface ContactsState {
  contacts: Contact[];
  pendingCount: number;
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// Panel Types
// ============================================================================

/**
 * Panel display options
 */
export interface PanelProps {
  title?: string;
  borderColor?: string;
  flexDirection?: 'row' | 'column';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  width?: number | string;
  height?: number | string;
  padding?: number;
  margin?: number;
  children: React.ReactNode;
}

// ============================================================================
// Status Types
// ============================================================================

/**
 * System status information
 */
export interface SystemStatus {
  isConnected: boolean;
  quotaRemaining: number | null;
  quotaTotal: number | null;
  lastError: string | null;
}
