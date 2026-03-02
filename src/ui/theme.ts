/**
 * Theme Configuration for TermiSend Dashboard UI
 *
 * Purpose: Centralized color, spacing, and styling constants for consistent UI appearance
 * Props: N/A - Constants export
 * State: N/A - Static configuration
 * Extension: Add new color schemes, spacing scales, or border styles as needed
 */

// ============================================================================
// Color Palette
// ============================================================================

export const colors = {
  // Primary brand colors
  primary: 'cyan',
  primaryBright: 'cyanBright',
  secondary: 'blue',
  secondaryBright: 'blueBright',

  // Semantic colors
  success: 'green',
  successBright: 'greenBright',
  warning: 'yellow',
  warningBright: 'yellowBright',
  error: 'red',
  errorBright: 'redBright',
  info: 'blue',

  // Neutral colors
  white: 'white',
  gray: 'gray',
  dim: 'gray',
  black: 'black',

  // Status-specific colors
  status: {
    verifying: 'yellow',
    waiting: 'yellow',
    sending: 'blue',
    completed: 'green',
    skipped: 'gray',
    failed: 'red',
    idle: 'white',
    loading: 'yellow',
  } as const,
} as const;

// ============================================================================
// Spacing Scale
// ============================================================================

export const spacing = {
  none: 0,
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 5,
} as const;

// ============================================================================
// Border Styles
// ============================================================================

export const borders = {
  none: undefined,
  single: 'single',
  double: 'double',
  round: 'round',
  bold: 'bold',
  singleDouble: 'singleDouble',
  doubleSingle: 'doubleSingle',
  classic: 'classic',
} as const;

// ============================================================================
// Layout Dimensions
// ============================================================================

export const layout = {
  // Dashboard layout percentages
  sidebarWidth: 20, // Percentage
  mainWidth: 50, // Percentage
  contactsWidth: 30, // Percentage

  // Fixed dimensions
  headerHeight: 3,
  statusBarHeight: 1,
  logPanelHeight: 8,

  // Progress bar
  progressBarWidth: 30,
} as const;

// ============================================================================
// Typography
// ============================================================================

export const typography = {
  // Text styles
  bold: true,
  dim: true,
  underline: true,
  italic: true,
  strikethrough: true,

  // Common decorations
  header: { bold: true },
  label: { bold: true, dimColor: true },
  value: {},
  muted: { dimColor: true },
} as const;

// ============================================================================
// Status Icons
// ============================================================================

export const icons = {
  // Navigation
  menu: '☰',
  import: '📥',
  campaign: '📤',
  quit: '❌',
  back: '←',

  // Status indicators
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  pending: '○',

  // Sending status
  verifying: '🔄',
  waiting: '⏱️',
  sending: '📤',
  completed: '✓',
  skipped: '→',
  failed: '✗',

  // UI elements
  bullet: '•',
  arrow: '→',
  ellipsis: '…',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get color for a send status
 */
export function getStatusColor(status: string): string {
  return colors.status[status as keyof typeof colors.status] ?? colors.white;
}

/**
 * Get icon for a send status
 */
export function getStatusIcon(status: string): string {
  const iconMap: Record<string, string> = {
    verifying: icons.verifying,
    waiting: icons.waiting,
    sending: icons.sending,
    completed: icons.completed,
    skipped: icons.skipped,
    failed: icons.failed,
    idle: icons.pending,
    loading: icons.pending,
  };
  return iconMap[status] ?? icons.pending;
}

/**
 * Format milliseconds to human-readable string
 */
export function formatMsToSeconds(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}
