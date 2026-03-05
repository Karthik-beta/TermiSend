/**
 * Analytics Repository for TermiSend
 * Handles persistence and querying of analytics events
 *
 * This module provides functions to:
 * - Save events to the analytics_events table
 * - Query events by type, correlation ID, contact ID, and date range
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
