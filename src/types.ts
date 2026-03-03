/**
 * Type definitions for TermiSend
 * Central type definitions for database entities, API responses, and function parameters
 */

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * Represents a contact in the database
 * Contacts are identity-only - send status is tracked in send_logs table
 */
export interface Contact {
  id: string;
  companyName: string;
  personName: string;
  email: string;
  createdAt: Date;
}

/**
 * Send log status values
 * Tracks the outcome of each send attempt
 */
export type LogStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/**
 * Send mode for campaign execution
 */
export type SendMode = 'production' | 'test' | 'dry_run';

/**
 * Represents a send log entry in the database
 * Tracks every email send attempt with full context for retry support
 */
export interface SendLog {
  id: string;
  contactId: string; // FK to contacts
  campaignId?: string; // Optional - for future campaigns feature
  status: LogStatus;
  mode: SendMode;
  subject: string; // What was sent
  bodyPreview: string; // First 500 chars of body
  errorReason?: string; // If failed, why
  messageId?: string; // SES message ID
  sentAt?: Date; // When actually sent
  createdAt: Date; // When log entry created
}

/**
 * Represents an audit log entry in the database
 */
export interface AuditLog {
  id: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// Event Types for Audit Logging
// ============================================================================

export type EventType =
  | 'USER_INPUT'
  | 'EXCEL_IMPORT_START'
  | 'EXCEL_IMPORT_ROW_VALID'
  | 'EXCEL_IMPORT_ROW_INVALID'
  | 'EXCEL_IMPORT_COMPLETE'
  | 'API_VERIFIER_REQ'
  | 'API_VERIFIER_RES'
  | 'AWS_SES_REQ'
  | 'AWS_SES_RES'
  | 'CONTACT_UPDATED'
  | 'SEND_LOG_CREATED'
  | 'SEND_LOG_UPDATED'
  | 'ERROR';

// ============================================================================
// Excel Import Types
// ============================================================================

/**
 * Raw row data from Excel file
 */
export interface ExcelRow {
  'Company Name': string;
  'Person Name': string;
  Email: string;
}

/**
 * Validated contact data
 */
export interface ContactInput {
  companyName: string;
  personName: string;
  email: string;
  [key: string]: string;
}

/**
 * Result of Excel import operation
 */
export interface ImportResult {
  totalRows: number;
  successCount: number; // Kept for backward compatibility
  failedCount: number;
  insertedCount: number; // New contacts inserted into DB
  skippedCount: number; // Duplicates within the same file
  existingCount: number; // Contacts already existing in DB
  errors: Array<{ row: number; error: string }>;
}

// ============================================================================
// Email Verification Types
// ============================================================================

/**
 * Response from MyEmailVerifier API
 */
export interface EmailVerificationResponse {
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'role' | 'disposable';
  risk: 'low' | 'medium' | 'high';
  email?: string;
  message?: string;
  [key: string]: string | undefined;
}

/**
 * Response from MyEmailVerifier Credits API
 */
export interface EmailVerifierCreditsResponse {
  Credits: string;
}

/**
 * Represents MyEmailVerifier credits in the database
 */
export interface EmailVerifierCredits {
  id: string;
  credits: number;
  updatedAt: Date;
}

// ============================================================================
// AWS SES Types
// ============================================================================

/**
 * Email sending parameters
 */
export interface EmailSendParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Result of email sending operation
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ============================================================================
// Campaign Types
// ============================================================================

/**
 * Result of email campaign
 */
export interface CampaignResult {
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  details: Array<{
    email: string;
    status: 'sent' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

// ============================================================================
// UI State Types
// ============================================================================

export type AppView = 'MENU' | 'IMPORT' | 'CAMPAIGN' | 'RESULTS';

export interface UIState {
  currentView: AppView;
  message: string;
  error: string | null;
  isLoading: boolean;
}

// ============================================================================
// JSON Value Types for Database
// ============================================================================

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

// ============================================================================
// Throttling Types
// ============================================================================

/**
 * Throttling Configuration
 * Controls email sending rate limits and break behavior
 */
export interface ThrottleConfig {
  /** Minimum delay between emails in milliseconds (default: 60000) */
  minDelayMs: number;
  /** Maximum delay between emails in milliseconds (default: 120000) */
  maxDelayMs: number;
  /** Probability (0-100) of triggering a break (default: 5) */
  breakProbabilityPercent: number;
  /** Minimum break duration in minutes (default: 3) */
  breakMinMinutes: number;
  /** Maximum break duration in minutes (default: 5) */
  breakMaxMinutes: number;
}

/**
 * Delay calculation result
 * Contains information about the computed delay and break status
 */
export interface DelayResult {
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Whether a break was triggered */
  breakTriggered: boolean;
  /** Break duration in milliseconds (0 if no break) */
  breakDurationMs: number;
  /** Total delay in milliseconds (base + break) */
  totalDelayMs: number;
}

/**
 * Rate limiter interface
 * Provides methods for acquiring and releasing rate limit permits
 */
export interface RateLimiter {
  /** Acquire permission to proceed (may wait if rate limited) */
  acquire(): Promise<void>;
  /** Release a permit back to the pool */
  release(): void;
}

/**
 * SES Quota status
 * Tracks AWS SES sending limits and usage
 */
export interface QuotaStatus {
  /** Maximum emails allowed per 24 hours */
  max24HourSend: number;
  /** Maximum send rate per second */
  maxSendRate: number;
  /** Emails sent in last 24 hours */
  sentLast24Hours: number;
  /** Remaining quota for current period */
  remainingQuota: number;
}

/**
 * Throttle log entry for audit logging
 * Records throttling events for monitoring and debugging
 */
export interface ThrottleLogEntry {
  event: 'throttle_delay' | 'throttle_break' | 'rate_limit_wait' | 'quota_pause' | 'quota_resume';
  baseDelayMs?: number;
  breakTriggered?: boolean;
  breakDurationMs?: number;
  totalDelayMs?: number;
  reason?: string;
  timestamp: string;
}

// ============================================================================
// Progress Callback Types
// ============================================================================

/**
 * @deprecated Use LogStatus for send log status tracking.
 * This type is kept for progress callback compatibility during the migration.
 * Status of email sending for a contact in progress callbacks
 */
export type SendStatus = 'verifying' | 'waiting' | 'sending' | 'completed' | 'skipped' | 'failed';

/**
 * Progress information for email sending
 * Used for real-time UI updates during campaign execution
 */
export interface SendProgress {
  currentContact: number;
  totalContacts: number;
  email: string;
  status: SendStatus;
  waitTimeRemainingMs?: number; // For countdown display
  totalWaitTimeMs?: number; // Original wait time
  message?: string; // Human-readable status message
}

/**
 * Callback function for progress updates
 * Can be synchronous or asynchronous
 */
export type ProgressCallback = (progress: SendProgress) => void | Promise<void>;

// ============================================================================
// Send Stats Types (for UI)
// ============================================================================

/**
 * Aggregate send statistics for display in UI
 */
export interface SendStats {
  totalContacts: number;
  eligibleForSending: number; // Contacts without successful send log
  pendingSends: number; // Currently pending send logs
  sentLast24Hours: number;
  failedLast24Hours: number;
}

// ============================================================================
// SES Analytics Types
// ============================================================================

/**
 * Analytics event types for message tracking
 * Aligned with AWS SES event types
 */
export type AnalyticsEventType =
  | 'SEND'
  | 'DELIVERY'
  | 'BOUNCE'
  | 'COMPLAINT'
  | 'REJECT'
  | 'FAILURE';

/**
 * Verification status for SES identities
 * Based on AWS SES GetIdentityVerificationAttributes API
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetIdentityVerificationAttributes.html
 */
export type IdentityVerificationStatus =
  | 'Pending'
  | 'Success'
  | 'Failed'
  | 'TemporaryFailure'
  | 'NotStarted';

/**
 * DKIM verification status
 * Based on AWS SES GetIdentityDkimAttributes API
 */
export type DkimVerificationStatus = 'Pending' | 'Success' | 'Failed' | 'NotStarted';

/**
 * Source of quota data - indicates if data came from API or cache
 */
export type QuotaSource = 'api' | 'cached';

/**
 * SES quota snapshot from GetSendQuota API
 * Tracks periodic quota measurements for historical analysis
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetSendQuota.html
 */
export interface QuotaSnapshot {
  /** Maximum number of emails allowed per 24-hour period */
  max24HourSend: number;
  /** Maximum number of emails allowed per second */
  maxSendRate: number;
  /** Number of emails sent in the last 24 hours */
  sentLast24Hours: number;
  /** When this snapshot was recorded */
  recordedAt: Date;
  /** Source of the data - 'api' for fresh fetch, 'cached' if from local cache */
  source: QuotaSource;
}

/**
 * Single data point from GetSendStatistics API
 * Represents a 15-minute period of sending activity
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetSendStatistics.html
 */
export interface SendStatistics {
  /** The time when this data point was recorded */
  timestamp: Date;
  /** Number of delivery attempts during this period */
  deliveryAttempts: number;
  /** Number of emails that bounced during this period */
  bounces: number;
  /** Number of complaint notifications received during this period */
  complaints: number;
  /** Number of emails rejected by SES during this period */
  rejects: number;
  /** When this data point was fetched from the API */
  fetchedAt: Date;
}

/**
 * SES identity verification status
 * Tracks verification state for email addresses and domains
 * @see https://docs.aws.amazon.com/ses/latest/APIReference/API_GetIdentityVerificationAttributes.html
 */
export interface IdentityStatus {
  /** The identity (email address or domain) */
  identity: string;
  /** Current verification status */
  verificationStatus: IdentityVerificationStatus;
  /** Whether DKIM is enabled for this identity */
  dkimEnabled: boolean;
  /** DKIM verification status if enabled */
  dkimVerificationStatus: DkimVerificationStatus | null;
  /** When this status was last checked */
  checkedAt: Date;
}

/**
 * Internal message event for event-driven analytics
 * Tracks email lifecycle events from internal system perspective
 */
export interface MessageEvent {
  /** Type of event that occurred */
  eventType: AnalyticsEventType;
  /** SES message ID (available for SEND events) */
  messageId?: string;
  /** Reference to the contact in the contacts table */
  contactId: string;
  /** Reference to the send log entry */
  sendLogId: string;
  /** Flexible storage for event-specific data */
  eventData: Record<string, unknown>;
  /** When the event occurred in the real world */
  occurredAt: Date;
}

/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /** Whether analytics collection is enabled */
  enabled: boolean;
  /** How often to sync analytics data from SES APIs (in minutes) */
  syncIntervalMinutes: number;
  /** How long to retain analytics data (in days) */
  retentionDays: number;
}

/**
 * Options for analytics sync operations
 */
export interface SyncOptions {
  /** Start date for statistics fetch (defaults to 14 days ago) */
  startDate?: Date;
  /** End date for statistics fetch (defaults to now) */
  endDate?: Date;
  /** Force refresh even if cache is fresh */
  force?: boolean;
}

/**
 * Result of analytics sync operation
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean;
  /** Number of quota snapshots stored */
  quotaSnapshotsStored: number;
  /** Number of send statistics data points stored */
  sendStatisticsStored: number;
  /** Number of identity statuses stored */
  identityStatusesStored: number;
  /** Error message if sync failed */
  error?: string;
}
