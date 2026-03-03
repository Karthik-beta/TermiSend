/**
 * Event Handlers for Aggregated Metrics
 *
 * This module provides event handlers that subscribe to domain events
 * and update aggregated metrics tables for analytics.
 *
 * Handlers use a fire-and-forget pattern with error isolation to ensure
 * analytics failures don't affect business operations.
 */

import { logger } from '../logger.js';
import {
  flushSendOutcomeMetrics,
  flushSesApiMetrics,
  flushThrottlingMetrics,
  flushVerificationMetrics,
} from './repository.js';
import {
  type ContactInvalidPayload,
  type ContactVerifiedPayload,
  type DomainEvent,
  DomainEventType,
  type EmailFailedPayload,
  type EmailSentPayload,
  type EmailSkippedPayload,
  type QuotaCheckFailedPayload,
  type QuotaCheckPassedPayload,
  type SesApiCalledPayload,
  type ThrottleDelayCompletedPayload,
  type ThrottleDelayStartedPayload,
  type VerifierApiCalledPayload,
} from './types.js';

// ============================================================================
// Accumulator State (Safe for single-user CLI with sequential execution)
// ============================================================================

/**
 * Accumulator for verification metrics
 */
const verificationAccumulator = {
  totalVerified: 0,
  validEmails: 0,
  invalidEmails: 0,
  unknownEmails: 0,
  apiCalls: 0,
  responseTimeSum: 0,
  responseTimeCount: 0,
};

/**
 * Accumulator for send outcome metrics
 * Keyed by "date:campaignId" string
 */
const sendOutcomeAccumulators = new Map<
  string,
  {
    totalRequested: number;
    successfullySent: number;
    failedSends: number;
    skippedSends: number;
    sesApiCalls: number;
  }
>();

/**
 * Accumulator for SES API metrics
 * Keyed by "date:apiEndpoint" string
 */
const sesApiAccumulators = new Map<
  string,
  {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    responseTimeSum: number;
    responseTimeCount: number;
  }
>();

/**
 * Accumulator for throttling metrics
 */
const throttlingAccumulator = {
  totalDelays: 0,
  totalDelayTimeMs: 0,
  quotaChecksPassed: 0,
  quotaChecksFailed: 0,
};

// ============================================================================
// Flush Scheduling (Debounced to batch writes)
// ============================================================================

let verificationFlushTimeout: ReturnType<typeof setTimeout> | null = null;
const sendOutcomeFlushTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const sesApiFlushTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
let throttlingFlushTimeout: ReturnType<typeof setTimeout> | null = null;

const FLUSH_DELAY_MS = 1000; // 1 second debounce

/**
 * Schedule a flush of verification metrics
 */
function scheduleVerificationFlush(dateStr: string): void {
  if (verificationFlushTimeout) {
    clearTimeout(verificationFlushTimeout);
  }
  verificationFlushTimeout = setTimeout(() => {
    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for metrics flush
    void flushVerificationMetrics(dateStr, { ...verificationAccumulator }).catch(() => {
      /* error already logged in repository */
    });
    // Reset accumulator after flush
    verificationAccumulator.totalVerified = 0;
    verificationAccumulator.validEmails = 0;
    verificationAccumulator.invalidEmails = 0;
    verificationAccumulator.unknownEmails = 0;
    verificationAccumulator.apiCalls = 0;
    verificationAccumulator.responseTimeSum = 0;
    verificationAccumulator.responseTimeCount = 0;
  }, FLUSH_DELAY_MS);
}

/**
 * Schedule a flush of send outcome metrics
 */
function scheduleSendOutcomeFlush(dateStr: string, campaignId: string | null): void {
  const key = `${dateStr}:${campaignId ?? 'null'}`;
  const existingTimeout = sendOutcomeFlushTimeouts.get(key);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(() => {
    const accumulator = sendOutcomeAccumulators.get(key);
    if (accumulator) {
      // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for metrics flush
      void flushSendOutcomeMetrics(dateStr, campaignId, { ...accumulator }).catch(() => {
        /* error already logged in repository */
      });
      sendOutcomeAccumulators.delete(key);
    }
    sendOutcomeFlushTimeouts.delete(key);
  }, FLUSH_DELAY_MS);

  sendOutcomeFlushTimeouts.set(key, timeout);
}

/**
 * Schedule a flush of SES API metrics
 */
function scheduleSesApiFlush(dateStr: string, apiEndpoint: string): void {
  const key = `${dateStr}:${apiEndpoint}`;
  const existingTimeout = sesApiFlushTimeouts.get(key);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(() => {
    const accumulator = sesApiAccumulators.get(key);
    if (accumulator) {
      // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for metrics flush
      void flushSesApiMetrics(dateStr, apiEndpoint, { ...accumulator }).catch(() => {
        /* error already logged in repository */
      });
      sesApiAccumulators.delete(key);
    }
    sesApiFlushTimeouts.delete(key);
  }, FLUSH_DELAY_MS);

  sesApiFlushTimeouts.set(key, timeout);
}

/**
 * Schedule a flush of throttling metrics
 */
function scheduleThrottlingFlush(dateStr: string): void {
  if (throttlingFlushTimeout) {
    clearTimeout(throttlingFlushTimeout);
  }
  throttlingFlushTimeout = setTimeout(() => {
    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for metrics flush
    void flushThrottlingMetrics(dateStr, { ...throttlingAccumulator }).catch(() => {
      /* error already logged in repository */
    });
    // Reset accumulator after flush
    throttlingAccumulator.totalDelays = 0;
    throttlingAccumulator.totalDelayTimeMs = 0;
    throttlingAccumulator.quotaChecksPassed = 0;
    throttlingAccumulator.quotaChecksFailed = 0;
  }, FLUSH_DELAY_MS);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get today's date string in YYYY-MM-DD format
 */
function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// Verification Event Handler
// ============================================================================

/**
 * Handle verification-related events
 * Accumulates metrics and flushes periodically
 */
export function handleVerificationEvent(
  event: DomainEvent<ContactVerifiedPayload | ContactInvalidPayload | VerifierApiCalledPayload>
): void {
  try {
    const today = getTodayString();

    switch (event.type) {
      case DomainEventType.CONTACT_VERIFIED: {
        const payload = event.payload as ContactVerifiedPayload;
        const isInvalid = payload.result === 'invalid';
        const isUnknown = payload.result === 'unknown';

        // Accumulate metrics
        verificationAccumulator.totalVerified += 1;
        if (isInvalid) {
          verificationAccumulator.invalidEmails += 1;
        } else if (isUnknown) {
          verificationAccumulator.unknownEmails += 1;
        } else {
          verificationAccumulator.validEmails += 1;
        }
        if (payload.responseTimeMs && payload.responseTimeMs > 0) {
          verificationAccumulator.responseTimeSum += payload.responseTimeMs;
          verificationAccumulator.responseTimeCount += 1;
        }

        scheduleVerificationFlush(today);
        break;
      }

      case DomainEventType.CONTACT_INVALID: {
        // Accumulate metrics
        verificationAccumulator.invalidEmails += 1;
        scheduleVerificationFlush(today);
        break;
      }

      case DomainEventType.VERIFIER_API_CALLED: {
        const payload = event.payload as VerifierApiCalledPayload;

        // Accumulate metrics
        verificationAccumulator.apiCalls += 1;
        if (payload.durationMs && payload.durationMs > 0) {
          verificationAccumulator.responseTimeSum += payload.durationMs;
          verificationAccumulator.responseTimeCount += 1;
        }

        scheduleVerificationFlush(today);
        break;
      }
    }
  } catch (error) {
    // Error isolation - log but don't throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for error logging
    void logger.logError(
      'Failed to handle verification event',
      error instanceof Error ? error : errorMessage,
      {
        eventType: event.type,
        eventId: event.eventId,
      }
    );
  }
}

// ============================================================================
// Send Outcome Event Handler
// ============================================================================

/**
 * Handle send outcome events
 * Accumulates metrics and flushes periodically
 */
export function handleSendOutcomeEvent(
  event: DomainEvent<EmailSentPayload | EmailFailedPayload | EmailSkippedPayload>
): void {
  try {
    const today = getTodayString();
    let campaignId: string | null = null;

    // Extract campaign ID from payload
    if ('campaignId' in event.payload && event.payload.campaignId) {
      campaignId = event.payload.campaignId;
    }

    const key = `${today}:${campaignId ?? 'null'}`;

    // Get or create accumulator for this date:campaign combination
    if (!sendOutcomeAccumulators.has(key)) {
      sendOutcomeAccumulators.set(key, {
        totalRequested: 0,
        successfullySent: 0,
        failedSends: 0,
        skippedSends: 0,
        sesApiCalls: 0,
      });
    }
    const accumulator = sendOutcomeAccumulators.get(key);
    if (!accumulator) {
      throw new Error(`Send outcome accumulator not found for key: ${key}`);
    }

    switch (event.type) {
      case DomainEventType.EMAIL_SENT: {
        accumulator.totalRequested += 1;
        accumulator.successfullySent += 1;
        accumulator.sesApiCalls += 1;
        scheduleSendOutcomeFlush(today, campaignId);
        break;
      }

      case DomainEventType.EMAIL_FAILED: {
        accumulator.totalRequested += 1;
        accumulator.failedSends += 1;
        scheduleSendOutcomeFlush(today, campaignId);
        break;
      }

      case DomainEventType.EMAIL_SKIPPED: {
        accumulator.totalRequested += 1;
        accumulator.skippedSends += 1;
        scheduleSendOutcomeFlush(today, campaignId);
        break;
      }
    }
  } catch (error) {
    // Error isolation - log but don't throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for error logging
    void logger.logError(
      'Failed to handle send outcome event',
      error instanceof Error ? error : errorMessage,
      {
        eventType: event.type,
        eventId: event.eventId,
      }
    );
  }
}

// ============================================================================
// SES API Event Handler
// ============================================================================

/**
 * Handle SES API call events
 * Accumulates metrics and flushes periodically
 */
export function handleSesApiEvent(event: DomainEvent<SesApiCalledPayload>): void {
  try {
    const today = getTodayString();
    const payload = event.payload;
    const key = `${today}:${payload.apiEndpoint}`;

    // Get or create accumulator for this date:endpoint combination
    if (!sesApiAccumulators.has(key)) {
      sesApiAccumulators.set(key, {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        responseTimeSum: 0,
        responseTimeCount: 0,
      });
    }
    const accumulator = sesApiAccumulators.get(key);
    if (!accumulator) {
      throw new Error(`SES API accumulator not found for key: ${key}`);
    }

    // Accumulate metrics
    accumulator.totalCalls += 1;
    if (payload.success) {
      accumulator.successfulCalls += 1;
    } else {
      accumulator.failedCalls += 1;
    }
    if (payload.durationMs && payload.durationMs > 0) {
      accumulator.responseTimeSum += payload.durationMs;
      accumulator.responseTimeCount += 1;
    }

    scheduleSesApiFlush(today, payload.apiEndpoint);
  } catch (error) {
    // Error isolation - log but don't throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for error logging
    void logger.logError(
      'Failed to handle SES API event',
      error instanceof Error ? error : errorMessage,
      {
        eventType: event.type,
        eventId: event.eventId,
      }
    );
  }
}

// ============================================================================
// Throttling Event Handler
// ============================================================================

/**
 * Handle throttling events
 * Accumulates metrics and flushes periodically
 */
export function handleThrottlingEvent(
  event: DomainEvent<
    | ThrottleDelayStartedPayload
    | ThrottleDelayCompletedPayload
    | QuotaCheckPassedPayload
    | QuotaCheckFailedPayload
  >
): void {
  try {
    const today = getTodayString();

    switch (event.type) {
      case DomainEventType.THROTTLE_DELAY_STARTED: {
        // Just track that a delay started - no metrics update until completed
        // This prevents orphaned delay metrics if the process crashes
        break;
      }

      case DomainEventType.THROTTLE_DELAY_COMPLETED: {
        const payload = event.payload as ThrottleDelayCompletedPayload;

        // Accumulate metrics
        throttlingAccumulator.totalDelays += 1;
        throttlingAccumulator.totalDelayTimeMs += payload.actualDelayMs;

        scheduleThrottlingFlush(today);
        break;
      }

      case DomainEventType.QUOTA_CHECK_PASSED: {
        throttlingAccumulator.quotaChecksPassed += 1;
        scheduleThrottlingFlush(today);
        break;
      }

      case DomainEventType.QUOTA_CHECK_FAILED: {
        throttlingAccumulator.quotaChecksFailed += 1;
        scheduleThrottlingFlush(today);
        break;
      }
    }
  } catch (error) {
    // Error isolation - log but don't throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for error logging
    void logger.logError(
      'Failed to handle throttling event',
      error instanceof Error ? error : errorMessage,
      {
        eventType: event.type,
        eventId: event.eventId,
      }
    );
  }
}

// ============================================================================
// Handler Registration Functions
// ============================================================================

/**
 * Register all verification event handlers
 * Call this during application startup
 */
export function registerVerificationHandlers(emitters: {
  on: (type: DomainEventType, handler: (event: DomainEvent) => void) => void;
}): void {
  emitters.on(
    DomainEventType.CONTACT_VERIFIED,
    handleVerificationEvent as (event: DomainEvent) => void
  );
  emitters.on(
    DomainEventType.CONTACT_INVALID,
    handleVerificationEvent as (event: DomainEvent) => void
  );
  emitters.on(
    DomainEventType.VERIFIER_API_CALLED,
    handleVerificationEvent as (event: DomainEvent) => void
  );
}

/**
 * Register all send outcome event handlers
 * Call this during application startup
 */
export function registerSendOutcomeHandlers(emitters: {
  on: (type: DomainEventType, handler: (event: DomainEvent) => void) => void;
}): void {
  emitters.on(DomainEventType.EMAIL_SENT, handleSendOutcomeEvent as (event: DomainEvent) => void);
  emitters.on(DomainEventType.EMAIL_FAILED, handleSendOutcomeEvent as (event: DomainEvent) => void);
  emitters.on(
    DomainEventType.EMAIL_SKIPPED,
    handleSendOutcomeEvent as (event: DomainEvent) => void
  );
}

/**
 * Register all SES API event handlers
 * Call this during application startup
 */
export function registerSesApiHandlers(emitters: {
  on: (type: DomainEventType, handler: (event: DomainEvent) => void) => void;
}): void {
  emitters.on(DomainEventType.SES_API_CALLED, handleSesApiEvent as (event: DomainEvent) => void);
}

/**
 * Register all throttling event handlers
 * Call this during application startup
 */
export function registerThrottlingHandlers(emitters: {
  on: (type: DomainEventType, handler: (event: DomainEvent) => void) => void;
}): void {
  emitters.on(
    DomainEventType.THROTTLE_DELAY_STARTED,
    handleThrottlingEvent as (event: DomainEvent) => void
  );
  emitters.on(
    DomainEventType.THROTTLE_DELAY_COMPLETED,
    handleThrottlingEvent as (event: DomainEvent) => void
  );
  emitters.on(
    DomainEventType.QUOTA_CHECK_PASSED,
    handleThrottlingEvent as (event: DomainEvent) => void
  );
  emitters.on(
    DomainEventType.QUOTA_CHECK_FAILED,
    handleThrottlingEvent as (event: DomainEvent) => void
  );
}

/**
 * Register all analytics event handlers
 * Convenience function to register all handlers at once
 */
export function registerAllAnalyticsHandlers(emitters: {
  on: (type: DomainEventType, handler: (event: DomainEvent) => void) => void;
}): void {
  registerVerificationHandlers(emitters);
  registerSendOutcomeHandlers(emitters);
  registerSesApiHandlers(emitters);
  registerThrottlingHandlers(emitters);
}
