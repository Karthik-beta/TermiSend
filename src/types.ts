/**
 * Type definitions for TermiSend
 * Central type definitions for database entities, API responses, and function parameters
 */

// ============================================================================
// Database Entity Types
// ============================================================================

import type { DomainEventPayload } from './events/types.js';

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
 * Analytics event record as stored in the database
 */
export interface AnalyticsEventRecord {
  id: string;
  eventType: string;
  eventId: string;
  correlationId: string | null;
  contactId: string | null;
  sendLogId: string | null;
  campaignId: string | null;
  payload: DomainEventPayload;
  occurredAt: Date;
  createdAt: Date;
}

/**
 * Send log status values
 * Tracks the outcome of each send attempt
 */
export type LogStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'skipped'
  | 'delivered'
  | 'bounced'
  | 'complained';

/**
 * Send mode for campaign execution
 */
export type SendMode = 'production' | 'test' | 'dry_run';

// ============================================================================
// Failure Classification Types for Retry Logic
// ============================================================================

/**
 * Type of failure - determines retry behavior
 * - permanent: Never retry (config errors, invalid email, etc.)
 * - transient: Retry with delays (API errors, network timeouts, etc.)
 */
export type FailureType = 'permanent' | 'transient';

/**
 * Classification of a failure for retry logic
 */
export interface FailureClassification {
  /** Type of failure */
  type: FailureType;
  /** Whether this failure should be retried */
  retryable: boolean;
  /** If true, stop the entire campaign (for critical config errors) */
  stopCampaign?: boolean;
}

/** Maximum number of retry attempts for transient failures */
export const MAX_RETRIES = 2;

/** Delay in milliseconds for retry attempts */
export const RETRY_DELAYS = {
  /** First retry: wait 2 seconds */
  1: 2000,
  /** Second retry: wait 5 seconds */
  2: 5000,
} as const;

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
  retryCount: number; // Number of retry attempts (0 = first attempt)
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

// ============================================================================
// SES Event Types (SQS Consumer)
// ============================================================================

/**
 * SES event type identifiers
 */
export type SESEventType =
  | 'Bounce'
  | 'Complaint'
  | 'Delivery'
  | 'Open'
  | 'Click'
  | 'Send'
  | 'Reject'
  | 'RenderingFailure';

/**
 * SNS notification message structure
 * Wraps SES events published through SNS to SQS
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-message-and-json-formats.html
 */
export interface SNSNotification {
  /** Message type (typically 'Notification') */
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  /** SNS message ID */
  MessageId: string;
  /** ARN of the topic that published the message */
  TopicArn: string;
  /** Subject of the notification (if set) */
  Subject?: string;
  /** JSON-encoded SES event payload */
  Message: string;
  /** Timestamp of the notification */
  Timestamp: string;
  /** Signature version used for verification */
  SignatureVersion: string;
  /** Signature for message verification */
  Signature: string;
  /** Certificate URL for signature verification */
  SigningCertURL: string;
  /** Unsubscribe URL (not used in this context) */
  UnsubscribeURL?: string;
}

/**
 * Email header structure
 */
export interface SESHeader {
  name: string;
  value: string;
}

/**
 * Common headers extracted from email
 */
export interface SESCommonHeaders {
  from?: string[];
  to?: string[];
  messageId?: string;
  subject?: string;
  date?: string;
}

/**
 * Common mail data present in all SES events
 */
export interface SESMailData {
  /** Timestamp when the message was sent */
  timestamp: string;
  /** SES message ID (maps to send_logs.message_id) */
  messageId: string;
  /** Source email address */
  source: string;
  /** Source ARN (if sending through configuration set) */
  sourceArn?: string;
  /** Sending account ID */
  sendingAccountId: string;
  /** Recipients of the message */
  destination: string[];
  /** Headers from the message */
  headers?: SESHeader[];
  /** Common headers extracted for convenience */
  commonHeaders?: SESCommonHeaders;
}

/**
 * Bounced recipient details
 */
export interface SESBouncedRecipient {
  /** Email address that bounced */
  emailAddress: string;
  /** Bounce action (failed, delayed, etc.) */
  action?: string;
  /** Status code from remote MTA */
  status?: string;
  /** Diagnostic code explaining the bounce */
  diagnosticCode?: string;
}

/**
 * Bounce event data
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html#event-publishing-retrieving-sns-contents-bounce
 */
export interface SESBounceData {
  /** Bounce type: 'Permanent' or 'Transient' */
  bounceType: 'Permanent' | 'Transient';
  /** Bounce subtype providing additional detail */
  bounceSubType: string;
  /** Array of bounced recipients */
  bouncedRecipients: SESBouncedRecipient[];
  /** Timestamp of bounce */
  timestamp: string;
  /** Feedback ID from remote MTA */
  feedbackId: string;
  /** Reporting MTA */
  reportingMTA?: string;
}

/**
 * Complained recipient details
 */
export interface SESComplainedRecipient {
  /** Email address that complained */
  emailAddress: string;
}

/**
 * Complaint event data
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html#event-publishing-retrieving-sns-contents-complaint
 */
export interface SESComplaintData {
  /** Complaint feedback type */
  complaintFeedbackType?: 'abuse' | 'auth-failure' | 'fraud' | 'not-spam' | 'other' | 'virus';
  /** Array of recipients who complained */
  complainedRecipients: SESComplainedRecipient[];
  /** Timestamp of complaint */
  timestamp: string;
  /** Feedback ID from ISP */
  feedbackId: string;
  /** User agent string from complaint */
  userAgent?: string;
  /** Original mail that caused complaint */
  arrivalDate?: string;
}

/**
 * Delivery event data
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html#event-publishing-retrieving-sns-contents-delivery
 */
export interface SESDeliveryData {
  /** Timestamp of delivery */
  timestamp: string;
  /** Time in milliseconds to process delivery */
  processingTimeMillis: number;
  /** Recipients who were delivered to */
  recipients: string[];
  /** SMTP response from remote MTA */
  smtpResponse: string;
  /** Reporting MTA */
  reportingMTA?: string;
}

/**
 * Open event data
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html#event-publishing-retrieving-sns-contents-open
 */
export interface SESOpenData {
  /** IP address of opener */
  ipAddress: string;
  /** Timestamp of open event */
  timestamp: string;
  /** User agent of email client */
  userAgent: string;
}

/**
 * Click event data
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html#event-publishing-retrieving-sns-contents-click
 */
export interface SESClickData {
  /** IP address of clicker */
  ipAddress: string;
  /** Timestamp of click event */
  timestamp: string;
  /** User agent of email client */
  userAgent: string;
  /** Link that was clicked */
  link: string;
  /** Link tags from tracking */
  linkTags?: Record<string, string[]>;
}

/**
 * Send event data
 */
export interface SESSendData {
  /** Indicates successful sending */
  success: boolean;
}

/**
 * Reject event data
 */
export interface SESRejectData {
  /** Reason for rejection */
  reason: string;
}

/**
 * Failure event data
 */
export interface SESFailureData {
  /** Error message */
  errorMessage: string;
  /** Error type */
  errorType: string;
}

/**
 * SES event record structure within SNS message
 * Contains the actual SES event data after JSON parsing
 */
export interface SESEventRecord {
  /** Event type identifier */
  eventType: SESEventType;
  /** Event timestamp in ISO 8601 format */
  eventTime: string;
  /** Email sending details */
  mail: SESMailData;
  /** Event-specific details (bounce, complaint, delivery, etc.) */
  bounce?: SESBounceData;
  complaint?: SESComplaintData;
  delivery?: SESDeliveryData;
  open?: SESOpenData;
  click?: SESClickData;
  send?: SESSendData;
  reject?: SESRejectData;
  failure?: SESFailureData;
}

/**
 * Parsed SES event with extracted data
 */
export interface ParsedSESEvent {
  /** Unique event ID (derived from SNS MessageId) */
  eventId: string;
  /** Event type */
  eventType: SESEventType;
  /** When the event occurred */
  timestamp: Date;
  /** SES message ID (maps to send_logs) */
  messageId: string;
  /** Recipient email addresses */
  recipients: string[];
  /** Sender email address */
  source: string;
  /** Event-specific data */
  data:
    | SESBounceData
    | SESComplaintData
    | SESDeliveryData
    | SESOpenData
    | SESClickData
    | SESSendData
    | SESRejectData
    | SESFailureData;
  /** Original full event record */
  rawEvent: SESEventRecord;
}

/**
 * SQS Consumer configuration options
 */
export interface SQSConsumerConfig {
  /** SQS queue URL to poll */
  queueUrl: string;
  /** AWS region */
  region: string;
  /** AWS credentials */
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  /** Polling interval in milliseconds (default: 10000) */
  pollingIntervalMs: number;
  /** Maximum number of messages to receive per poll (1-10, default: 10) */
  maxMessagesPerPoll: number;
  /** Visibility timeout in seconds (default: 300) */
  visibilityTimeoutSeconds: number;
  /** Wait time for long polling in seconds (0-20, default: 20) */
  waitTimeSeconds: number;
  /** Maximum receive attempts before sending to DLQ (default: 3) */
  maxReceiveCount: number;
  /** Whether to delete messages immediately after processing (default: true) */
  autoDelete: boolean;
  /** Whether to enable debug logging (default: false) */
  debugLogging: boolean;
}

/**
 * SQS message wrapper structure
 */
export interface SQSMessage {
  /** SQS message ID */
  messageId: string;
  /** Receipt handle for deletion/visibility */
  receiptHandle: string;
  /** Message body (JSON string containing SNS notification) */
  body: string;
  /** Message attributes */
  attributes?: Record<string, string>;
  /** Custom message attributes */
  messageAttributes?: Record<string, { stringValue?: string; dataType: string }>;
  /** Number of times this message has been received */
  receiveCount?: number;
  /** First receive timestamp */
  sentTimestamp?: string;
}

/**
 * SQS consumer status
 */
export interface SQSConsumerStatus {
  /** Whether consumer is currently running */
  isRunning: boolean;
  /** Number of messages processed */
  messagesProcessed: number;
  /** Number of messages failed */
  messagesFailed: number;
  /** Last poll timestamp */
  lastPollAt?: Date;
  /** Last error message */
  lastError?: string;
  /** Current number of in-flight messages */
  inFlightCount: number;
}

/**
 * Event processing result
 */
export interface EventProcessingResult {
  /** Whether processing was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** IDs of affected contacts */
  affectedContactIds: string[];
  /** IDs of updated send logs */
  updatedSendLogIds: string[];
}

// ============================================================================
// Periodic Analytics Types
// ============================================================================

/**
 * Aggregated statistics for a specific time period
 */
export interface PeriodicStats {
  period: 'daily' | 'weekly' | 'monthly';
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  totalOpens: number;
  totalClicks: number;
  failed: number;
  verified: number;
  invalid: number;
  bounced: number;
  hardBounced: number;
  softBounced: number;
  complained: number;
  averageDeliveryTimeMs: number;
}

/**
 * Comprehensive periodic analytics data
 */
export interface PeriodicAnalytics {
  daily: PeriodicStats;
  weekly: PeriodicStats;
  monthly: PeriodicStats;
}
