/**
 * Analytics Repository for TermiSend
 * Handles persistence and querying of analytics events and metrics
 *
 * This module provides functions to:
 * - Save events to the analytics_events table
 * - Save aggregated metrics to specialized tables
 * - Query events by type and correlation ID
 *
 * All functions use parameterized queries to prevent SQL injection
 * and handle errors gracefully without throwing.
 */

import { sql } from '../db.js';
import { logger } from '../logger.js';
import type { DomainEvent, DomainEventPayload } from './types.js';

// ============================================================================
// Type Definitions
// ============================================================================

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
 * Verification metrics record
 */
export interface VerificationMetricRecord {
  id: string;
  date: Date;
  totalVerified: number;
  validEmails: number;
  invalidEmails: number;
  unknownEmails: number;
  averageResponseTimeMs: number | null;
  apiCalls: number;
  createdAt: Date;
}

/**
 * Send outcome metrics record
 */
export interface SendOutcomeMetricRecord {
  id: string;
  date: Date;
  campaignId: string | null;
  totalRequested: number;
  successfullySent: number;
  failedSends: number;
  skippedSends: number;
  averageSendTimeMs: number | null;
  sesApiCalls: number;
  createdAt: Date;
}

/**
 * SES API metrics record
 */
export interface SesApiMetricRecord {
  id: string;
  date: Date;
  apiEndpoint: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageResponseTimeMs: number | null;
  createdAt: Date;
}

/**
 * Throttling metrics record
 */
export interface ThrottlingMetricRecord {
  id: string;
  date: Date;
  totalDelays: number;
  totalDelayTimeMs: number;
  averageDelayMs: number | null;
  quotaChecksPassed: number;
  quotaChecksFailed: number;
  createdAt: Date;
}

// ============================================================================
// Event Persistence
// ============================================================================

/**
 * Save an event to the analytics_events table
 * Uses fire-and-forget pattern - errors are logged but not thrown
 *
 * @param event - Domain event to save
 * @returns Promise that resolves when the event is saved (or logs error on failure)
 */
export async function saveEvent(event: DomainEvent): Promise<void> {
  try {
    // Extract optional IDs from payload
    const contactId = extractContactId(event.payload);
    const sendLogId = extractSendLogId(event.payload);
    const campaignId = extractCampaignId(event.payload);

    await sql`
      INSERT INTO analytics_events (
        event_type,
        event_id,
        correlation_id,
        contact_id,
        send_log_id,
        campaign_id,
        payload,
        occurred_at
      ) VALUES (
        ${event.type},
        ${event.eventId},
        ${event.correlationId || null},
        ${contactId || null},
        ${sendLogId || null},
        ${campaignId || null},
        ${JSON.stringify(event.payload)},
        ${event.timestamp}
      )
    `;
  } catch (error) {
    // Log error but don't throw - analytics failures should not affect business operations
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to save analytics event',
      error instanceof Error ? error : errorMessage,
      {
        eventType: event.type,
        eventId: event.eventId,
      }
    );
  }
}

/**
 * Extract contact ID from event payload if present
 */
function extractContactId(payload: DomainEventPayload): string | null {
  if ('contactId' in payload && typeof payload.contactId === 'string') {
    return payload.contactId;
  }
  return null;
}

/**
 * Extract send log ID from event payload if present
 */
function extractSendLogId(payload: DomainEventPayload): string | null {
  if ('sendLogId' in payload && typeof payload.sendLogId === 'string') {
    return payload.sendLogId;
  }
  return null;
}

/**
 * Extract campaign ID from event payload if present
 */
function extractCampaignId(payload: DomainEventPayload): string | null {
  if ('campaignId' in payload && typeof payload.campaignId === 'string') {
    return payload.campaignId;
  }
  return null;
}

// ============================================================================
// Metrics Persistence
// ============================================================================

/**
 * Save or update verification metrics for a specific date
 * Uses upsert (ON CONFLICT DO UPDATE) for idempotency
 *
 * @param date - Date for the metrics
 * @param metrics - Metrics data to save
 */
export async function saveVerificationMetric(
  date: Date,
  metrics: {
    totalVerified: number;
    validEmails: number;
    invalidEmails: number;
    unknownEmails: number;
    averageResponseTimeMs: number | null;
    apiCalls: number;
  }
): Promise<void> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    await sql`
      INSERT INTO verification_metrics (
        date, total_verified, valid_emails, invalid_emails, 
        unknown_emails, average_response_time_ms, api_calls
      ) VALUES (
        ${dateStr},
        ${metrics.totalVerified},
        ${metrics.validEmails},
        ${metrics.invalidEmails},
        ${metrics.unknownEmails},
        ${metrics.averageResponseTimeMs},
        ${metrics.apiCalls}
      )
      ON CONFLICT (date) DO UPDATE SET
        total_verified = EXCLUDED.total_verified,
        valid_emails = EXCLUDED.valid_emails,
        invalid_emails = EXCLUDED.invalid_emails,
        unknown_emails = EXCLUDED.unknown_emails,
        average_response_time_ms = EXCLUDED.average_response_time_ms,
        api_calls = EXCLUDED.api_calls
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to save verification metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
      }
    );
  }
}

/**
 * Save or update send outcome metrics for a specific date and campaign
 * Uses upsert (ON CONFLICT DO UPDATE) for idempotency
 *
 * @param date - Date for the metrics
 * @param metrics - Metrics data to save
 */
export async function saveSendOutcomeMetric(
  date: Date,
  metrics: {
    campaignId: string | null;
    totalRequested: number;
    successfullySent: number;
    failedSends: number;
    skippedSends: number;
    averageSendTimeMs: number | null;
    sesApiCalls: number;
  }
): Promise<void> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    await sql`
      INSERT INTO send_outcome_metrics (
        date, campaign_id, total_requested, successfully_sent,
        failed_sends, skipped_sends, average_send_time_ms, ses_api_calls
      ) VALUES (
        ${dateStr},
        ${metrics.campaignId || null},
        ${metrics.totalRequested},
        ${metrics.successfullySent},
        ${metrics.failedSends},
        ${metrics.skippedSends},
        ${metrics.averageSendTimeMs},
        ${metrics.sesApiCalls}
      )
      ON CONFLICT (date, campaign_id) DO UPDATE SET
        total_requested = EXCLUDED.total_requested,
        successfully_sent = EXCLUDED.successfully_sent,
        failed_sends = EXCLUDED.failed_sends,
        skipped_sends = EXCLUDED.skipped_sends,
        average_send_time_ms = EXCLUDED.average_send_time_ms,
        ses_api_calls = EXCLUDED.ses_api_calls
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to save send outcome metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
        campaignId: metrics.campaignId,
      }
    );
  }
}

/**
 * Save or update SES API metrics for a specific date and endpoint
 * Uses upsert (ON CONFLICT DO UPDATE) for idempotency
 *
 * @param date - Date for the metrics
 * @param metrics - Metrics data to save
 */
export async function saveSesApiMetric(
  date: Date,
  metrics: {
    apiEndpoint: string;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageResponseTimeMs: number | null;
  }
): Promise<void> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    await sql`
      INSERT INTO ses_api_metrics (
        date, api_endpoint, total_calls, successful_calls,
        failed_calls, average_response_time_ms
      ) VALUES (
        ${dateStr},
        ${metrics.apiEndpoint},
        ${metrics.totalCalls},
        ${metrics.successfulCalls},
        ${metrics.failedCalls},
        ${metrics.averageResponseTimeMs}
      )
      ON CONFLICT (date, api_endpoint) DO UPDATE SET
        total_calls = EXCLUDED.total_calls,
        successful_calls = EXCLUDED.successful_calls,
        failed_calls = EXCLUDED.failed_calls,
        average_response_time_ms = EXCLUDED.average_response_time_ms
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to save SES API metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
        apiEndpoint: metrics.apiEndpoint,
      }
    );
  }
}

/**
 * Save or update throttling metrics for a specific date
 * Uses upsert (ON CONFLICT DO UPDATE) for idempotency
 *
 * @param date - Date for the metrics
 * @param metrics - Metrics data to save
 */
export async function saveThrottlingMetric(
  date: Date,
  metrics: {
    totalDelays: number;
    totalDelayTimeMs: number;
    averageDelayMs: number | null;
    quotaChecksPassed: number;
    quotaChecksFailed: number;
  }
): Promise<void> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    await sql`
      INSERT INTO throttling_metrics (
        date, total_delays, total_delay_time_ms, average_delay_ms,
        quota_checks_passed, quota_checks_failed
      ) VALUES (
        ${dateStr},
        ${metrics.totalDelays},
        ${metrics.totalDelayTimeMs},
        ${metrics.averageDelayMs},
        ${metrics.quotaChecksPassed},
        ${metrics.quotaChecksFailed}
      )
      ON CONFLICT (date) DO UPDATE SET
        total_delays = EXCLUDED.total_delays,
        total_delay_time_ms = EXCLUDED.total_delay_time_ms,
        average_delay_ms = EXCLUDED.average_delay_ms,
        quota_checks_passed = EXCLUDED.quota_checks_passed,
        quota_checks_failed = EXCLUDED.quota_checks_failed
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to save throttling metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
      }
    );
  }
}

// ============================================================================
// Flush Functions (For Module-Level Accumulators)
// ============================================================================
// These functions flush accumulated metrics to the database using atomic
// SQL increment operations. They are designed to be called periodically by
// the event handlers after accumulating metrics in memory.
// For a single-user CLI tool with sequential execution, this is safe and
// more efficient than per-event database writes.

/**
 * Flush accumulated verification metrics to the database
 * Uses atomic SQL increment to add accumulated values to existing metrics
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param accumulated - Accumulated metrics to flush
 */
export async function flushVerificationMetrics(
  dateStr: string,
  accumulated: {
    totalVerified: number;
    validEmails: number;
    invalidEmails: number;
    unknownEmails: number;
    apiCalls: number;
    responseTimeSum: number;
    responseTimeCount: number;
  }
): Promise<void> {
  // Skip if nothing to flush
  if (
    accumulated.totalVerified === 0 &&
    accumulated.validEmails === 0 &&
    accumulated.invalidEmails === 0 &&
    accumulated.unknownEmails === 0 &&
    accumulated.apiCalls === 0
  ) {
    return;
  }

  try {
    const avgResponseTimeMs =
      accumulated.responseTimeCount > 0
        ? Math.round(accumulated.responseTimeSum / accumulated.responseTimeCount)
        : null;

    await sql`
      INSERT INTO verification_metrics (
        date, total_verified, valid_emails, invalid_emails,
        unknown_emails, api_calls, average_response_time_ms
      ) VALUES (
        ${dateStr},
        ${accumulated.totalVerified},
        ${accumulated.validEmails},
        ${accumulated.invalidEmails},
        ${accumulated.unknownEmails},
        ${accumulated.apiCalls},
        ${avgResponseTimeMs}
      )
      ON CONFLICT (date) DO UPDATE SET
        total_verified = verification_metrics.total_verified + EXCLUDED.total_verified,
        valid_emails = verification_metrics.valid_emails + EXCLUDED.valid_emails,
        invalid_emails = verification_metrics.invalid_emails + EXCLUDED.invalid_emails,
        unknown_emails = verification_metrics.unknown_emails + EXCLUDED.unknown_emails,
        api_calls = verification_metrics.api_calls + EXCLUDED.api_calls,
        average_response_time_ms = CASE
          WHEN EXCLUDED.average_response_time_ms IS NOT NULL THEN EXCLUDED.average_response_time_ms
          ELSE verification_metrics.average_response_time_ms
        END
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to flush verification metrics',
      error instanceof Error ? error : errorMessage,
      { date: dateStr }
    );
  }
}

/**
 * Flush accumulated send outcome metrics to the database
 * Uses atomic SQL increment to add accumulated values to existing metrics
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param campaignId - Campaign ID (null for no campaign)
 * @param accumulated - Accumulated metrics to flush
 */
export async function flushSendOutcomeMetrics(
  dateStr: string,
  campaignId: string | null,
  accumulated: {
    totalRequested: number;
    successfullySent: number;
    failedSends: number;
    skippedSends: number;
    sesApiCalls: number;
  }
): Promise<void> {
  // Skip if nothing to flush
  if (
    accumulated.totalRequested === 0 &&
    accumulated.successfullySent === 0 &&
    accumulated.failedSends === 0 &&
    accumulated.skippedSends === 0 &&
    accumulated.sesApiCalls === 0
  ) {
    return;
  }

  try {
    await sql`
      INSERT INTO send_outcome_metrics (
        date, campaign_id, total_requested, successfully_sent,
        failed_sends, skipped_sends, ses_api_calls
      ) VALUES (
        ${dateStr},
        ${campaignId || null},
        ${accumulated.totalRequested},
        ${accumulated.successfullySent},
        ${accumulated.failedSends},
        ${accumulated.skippedSends},
        ${accumulated.sesApiCalls}
      )
      ON CONFLICT (date, campaign_id) DO UPDATE SET
        total_requested = send_outcome_metrics.total_requested + EXCLUDED.total_requested,
        successfully_sent = send_outcome_metrics.successfully_sent + EXCLUDED.successfully_sent,
        failed_sends = send_outcome_metrics.failed_sends + EXCLUDED.failed_sends,
        skipped_sends = send_outcome_metrics.skipped_sends + EXCLUDED.skipped_sends,
        ses_api_calls = send_outcome_metrics.ses_api_calls + EXCLUDED.ses_api_calls
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to flush send outcome metrics',
      error instanceof Error ? error : errorMessage,
      { date: dateStr, campaignId }
    );
  }
}

/**
 * Flush accumulated SES API metrics to the database
 * Uses atomic SQL increment to add accumulated values to existing metrics
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param apiEndpoint - API endpoint name
 * @param accumulated - Accumulated metrics to flush
 */
export async function flushSesApiMetrics(
  dateStr: string,
  apiEndpoint: string,
  accumulated: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    responseTimeSum: number;
    responseTimeCount: number;
  }
): Promise<void> {
  // Skip if nothing to flush
  if (
    accumulated.totalCalls === 0 &&
    accumulated.successfulCalls === 0 &&
    accumulated.failedCalls === 0
  ) {
    return;
  }

  try {
    const avgResponseTimeMs =
      accumulated.responseTimeCount > 0
        ? Math.round(accumulated.responseTimeSum / accumulated.responseTimeCount)
        : null;

    await sql`
      INSERT INTO ses_api_metrics (
        date, api_endpoint, total_calls, successful_calls,
        failed_calls, average_response_time_ms
      ) VALUES (
        ${dateStr},
        ${apiEndpoint},
        ${accumulated.totalCalls},
        ${accumulated.successfulCalls},
        ${accumulated.failedCalls},
        ${avgResponseTimeMs}
      )
      ON CONFLICT (date, api_endpoint) DO UPDATE SET
        total_calls = ses_api_metrics.total_calls + EXCLUDED.total_calls,
        successful_calls = ses_api_metrics.successful_calls + EXCLUDED.successful_calls,
        failed_calls = ses_api_metrics.failed_calls + EXCLUDED.failed_calls,
        average_response_time_ms = CASE
          WHEN EXCLUDED.average_response_time_ms IS NOT NULL THEN EXCLUDED.average_response_time_ms
          ELSE ses_api_metrics.average_response_time_ms
        END
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to flush SES API metrics',
      error instanceof Error ? error : errorMessage,
      { date: dateStr, apiEndpoint }
    );
  }
}

/**
 * Flush accumulated throttling metrics to the database
 * Uses atomic SQL increment to add accumulated values to existing metrics
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param accumulated - Accumulated metrics to flush
 */
export async function flushThrottlingMetrics(
  dateStr: string,
  accumulated: {
    totalDelays: number;
    totalDelayTimeMs: number;
    quotaChecksPassed: number;
    quotaChecksFailed: number;
  }
): Promise<void> {
  // Skip if nothing to flush
  if (
    accumulated.totalDelays === 0 &&
    accumulated.quotaChecksPassed === 0 &&
    accumulated.quotaChecksFailed === 0
  ) {
    return;
  }

  try {
    await sql`
      INSERT INTO throttling_metrics (
        date, total_delays, total_delay_time_ms, quota_checks_passed, quota_checks_failed
      ) VALUES (
        ${dateStr},
        ${accumulated.totalDelays},
        ${accumulated.totalDelayTimeMs},
        ${accumulated.quotaChecksPassed},
        ${accumulated.quotaChecksFailed}
      )
      ON CONFLICT (date) DO UPDATE SET
        total_delays = throttling_metrics.total_delays + EXCLUDED.total_delays,
        total_delay_time_ms = throttling_metrics.total_delay_time_ms + EXCLUDED.total_delay_time_ms,
        quota_checks_passed = throttling_metrics.quota_checks_passed + EXCLUDED.quota_checks_passed,
        quota_checks_failed = throttling_metrics.quota_checks_failed + EXCLUDED.quota_checks_failed,
        average_delay_ms = CASE
          WHEN (throttling_metrics.total_delays + EXCLUDED.total_delays) > 0
          THEN ROUND((throttling_metrics.total_delay_time_ms + EXCLUDED.total_delay_time_ms)::numeric / (throttling_metrics.total_delays + EXCLUDED.total_delays))
          ELSE NULL
        END
    `;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to flush throttling metrics',
      error instanceof Error ? error : errorMessage,
      { date: dateStr }
    );
  }
}

// ============================================================================
// Event Querying
// ============================================================================

/**
 * Get events by type
 * Returns events matching the specified event type, ordered by occurrence time
 *
 * @param eventType - Event type to filter by
 * @param limit - Maximum number of events to return (default: 100)
 * @returns Array of analytics event records
 */
export async function getEventsByType(
  eventType: string,
  limit: number = 100
): Promise<AnalyticsEventRecord[]> {
  try {
    const results = await sql<AnalyticsEventRecord[]>`
      SELECT 
        id,
        event_type as "eventType",
        event_id as "eventId",
        correlation_id as "correlationId",
        contact_id as "contactId",
        send_log_id as "sendLogId",
        campaign_id as "campaignId",
        payload,
        occurred_at as "occurredAt",
        created_at as "createdAt"
      FROM analytics_events
      WHERE event_type = ${eventType}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query events by type',
      error instanceof Error ? error : errorMessage,
      {
        eventType,
      }
    );
    return [];
  }
}

/**
 * Get events by correlation ID
 * Returns all events in a correlation chain, ordered by occurrence time
 *
 * @param correlationId - Correlation ID to filter by
 * @returns Array of analytics event records
 */
export async function getEventsByCorrelationId(
  correlationId: string
): Promise<AnalyticsEventRecord[]> {
  try {
    const results = await sql<AnalyticsEventRecord[]>`
      SELECT 
        id,
        event_type as "eventType",
        event_id as "eventId",
        correlation_id as "correlationId",
        contact_id as "contactId",
        send_log_id as "sendLogId",
        campaign_id as "campaignId",
        payload,
        occurred_at as "occurredAt",
        created_at as "createdAt"
      FROM analytics_events
      WHERE correlation_id = ${correlationId}
      ORDER BY occurred_at ASC
    `;
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query events by correlation ID',
      error instanceof Error ? error : errorMessage,
      {
        correlationId,
      }
    );
    return [];
  }
}

/**
 * Get events by contact ID
 * Returns all events related to a specific contact
 *
 * @param contactId - Contact ID to filter by
 * @param limit - Maximum number of events to return (default: 100)
 * @returns Array of analytics event records
 */
export async function getEventsByContactId(
  contactId: string,
  limit: number = 100
): Promise<AnalyticsEventRecord[]> {
  try {
    const results = await sql<AnalyticsEventRecord[]>`
      SELECT 
        id,
        event_type as "eventType",
        event_id as "eventId",
        correlation_id as "correlationId",
        contact_id as "contactId",
        send_log_id as "sendLogId",
        campaign_id as "campaignId",
        payload,
        occurred_at as "occurredAt",
        created_at as "createdAt"
      FROM analytics_events
      WHERE contact_id = ${contactId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query events by contact ID',
      error instanceof Error ? error : errorMessage,
      {
        contactId,
      }
    );
    return [];
  }
}

/**
 * Get events within a date range
 * Returns events that occurred within the specified time range
 *
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @param limit - Maximum number of events to return (default: 1000)
 * @returns Array of analytics event records
 */
export async function getEventsByDateRange(
  startDate: Date,
  endDate: Date,
  limit: number = 1000
): Promise<AnalyticsEventRecord[]> {
  try {
    const results = await sql<AnalyticsEventRecord[]>`
      SELECT 
        id,
        event_type as "eventType",
        event_id as "eventId",
        correlation_id as "correlationId",
        contact_id as "contactId",
        send_log_id as "sendLogId",
        campaign_id as "campaignId",
        payload,
        occurred_at as "occurredAt",
        created_at as "createdAt"
      FROM analytics_events
      WHERE occurred_at >= ${startDate} AND occurred_at <= ${endDate}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query events by date range',
      error instanceof Error ? error : errorMessage,
      {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }
    );
    return [];
  }
}

// ============================================================================
// Metrics Querying
// ============================================================================

/**
 * Get verification metrics for a specific date
 *
 * @param date - Date to query
 * @returns Verification metric record or null if not found
 */
export async function getVerificationMetric(date: Date): Promise<VerificationMetricRecord | null> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    const [result] = await sql<VerificationMetricRecord[]>`
      SELECT 
        id,
        date,
        total_verified as "totalVerified",
        valid_emails as "validEmails",
        invalid_emails as "invalidEmails",
        unknown_emails as "unknownEmails",
        average_response_time_ms as "averageResponseTimeMs",
        api_calls as "apiCalls",
        created_at as "createdAt"
      FROM verification_metrics
      WHERE date = ${dateStr}
    `;
    return result || null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query verification metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
      }
    );
    return null;
  }
}

/**
 * Get SES API metrics for a specific date and endpoint
 *
 * @param date - Date to query
 * @param apiEndpoint - API endpoint to filter by
 * @returns SES API metric record or null if not found
 */
export async function getSesApiMetric(
  date: Date,
  apiEndpoint: string
): Promise<SesApiMetricRecord | null> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    const [result] = await sql<SesApiMetricRecord[]>`
      SELECT 
        id,
        date,
        api_endpoint as "apiEndpoint",
        total_calls as "totalCalls",
        successful_calls as "successfulCalls",
        failed_calls as "failedCalls",
        average_response_time_ms as "averageResponseTimeMs",
        created_at as "createdAt"
      FROM ses_api_metrics
      WHERE date = ${dateStr} AND api_endpoint = ${apiEndpoint}
    `;
    return result || null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query SES API metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
        apiEndpoint,
      }
    );
    return null;
  }
}

/**
 * Get throttling metrics for a specific date
 *
 * @param date - Date to query
 * @returns Throttling metric record or null if not found
 */
export async function getThrottlingMetric(date: Date): Promise<ThrottlingMetricRecord | null> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    const [result] = await sql<ThrottlingMetricRecord[]>`
      SELECT 
        id,
        date,
        total_delays as "totalDelays",
        total_delay_time_ms as "totalDelayTimeMs",
        average_delay_ms as "averageDelayMs",
        quota_checks_passed as "quotaChecksPassed",
        quota_checks_failed as "quotaChecksFailed",
        created_at as "createdAt"
      FROM throttling_metrics
      WHERE date = ${dateStr}
    `;
    return result || null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError(
      'Failed to query throttling metric',
      error instanceof Error ? error : errorMessage,
      {
        date: date.toISOString(),
      }
    );
    return null;
  }
}
