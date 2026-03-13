/**
 * Theme Configuration for TermiSend Dashboard UI
 *
 * Industrial/utilitarian terminal aesthetic.
 * Monochrome base with sharp amber and green accents.
 * Designed for clarity during campaign execution.
 */

// ============================================================================
// Color Palette — Monochrome + Amber/Green accents
// ============================================================================

export const colors = {
  // Primary accent — amber/gold for key UI elements
  primary: 'yellow',
  primaryBright: 'yellowBright',

  // Secondary accent — cool blue for structural elements
  secondary: 'blue',
  secondaryBright: 'blueBright',

  // Semantic colors
  success: 'green',
  successBright: 'greenBright',
  warning: 'yellow',
  warningBright: 'yellowBright',
  error: 'red',
  errorBright: 'redBright',
  info: 'cyan',

  // Neutral colors
  white: 'white',
  gray: 'gray',
  dim: 'gray',
  black: 'black',

  // Status-specific colors
  status: {
    verifying: 'cyan',
    waiting: 'yellow',
    sending: 'blueBright',
    completed: 'green',
    skipped: 'gray',
    failed: 'red',
    idle: 'gray',
    loading: 'yellow',
  } as const,

  // Activity feed source colors
  source: {
    verifier: 'cyan',
    ses: 'blueBright',
    import: 'magenta',
    system: 'gray',
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
// Layout Dimensions — Vertical Flow
// ============================================================================

export const layout = {
  // Vertical section heights
  headerHeight: 1,
  bannerHeight: 3,
  analyticsHeight: 3,
  feedHeight: 10,
  statusBarHeight: 1,

  // Progress bar
  progressBarWidth: 30,

  // Activity feed
  maxFeedEntries: 30,
  visibleFeedEntries: 8,
} as const;

// ============================================================================
// Typography
// ============================================================================

export const typography = {
  bold: true,
  dim: true,
  underline: true,
  italic: true,
  strikethrough: true,

  header: { bold: true },
  label: { bold: true, dimColor: true },
  value: {},
  muted: { dimColor: true },
} as const;

// ============================================================================
// Icons — Clean ASCII for terminal compatibility
// ============================================================================

export const icons = {
  // Navigation
  menu: '≡',
  import: '>>',
  campaign: '>>',
  analytics: '>>',
  unsubscribe: '>>',
  quit: '×',
  back: '<-',

  // Status indicators
  success: '✓',
  error: '✗',
  warning: '!',
  info: '·',
  pending: '○',

  // Sending status
  verifying: '~',
  waiting: '…',
  sending: '>',
  completed: '✓',
  skipped: '-',
  failed: '✗',

  // UI elements
  bullet: '·',
  arrow: '→',
  ellipsis: '…',
  separator: '│',
  block: '▌',
  line: '─',
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

/**
 * Get color for an activity feed source tag
 */
export function getSourceColor(source: string): string {
  return colors.source[source as keyof typeof colors.source] ?? colors.gray;
}
