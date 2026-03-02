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
