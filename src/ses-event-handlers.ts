/**
 * SES Event Handlers Module for TermiSend
 * Processes SES events by type and updates database/event bus
 */

import {
  confirmSendLogDelivery,
  createSESEventTracking,
  getSendLogByMessageId,
  recordAnalyticsEvent,
  recordEngagementEvent,
  suppressContact,
  updateSendLogBounced,
  updateSendLogComplained,
} from './db.js';
import { emitAnalyticsEvent } from './events/bus.js';
import { createEvent, DomainEventType } from './events/index.js';
import { logger } from './logger.js';
import type {
  EventProcessingResult,
  ParsedSESEvent,
  SESBounceData,
  SESClickData,
  SESComplaintData,
  SESDeliveryData,
  SESDeliveryDelayData,
  SESOpenData,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum size for event data storage (100KB) */
const MAX_EVENT_DATA_SIZE = 100000;

async function persistAnalyticsEvent(event: {
  type: string;
  payload: object;
  timestamp: Date;
}): Promise<void> {
  const payload = event.payload as Record<string, unknown>;

  await recordAnalyticsEvent({
    eventType: event.type,
    payload,
    contactId: typeof payload.contactId === 'string' ? payload.contactId : undefined,
    sendLogId: typeof payload.sendLogId === 'string' ? payload.sendLogId : undefined,
    campaignId: typeof payload.campaignId === 'string' ? payload.campaignId : undefined,
    occurredAt: event.timestamp,
  });
}

type ResolvedSendLog = Awaited<ReturnType<typeof getSendLogByMessageId>>;

async function resolveSendLogForEvent(event: ParsedSESEvent): Promise<ResolvedSendLog> {
  switch (event.eventType) {
    case 'Bounce':
    case 'Complaint':
    case 'Delivery':
    case 'DeliveryDelay':
    case 'Open':
    case 'Click':
      return await getSendLogByMessageId(event.messageId);
    default:
      return null;
  }
}

// ============================================================================
// Main Event Router
// ============================================================================

/**
 * Main entry point: Process a parsed SES event
 * Routes to appropriate handler based on event type
 * @param event - Parsed SES event
 * @returns Processing result with affected records
 */
export async function processSESEvent(event: ParsedSESEvent): Promise<EventProcessingResult> {
  const startTime = Date.now();
  let resolvedSendLog: ResolvedSendLog = null;

  logger
    .info(`Processing SES event: ${event.eventType} for message ${event.messageId}`)
    .catch((e) => console.error('Log failed:', e));

  // Emit event received notification
  await persistAnalyticsEvent(
    createEvent(DomainEventType.SES_EVENT_RECEIVED, {
      eventId: event.eventId,
      eventType: event.eventType,
      messageId: event.messageId,
      recipientCount: event.recipients.length,
    })
  );

  // Create SES event tracking record (best effort - don't fail on tracking errors)
  try {
    resolvedSendLog = await resolveSendLogForEvent(event);

    // Validate event data size to prevent database bloat
    const rawEventData = event.rawEvent as unknown as Record<string, unknown>;
    const eventDataSize = Buffer.byteLength(JSON.stringify(rawEventData), 'utf8');

    let eventDataToStore: Record<string, unknown>;
    if (eventDataSize > MAX_EVENT_DATA_SIZE) {
      logger
        .warn(
          `SES event data exceeds size limit (${eventDataSize} bytes), storing truncated version`
        )
        .catch((e) => console.error('Log failed:', e));
      eventDataToStore = {
        eventType: event.rawEvent.eventType,
        eventTime: event.rawEvent.eventTime,
        mail: {
          messageId: event.rawEvent.mail.messageId,
          source: event.rawEvent.mail.source,
          destination: event.rawEvent.mail.destination,
          timestamp: event.rawEvent.mail.timestamp,
        },
        truncated: true,
        originalSize: eventDataSize,
      };
    } else {
      eventDataToStore = rawEventData;
    }

    await createSESEventTracking({
      eventType: event.eventType,
      snsMessageId: event.eventId,
      sesMessageId: event.messageId,
      contactId: resolvedSendLog?.contactId,
      sendLogId: resolvedSendLog?.id,
      recipientEmail: event.recipients.length > 0 ? event.recipients[0] : event.source,
      sourceEmail: event.source,
      eventData: eventDataToStore,
      occurredAt: event.timestamp,
    });
  } catch (err) {
    logger
      .warn(
        `Failed to record SES event tracking: ${err instanceof Error ? err.message : String(err)}`
      )
      .catch((e) => console.error('Log failed:', e));
  }

  let result: EventProcessingResult;

  try {
    switch (event.eventType) {
      case 'Bounce':
        result = await handleBounceEvent(
          event as ParsedSESEvent & { data: SESBounceData },
          resolvedSendLog
        );
        break;
      case 'Complaint':
        result = await handleComplaintEvent(
          event as ParsedSESEvent & { data: SESComplaintData },
          resolvedSendLog
        );
        break;
      case 'Delivery':
        result = await handleDeliveryEvent(
          event as ParsedSESEvent & { data: SESDeliveryData },
          resolvedSendLog
        );
        break;
      case 'DeliveryDelay':
        result = await handleDeliveryDelayEvent(
          event as ParsedSESEvent & { data: SESDeliveryDelayData },
          resolvedSendLog
        );
        break;
      case 'Open':
        result = await handleOpenEvent(
          event as ParsedSESEvent & { data: SESOpenData },
          resolvedSendLog
        );
        break;
      case 'Click':
        result = await handleClickEvent(
          event as ParsedSESEvent & { data: SESClickData },
          resolvedSendLog
        );
        break;
      case 'Send':
        result = await handleSendEvent(event);
        break;
      case 'Reject':
      case 'RenderingFailure':
        // Log these events but don't require special handling
        logger
          .info(`SES ${event.eventType} event received for ${event.messageId}`)
          .catch((e) => console.error('Log failed:', e));
        result = {
          success: true,
          affectedContactIds: [],
          updatedSendLogIds: [],
        };
        break;
      default:
        result = {
          success: false,
          error: `Unsupported event type: ${(event as ParsedSESEvent).eventType}`,
          affectedContactIds: [],
          updatedSendLogIds: [],
        };
    }

    const duration = Date.now() - startTime;
    logger
      .info(`SES event processed in ${duration}ms: ${event.eventType}`)
      .catch((e) => console.error('Log failed:', e));

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to process SES event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds: [],
      updatedSendLogIds: [],
    };
  }
}

// ============================================================================
// Event Type Handlers
// ============================================================================

/**
 * Handle bounce event
 * Updates send_logs status, optionally suppresses contact for hard bounces
 * @param event - Parsed SES event with bounce data
 * @returns Processing result
 */
export async function handleBounceEvent(
  event: ParsedSESEvent & { data: SESBounceData },
  preloadedSendLog: ResolvedSendLog = null
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    const sendLog = preloadedSendLog || (await getSendLogByMessageId(event.messageId));

    if (!sendLog) {
      logger
        .warn(`Send log not found for message ID: ${event.messageId}`)
        .catch((e) => console.error('Log failed:', e));
      return {
        success: true, // Don't fail, just log
        affectedContactIds,
        updatedSendLogIds,
      };
    }

    updatedSendLogIds.push(sendLog.id);

    // Update send log with bounce status
    await updateSendLogBounced(
      sendLog.id,
      event.data.bounceType,
      event.data as unknown as Record<string, unknown>
    );

    const suppressionEmail = sendLog.email || event.recipients[0];
    const suppressionReason = `Bounce: ${event.data.bounceType} / ${event.data.bounceSubType}`;
    await suppressContact(sendLog.contactId, suppressionEmail, suppressionReason, 'bounce');
    affectedContactIds.push(sendLog.contactId);
    const suppressed = true;

    await persistAnalyticsEvent(
      createEvent(DomainEventType.CONTACT_SUPPRESSED, {
        contactId: sendLog.contactId,
        email: suppressionEmail,
        messageId: event.messageId,
        reason: suppressionReason,
        suppressionType: 'bounce',
      })
    );

    emitAnalyticsEvent({
      type: 'contact:suppressed',
      contactId: sendLog.contactId,
      email: suppressionEmail,
      reason: suppressionReason,
      suppressionType: 'bounce',
      messageId: event.messageId,
    });

    // Emit bounce processed event
    await persistAnalyticsEvent(
      createEvent(DomainEventType.SES_BOUNCE_PROCESSED, {
        eventId: event.eventId,
        messageId: event.messageId,
        contactId: sendLog.contactId,
        sendLogId: sendLog.id,
        bounceType: event.data.bounceType,
        bouncedRecipients: event.data.bouncedRecipients.map((r) => r.emailAddress),
        suppressed,
      })
    );

    // Emit analytics event
    emitAnalyticsEvent({
      type: 'email:bounced',
      contactId: sendLog.contactId,
      messageId: event.messageId,
      bounceType: event.data.bounceType,
    });

    return {
      success: true,
      affectedContactIds,
      updatedSendLogIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to handle bounce event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds,
      updatedSendLogIds,
    };
  }
}

/**
 * Handle complaint event
 * Suppresses contact from future sends
 * @param event - Parsed SES event with complaint data
 * @returns Processing result
 */
export async function handleComplaintEvent(
  event: ParsedSESEvent & { data: SESComplaintData },
  preloadedSendLog: ResolvedSendLog = null
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    const sendLog = preloadedSendLog || (await getSendLogByMessageId(event.messageId));

    if (!sendLog) {
      logger
        .warn(`Send log not found for message ID: ${event.messageId}`)
        .catch((e) => console.error('Log failed:', e));
      return {
        success: true, // Don't fail, just log
        affectedContactIds,
        updatedSendLogIds,
      };
    }

    updatedSendLogIds.push(sendLog.id);

    // Update send log with complaint status
    await updateSendLogComplained(sendLog.id, event.data as unknown as Record<string, unknown>);

    // Suppress contact (all complaints should suppress)
    const suppressionEmail = sendLog.email || event.recipients[0];
    await suppressContact(
      sendLog.contactId,
      suppressionEmail,
      `Complaint: ${event.data.complaintFeedbackType || 'unknown'}`,
      'complaint'
    );
    affectedContactIds.push(sendLog.contactId);

    // Emit contact suppressed event
    await persistAnalyticsEvent(
      createEvent(DomainEventType.CONTACT_SUPPRESSED, {
        contactId: sendLog.contactId,
        email: suppressionEmail,
        messageId: event.messageId,
        reason: `Complaint: ${event.data.complaintFeedbackType || 'unknown'}`,
        suppressionType: 'complaint',
      })
    );

    // Emit complaint processed event
    await persistAnalyticsEvent(
      createEvent(DomainEventType.SES_COMPLAINT_PROCESSED, {
        eventId: event.eventId,
        messageId: event.messageId,
        contactId: sendLog.contactId,
        sendLogId: sendLog.id,
        complaintFeedbackType: event.data.complaintFeedbackType,
        suppressed: true,
      })
    );

    // Emit analytics events
    emitAnalyticsEvent({
      type: 'contact:suppressed',
      contactId: sendLog.contactId,
      email: suppressionEmail,
      reason: `Complaint: ${event.data.complaintFeedbackType || 'unknown'}`,
      suppressionType: 'complaint',
      messageId: event.messageId,
    });

    emitAnalyticsEvent({
      type: 'email:complained',
      contactId: sendLog.contactId,
      messageId: event.messageId,
    });

    return {
      success: true,
      affectedContactIds,
      updatedSendLogIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to handle complaint event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds,
      updatedSendLogIds,
    };
  }
}

/**
 * Handle delivery event
 * Updates send_logs status to confirmed delivered
 * @param event - Parsed SES event with delivery data
 * @returns Processing result
 */
export async function handleDeliveryEvent(
  event: ParsedSESEvent & { data: SESDeliveryData },
  preloadedSendLog: ResolvedSendLog = null
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    const sendLog = preloadedSendLog || (await getSendLogByMessageId(event.messageId));

    if (!sendLog) {
      logger
        .warn(`Send log not found for message ID: ${event.messageId}`)
        .catch((e) => console.error('Log failed:', e));
      return {
        success: true, // Don't fail, just log
        affectedContactIds,
        updatedSendLogIds,
      };
    }

    updatedSendLogIds.push(sendLog.id);
    affectedContactIds.push(sendLog.contactId);

    // Update send log with delivery confirmation
    await confirmSendLogDelivery(sendLog.id, new Date(event.data.timestamp));

    // Emit delivery confirmed event
    await persistAnalyticsEvent(
      createEvent(DomainEventType.SES_DELIVERY_CONFIRMED, {
        eventId: event.eventId,
        messageId: event.messageId,
        contactId: sendLog.contactId,
        sendLogId: sendLog.id,
        deliveredRecipients: event.data.recipients,
        processingTimeMs: event.data.processingTimeMillis,
      })
    );

    // Emit analytics event
    emitAnalyticsEvent({
      type: 'email:delivered',
      contactId: sendLog.contactId,
      messageId: event.messageId,
    });

    return {
      success: true,
      affectedContactIds,
      updatedSendLogIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to handle delivery event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds,
      updatedSendLogIds,
    };
  }
}

/**
 * Handle delivery delay event
 * Tracks the delay without changing terminal send state because SES may still deliver later.
 * @param event - Parsed SES event with delivery delay data
 * @returns Processing result
 */
export async function handleDeliveryDelayEvent(
  event: ParsedSESEvent & { data: SESDeliveryDelayData },
  preloadedSendLog: ResolvedSendLog = null
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    const sendLog = preloadedSendLog || (await getSendLogByMessageId(event.messageId));

    if (!sendLog) {
      logger
        .warn(`Send log not found for delayed message ID: ${event.messageId}`)
        .catch((e) => console.error('Log failed:', e));
      return {
        success: true,
        affectedContactIds,
        updatedSendLogIds,
      };
    }

    logger
      .info(
        `Delivery delay recorded for ${event.messageId}: ${event.data.delayType || 'unknown delay'}`
      )
      .catch((e) => console.error('Log failed:', e));

    return {
      success: true,
      affectedContactIds,
      updatedSendLogIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to handle delivery delay event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds,
      updatedSendLogIds,
    };
  }
}

/**
 * Handle open event
 * Records open event for analytics
 * @param event - Parsed SES event with open data
 * @returns Processing result
 */
export async function handleOpenEvent(
  event: ParsedSESEvent & { data: SESOpenData },
  preloadedSendLog: ResolvedSendLog = null
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    const sendLog = preloadedSendLog || (await getSendLogByMessageId(event.messageId));

    if (!sendLog) {
      logger
        .warn(`Send log not found for message ID: ${event.messageId}`)
        .catch((e) => console.error('Log failed:', e));
      return {
        success: true, // Don't fail, just log
        affectedContactIds,
        updatedSendLogIds,
      };
    }

    updatedSendLogIds.push(sendLog.id);
    affectedContactIds.push(sendLog.contactId);

    const openTime = new Date(event.data.timestamp);

    // Record the open once through the engagement helper so counts and
    // first-open timestamps stay in sync without double incrementing.
    await recordEngagementEvent(sendLog.id, sendLog.contactId, 'open', {
      timestamp: openTime,
      ipAddress: event.data.ipAddress,
      userAgent: event.data.userAgent,
    });

    // Emit open recorded event
    await persistAnalyticsEvent(
      createEvent(DomainEventType.SES_OPEN_RECORDED, {
        eventId: event.eventId,
        messageId: event.messageId,
        contactId: sendLog.contactId,
        sendLogId: sendLog.id,
        ipAddress: event.data.ipAddress,
        userAgent: event.data.userAgent,
      })
    );

    // Emit analytics event
    emitAnalyticsEvent({
      type: 'email:opened',
      contactId: sendLog.contactId,
      messageId: event.messageId,
    });

    return {
      success: true,
      affectedContactIds,
      updatedSendLogIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to handle open event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds,
      updatedSendLogIds,
    };
  }
}

/**
 * Handle click event
 * Records click event for analytics
 * @param event - Parsed SES event with click data
 * @returns Processing result
 */
export async function handleClickEvent(
  event: ParsedSESEvent & { data: SESClickData },
  preloadedSendLog: ResolvedSendLog = null
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    const sendLog = preloadedSendLog || (await getSendLogByMessageId(event.messageId));

    if (!sendLog) {
      logger
        .warn(`Send log not found for message ID: ${event.messageId}`)
        .catch((e) => console.error('Log failed:', e));
      return {
        success: true, // Don't fail, just log
        affectedContactIds,
        updatedSendLogIds,
      };
    }

    updatedSendLogIds.push(sendLog.id);
    affectedContactIds.push(sendLog.contactId);

    const clickTime = new Date(event.data.timestamp);

    // Record the click once through the engagement helper so counts and
    // first-click timestamps stay in sync without double incrementing.
    await recordEngagementEvent(sendLog.id, sendLog.contactId, 'click', {
      timestamp: clickTime,
      link: event.data.link,
      ipAddress: event.data.ipAddress,
      userAgent: event.data.userAgent,
    });

    // Emit click recorded event
    await persistAnalyticsEvent(
      createEvent(DomainEventType.SES_CLICK_RECORDED, {
        eventId: event.eventId,
        messageId: event.messageId,
        contactId: sendLog.contactId,
        sendLogId: sendLog.id,
        link: event.data.link,
        ipAddress: event.data.ipAddress,
        userAgent: event.data.userAgent,
      })
    );

    // Emit analytics event
    emitAnalyticsEvent({
      type: 'email:clicked',
      contactId: sendLog.contactId,
      messageId: event.messageId,
      link: event.data.link,
    });

    return {
      success: true,
      affectedContactIds,
      updatedSendLogIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger
      .warn(`Failed to handle click event: ${errorMessage}`)
      .catch((e) => console.error('Log failed:', e));

    return {
      success: false,
      error: errorMessage,
      affectedContactIds,
      updatedSendLogIds,
    };
  }
}

/**
 * Handle send event
 * Confirms send was accepted by SES
 * @param event - Parsed SES event with send data
 * @returns Processing result
 */
export function handleSendEvent(event: ParsedSESEvent): EventProcessingResult {
  // Send events are primarily for tracking that SES accepted the email
  // The send log was already created when the email was sent
  // This is mainly for audit trail completeness

  logger
    .info(`Send event received for message ${event.messageId}`)
    .catch((e) => console.error('Log failed:', e));

  return {
    success: true,
    affectedContactIds: [],
    updatedSendLogIds: [],
  };
}
