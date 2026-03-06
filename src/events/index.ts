/**
 * Domain Events Module for TermiSend
 * Central export point for all event-related types and utilities
 *
 * This module provides:
 * - DomainEventType enum for all event types
 * - DomainEvent interface and payload types
 * - DomainEventEmitter singleton for event handling
 * - Utility functions for event creation
 * - Repository functions for event querying
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  CampaignCompletedPayload,
  CampaignPausedPayload,
  CampaignStartedPayload,
  ContactDeemedUnsafePayload,
  ContactDuplicateSkippedPayload,
  ContactImportedPayload,
  ContactInvalidPayload,
  ContactSuppressedPayload,
  ContactVerifiedPayload,
  DomainEvent,
  DomainEventHandler,
  DomainEventPayload,
  EmailFailedPayload,
  EmailSendRequestedPayload,
  EmailSentPayload,
  EmailSkippedPayload,
  QuotaCheckFailedPayload,
  QuotaCheckPassedPayload,
  SESBounceProcessedPayload,
  SESClickRecordedPayload,
  SESComplaintProcessedPayload,
  SESDeliveryConfirmedPayload,
  SESEventReceivedPayload,
  SESOpenRecordedPayload,
  SesApiCalledPayload,
  ThrottleDelayCompletedPayload,
  ThrottleDelayStartedPayload,
  VerifierApiCalledPayload,
} from './types.js';
// Event type enum
export { DomainEventType } from './types.js';

// ============================================================================
// Emitter Exports
// ============================================================================

export {
  createEvent,
  createEventWithCorrelation,
  DomainEventEmitter,
  domainEvents,
  generateCorrelationId,
  generateEventId,
} from './emitter.js';

// ============================================================================
// Repository Exports
// ============================================================================

// Repository type exports
export type { AnalyticsEventRecord } from '../types.js';
// Repository functions for analytics querying
export {
  getEventsByContactId,
  getEventsByCorrelationId,
  getEventsByDateRange,
  getEventsByType,
  saveEvent,
} from './repository.js';
