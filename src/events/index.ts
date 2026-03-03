/**
 * Domain Events Module for TermiSend
 * Central export point for all event-related types and utilities
 *
 * This module provides:
 * - DomainEventType enum for all event types
 * - DomainEvent interface and payload types
 * - DomainEventEmitter singleton for event handling
 * - Utility functions for event creation
 *
 * Usage:
 * ```typescript
 * import {
 *   DomainEventType,
 *   domainEvents,
 *   createEvent,
 *   type ContactImportedPayload,
 *   type DomainEvent
 * } from './events/index.js';
 *
 * // Create and emit an event
 * const event = createEvent(DomainEventType.CONTACT_IMPORTED, {
 *   contactId: '123',
 *   email: 'test@example.com',
 *   companyName: 'Acme Corp',
 *   personName: 'John Doe',
 *   sourceFile: '/path/to/contacts.xlsx',
 *   rowNumber: 5
 * });
 * domainEvents.emit(event);
 *
 * // Subscribe to events
 * domainEvents.on(DomainEventType.EMAIL_SENT, (event) => {
 *   console.log('Email sent:', event.payload);
 * });
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

// Base event interface and handler type
// Contact lifecycle event payloads
// Email sending event payloads
// API event payloads
// Quota and throttling event payloads
// Campaign event payloads
export type {
  CampaignCompletedPayload,
  CampaignPausedPayload,
  CampaignStartedPayload,
  ContactDeemedUnsafePayload,
  ContactDuplicateSkippedPayload,
  ContactImportedPayload,
  ContactInvalidPayload,
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
  QuotaSnapshotRecordedPayload,
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
export type {
  AnalyticsEventRecord,
  SendOutcomeMetricRecord,
  SesApiMetricRecord,
  ThrottlingMetricRecord,
  VerificationMetricRecord,
} from './repository.js';
// Repository functions for analytics persistence and querying
export {
  getEventsByContactId,
  getEventsByCorrelationId,
  getEventsByDateRange,
  // Event querying
  getEventsByType,
  getSesApiMetric,
  getThrottlingMetric,
  // Metrics querying
  getVerificationMetric,
  // Event persistence
  saveEvent,
  saveSendOutcomeMetric,
  saveSesApiMetric,
  saveThrottlingMetric,
  // Metrics persistence
  saveVerificationMetric,
} from './repository.js';

// ============================================================================
// Handler Exports
// ============================================================================

export {
  handleSendOutcomeEvent,
  handleSesApiEvent,
  handleThrottlingEvent,
  // Individual handlers
  handleVerificationEvent,
  registerAllAnalyticsHandlers,
  registerSendOutcomeHandlers,
  registerSesApiHandlers,
  registerThrottlingHandlers,
  // Registration functions
  registerVerificationHandlers,
} from './handlers.js';
