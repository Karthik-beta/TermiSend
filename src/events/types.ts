/**
 * Domain Event Types for TermiSend
 * Type definitions for the internal event system
 *
 * This module defines all domain events that represent real business occurrences
 * in the TermiSend application, enabling loose coupling between components
 * and providing hooks for analytics and monitoring.
 */

// ============================================================================
// Domain Event Type Enum
// ============================================================================

/**
 * Enumeration of all domain event types in TermiSend
 * Each type represents a distinct business occurrence
 */
export enum DomainEventType {
  // Contact lifecycle events
  CONTACT_IMPORTED = 'CONTACT_IMPORTED',
  CONTACT_DUPLICATE_SKIPPED = 'CONTACT_DUPLICATE_SKIPPED',
  CONTACT_VERIFIED = 'CONTACT_VERIFIED',
  CONTACT_INVALID = 'CONTACT_INVALID',
  CONTACT_DEEMED_UNSAFE = 'CONTACT_DEEMED_UNSAFE',

  // Email sending events
  EMAIL_SEND_REQUESTED = 'EMAIL_SEND_REQUESTED',
  EMAIL_SENT = 'EMAIL_SENT',
  EMAIL_FAILED = 'EMAIL_FAILED',
  EMAIL_SKIPPED = 'EMAIL_SKIPPED',

  // API events
  SES_API_CALLED = 'SES_API_CALLED',
  VERIFIER_API_CALLED = 'VERIFIER_API_CALLED',

  // Quota and throttling events
  QUOTA_SNAPSHOT_RECORDED = 'QUOTA_SNAPSHOT_RECORDED',
  QUOTA_CHECK_PASSED = 'QUOTA_CHECK_PASSED',
  QUOTA_CHECK_FAILED = 'QUOTA_CHECK_FAILED',
  THROTTLE_DELAY_STARTED = 'THROTTLE_DELAY_STARTED',
  THROTTLE_DELAY_COMPLETED = 'THROTTLE_DELAY_COMPLETED',

  // Campaign events
  CAMPAIGN_STARTED = 'CAMPAIGN_STARTED',
  CAMPAIGN_COMPLETED = 'CAMPAIGN_COMPLETED',
  CAMPAIGN_PAUSED = 'CAMPAIGN_PAUSED',

  // SES lifecycle events
  SES_EVENT_RECEIVED = 'SES_EVENT_RECEIVED',
  SES_BOUNCE_PROCESSED = 'SES_BOUNCE_PROCESSED',
  SES_COMPLAINT_PROCESSED = 'SES_COMPLAINT_PROCESSED',
  SES_DELIVERY_CONFIRMED = 'SES_DELIVERY_CONFIRMED',
  SES_OPEN_RECORDED = 'SES_OPEN_RECORDED',
  SES_CLICK_RECORDED = 'SES_CLICK_RECORDED',

  // Contact suppression events
  CONTACT_SUPPRESSED = 'CONTACT_SUPPRESSED',
}

// ============================================================================
// Contact Lifecycle Event Payloads
// ============================================================================

/**
 * Payload for CONTACT_IMPORTED event
 * Emitted when a new contact is successfully imported from a file
 */
export interface ContactImportedPayload {
  /** Contact ID */
  contactId: string;
  /** Email address */
  email: string;
  /** Company name */
  companyName: string;
  /** Person name */
  personName: string;
  /** Source file path */
  sourceFile: string;
  /** Row number in source file */
  rowNumber: number;
}

/**
 * Payload for CONTACT_DUPLICATE_SKIPPED event
 * Emitted when a duplicate email is detected during import
 */
export interface ContactDuplicateSkippedPayload {
  /** Email that was duplicate */
  email: string;
  /** Source file path */
  sourceFile: string;
  /** Row number in source file */
  rowNumber: number;
  /** Reason for duplicate (database/file) */
  duplicateSource: 'database' | 'file';
}

/**
 * Payload for CONTACT_VERIFIED event
 * Emitted after email verification completes
 */
export interface ContactVerifiedPayload {
  /** Contact ID */
  contactId: string;
  /** Email address */
  email: string;
  /** Verification result */
  result: 'valid' | 'invalid' | 'unknown';
  /** Verification response details */
  details?: {
    isDisposable?: boolean;
    isFree?: boolean;
    domain?: string;
    mxRecord?: boolean;
  };
  /** API response time in milliseconds */
  responseTimeMs?: number;
}

/**
 * Payload for CONTACT_INVALID event
 * Emitted when an email fails format validation
 */
export interface ContactInvalidPayload {
  /** Contact ID */
  contactId: string;
  /** Email address */
  email: string;
  /** Reason for invalid status */
  reason: string;
  /** Validation error details */
  error?: string;
}

/**
 * Payload for CONTACT_DEEMED_UNSAFE event
 * Emitted when an email is flagged as unsafe by verification
 */
export interface ContactDeemedUnsafePayload {
  /** Contact ID */
  contactId: string;
  /** Email address */
  email: string;
  /** Reason for unsafe status */
  reason: string;
  /** Safety check details */
  details?: {
    isDisposable?: boolean;
    isFree?: boolean;
    otherFlags?: string[];
  };
}

// ============================================================================
// Email Sending Event Payloads
// ============================================================================

/**
 * Payload for EMAIL_SEND_REQUESTED event
 * Emitted when an email send is initiated
 */
export interface EmailSendRequestedPayload {
  /** Contact ID */
  contactId: string;
  /** Send log ID */
  sendLogId: string;
  /** Campaign ID (if applicable) */
  campaignId?: string;
  /** Email subject */
  subject: string;
  /** Send mode */
  mode: 'production' | 'test' | 'dry_run';
}

/**
 * Payload for EMAIL_SENT event
 * Emitted after successful email delivery via SES
 */
export interface EmailSentPayload {
  /** Contact ID */
  contactId: string;
  /** Send log ID */
  sendLogId: string;
  /** Campaign ID (if applicable) */
  campaignId?: string;
  /** SES message ID */
  messageId: string;
  /** Email subject */
  subject: string;
  /** Send mode */
  mode: 'production' | 'test' | 'dry_run';
  /** Time taken to send in milliseconds */
  sendTimeMs?: number;
}

/**
 * Type of failure for retry logic
 * - permanent: Never retry (config errors, invalid email, etc.)
 * - transient: Retry with delays (API errors, network timeouts, etc.)
 */
export type FailureType = 'permanent' | 'transient';

/**
 * Payload for EMAIL_FAILED event
 * Emitted when an email send attempt fails
 */
export interface EmailFailedPayload {
  /** Contact ID */
  contactId: string;
  /** Send log ID */
  sendLogId: string;
  /** Campaign ID (if applicable) */
  campaignId?: string;
  /** Error reason */
  errorReason: string;
  /** Error category */
  errorCategory: 'ses_error' | 'verification_error' | 'throttle_error' | 'other' | 'config_error';
  /** Retry attempt number */
  retryAttempt?: number;
  /** Type of failure - determines if retry should be attempted */
  failureType?: FailureType;
  /** If true, the campaign should be stopped (critical config errors) */
  stopCampaign?: boolean;
}

/**
 * Payload for EMAIL_SKIPPED event
 * Emitted when an email is skipped from sending
 */
export interface EmailSkippedPayload {
  /** Contact ID */
  contactId: string;
  /** Send log ID */
  sendLogId: string;
  /** Campaign ID (if applicable) */
  campaignId?: string;
  /** Reason for skipping */
  reason: string;
  /** Skip category */
  skipCategory: 'unsafe_email' | 'dry_run' | 'other';
}

// ============================================================================
// API Event Payloads
// ============================================================================

/**
 * Payload for SES_API_CALLED event
 * Emitted for each SES API call
 */
export interface SesApiCalledPayload {
  /** API endpoint name */
  apiEndpoint: 'SendEmail' | 'GetSendQuota' | 'GetSendStatistics' | 'ListIdentities';
  /** Request duration in milliseconds */
  durationMs: number;
  /** Success status */
  success: boolean;
  /** Error details if failed */
  error?: string;
  /** Request ID from AWS */
  requestId?: string;
}

/**
 * Payload for VERIFIER_API_CALLED event
 * Emitted for each email verifier API call
 */
export interface VerifierApiCalledPayload {
  /** Email being verified */
  email: string;
  /** Request duration in milliseconds */
  durationMs: number;
  /** Success status */
  success: boolean;
  /** Error details if failed */
  error?: string;
  /** Credits remaining after call */
  creditsRemaining?: number;
}

// ============================================================================
// Quota and Throttling Event Payloads
// ============================================================================

/**
 * Payload for QUOTA_CHECK_PASSED event
 * Emitted when quota check allows sending
 */
export interface QuotaCheckPassedPayload {
  /** Available quota */
  availableQuota: number;
  /** Required quota for send */
  requiredQuota: number;
  /** Buffer percentage used */
  bufferPercentage: number;
}

/**
 * Payload for QUOTA_CHECK_FAILED event
 * Emitted when quota check blocks sending
 */
export interface QuotaCheckFailedPayload {
  /** Available quota */
  availableQuota: number;
  /** Required quota for send */
  requiredQuota: number;
  /** Reason for failure */
  reason: 'insufficient_quota' | 'rate_limit_exceeded';
}

/**
 * Payload for THROTTLE_DELAY_STARTED event
 * Emitted when a throttling delay begins
 */
export interface ThrottleDelayStartedPayload {
  /** Delay duration in milliseconds */
  delayMs: number;
  /** Reason for delay */
  reason: 'rate_limit' | 'random_break';
  /** Contact ID being processed */
  contactId: string;
}

/**
 * Payload for THROTTLE_DELAY_COMPLETED event
 * Emitted when a throttling delay ends
 */
export interface ThrottleDelayCompletedPayload {
  /** Actual delay duration in milliseconds */
  actualDelayMs: number;
  /** Planned delay duration in milliseconds */
  plannedDelayMs: number;
  /** Contact ID that was processed */
  contactId: string;
}

// ============================================================================
// Campaign Event Payloads
// ============================================================================

/**
 * Payload for CAMPAIGN_STARTED event
 * Emitted when a campaign begins execution
 */
export interface CampaignStartedPayload {
  /** Campaign ID */
  campaignId?: string;
  /** Total contacts to process */
  totalContacts: number;
  /** Send mode */
  mode: 'production' | 'test' | 'dry_run';
  /** Template file path */
  templatePath: string;
}

/**
 * Payload for CAMPAIGN_COMPLETED event
 * Emitted when a campaign finishes execution
 */
export interface CampaignCompletedPayload {
  /** Campaign ID */
  campaignId?: string;
  /** Total contacts processed */
  totalContacts: number;
  /** Successfully sent */
  sentCount: number;
  /** Failed sends */
  failedCount: number;
  /** Skipped sends */
  skippedCount: number;
  /** Campaign duration in milliseconds */
  durationMs: number;
}

/**
 * Payload for CAMPAIGN_PAUSED event
 * Emitted when a campaign is paused
 */
export interface CampaignPausedPayload {
  /** Campaign ID */
  campaignId?: string;
  /** Reason for pause */
  reason: 'quota_exhausted' | 'manual' | 'error';
  /** Contacts processed so far */
  processedContacts: number;
  /** Remaining contacts */
  remainingContacts: number;
}

// ============================================================================
// SES Event Payloads
// ============================================================================

/**
 * Payload for SES_EVENT_RECEIVED event
 * Emitted when an SES event is received from SQS
 */
export interface SESEventReceivedPayload {
  eventId: string;
  eventType: string;
  messageId: string;
  recipientCount: number;
}

/**
 * Payload for SES_BOUNCE_PROCESSED event
 * Emitted when a bounce event is processed
 */
export interface SESBounceProcessedPayload {
  eventId: string;
  messageId: string;
  contactId: string;
  sendLogId: string;
  bounceType: 'Permanent' | 'Transient';
  bouncedRecipients: string[];
  suppressed: boolean;
}

/**
 * Payload for SES_COMPLAINT_PROCESSED event
 * Emitted when a complaint event is processed
 */
export interface SESComplaintProcessedPayload {
  eventId: string;
  messageId: string;
  contactId: string;
  sendLogId: string;
  complaintFeedbackType?: string;
  suppressed: boolean;
}

/**
 * Payload for SES_DELIVERY_CONFIRMED event
 * Emitted when a delivery is confirmed
 */
export interface SESDeliveryConfirmedPayload {
  eventId: string;
  messageId: string;
  contactId: string;
  sendLogId: string;
  deliveredRecipients: string[];
  processingTimeMs: number;
}

/**
 * Payload for SES_OPEN_RECORDED event
 * Emitted when an email open is recorded
 */
export interface SESOpenRecordedPayload {
  eventId: string;
  messageId: string;
  contactId: string;
  sendLogId: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Payload for SES_CLICK_RECORDED event
 * Emitted when an email link click is recorded
 */
export interface SESClickRecordedPayload {
  eventId: string;
  messageId: string;
  contactId: string;
  sendLogId: string;
  link: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Payload for CONTACT_SUPPRESSED event
 * Emitted when a contact is suppressed due to bounce/complaint
 */
export interface ContactSuppressedPayload {
  contactId: string;
  messageId: string;
  reason: string;
  suppressionType: 'bounce' | 'complaint' | 'manual';
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * Union type for all domain event payloads
 * Each event type has its own specific payload interface
 */
export type DomainEventPayload =
  | ContactImportedPayload
  | ContactDuplicateSkippedPayload
  | ContactVerifiedPayload
  | ContactInvalidPayload
  | ContactDeemedUnsafePayload
  | EmailSendRequestedPayload
  | EmailSentPayload
  | EmailFailedPayload
  | EmailSkippedPayload
  | SesApiCalledPayload
  | VerifierApiCalledPayload
  | QuotaCheckPassedPayload
  | QuotaCheckFailedPayload
  | ThrottleDelayStartedPayload
  | ThrottleDelayCompletedPayload
  | CampaignStartedPayload
  | CampaignCompletedPayload
  | CampaignPausedPayload
  | SESEventReceivedPayload
  | SESBounceProcessedPayload
  | SESComplaintProcessedPayload
  | SESDeliveryConfirmedPayload
  | SESOpenRecordedPayload
  | SESClickRecordedPayload
  | ContactSuppressedPayload;

// ============================================================================
// Domain Event Interface
// ============================================================================

/**
 * Base interface for all domain events
 * Ensures consistent structure across all event types
 */
export interface DomainEvent<T extends DomainEventPayload = DomainEventPayload> {
  /** Type of event */
  type: DomainEventType;
  /** Unique identifier for this specific event occurrence */
  eventId: string;
  /** Timestamp when event occurred */
  timestamp: Date;
  /** Optional correlation ID for event chains */
  correlationId?: string;
  /** Event-specific payload */
  payload: T;
}

// ============================================================================
// Event Handler Types
// ============================================================================

/**
 * Handler function type for domain events
 */
export type DomainEventHandler = (event: DomainEvent) => void;
