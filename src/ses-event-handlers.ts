/**
 * SES Event Handlers Module for TermiSend
 * Processes SES events by type and updates database/event bus
 */

import {
  confirmSendLogDelivery,
  createSESEventTracking,
  getSendLogByMessageId,
  incrementSendLogClicks,
  incrementSendLogOpens,
  recordEngagementEvent,
  suppressContact,
  updateSendLogBounced,
  updateSendLogComplained,
} from './db.js';
import { emitAnalyticsEvent } from './events/bus.js';
import { createEvent, DomainEventType, domainEvents } from './events/index.js';
import { logger } from './logger.js';
import type {
  EventProcessingResult,
  ParsedSESEvent,
  SESBounceData,
  SESClickData,
  SESComplaintData,
  SESDeliveryData,
  SESOpenData,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum size for event data storage (100KB) */
const MAX_EVENT_DATA_SIZE = 100000;

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

  logger
    .info(`Processing SES event: ${event.eventType} for message ${event.messageId}`)
    .catch((e) => console.error('Log failed:', e));

  // Emit event received notification
  domainEvents.emit(
    createEvent(DomainEventType.SES_EVENT_RECEIVED, {
      eventId: event.eventId,
      eventType: event.eventType,
      messageId: event.messageId,
      recipientCount: event.recipients.length,
    })
  );

  // Create SES event tracking record (best effort - don't fail on tracking errors)
  try {
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
      // Store only essential fields to prevent database bloat
      eventDataToStore = {
        messageId: rawEventData.MessageId,
        notificationType: rawEventData.NotificationType,
        mail: rawEventData.mail,
        // Include truncated version of event data
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
        result = await handleBounceEvent(event as ParsedSESEvent & { data: SESBounceData });
        break;
      case 'Complaint':
        result = await handleComplaintEvent(event as ParsedSESEvent & { data: SESComplaintData });
        break;
      case 'Delivery':
        result = await handleDeliveryEvent(event as ParsedSESEvent & { data: SESDeliveryData });
        break;
      case 'Open':
        result = await handleOpenEvent(event as ParsedSESEvent & { data: SESOpenData });
        break;
      case 'Click':
        result = await handleClickEvent(event as ParsedSESEvent & { data: SESClickData });
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
  event: ParsedSESEvent & { data: SESBounceData }
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    // Find send log by message ID
    const sendLog = await getSendLogByMessageId(event.messageId);

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

    // Suppress contact for hard bounces (Permanent)
    let suppressed = false;
    if (event.data.bounceType === 'Permanent') {
      await suppressContact(
        sendLog.contactId,
        `Hard bounce: ${event.data.bounceSubType}`,
        'bounce'
      );
      affectedContactIds.push(sendLog.contactId);
      suppressed = true;

      // Emit contact suppressed event
      domainEvents.emit(
        createEvent(DomainEventType.CONTACT_SUPPRESSED, {
          contactId: sendLog.contactId,
          messageId: event.messageId,
          reason: `Hard bounce: ${event.data.bounceSubType}`,
          suppressionType: 'bounce',
        })
      );

      // Emit analytics event
      emitAnalyticsEvent({
        type: 'contact:suppressed',
        contactId: sendLog.contactId,
        reason: `Bounce: ${event.data.bounceSubType}`,
      });
    }

    // Emit bounce processed event
    domainEvents.emit(
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
  event: ParsedSESEvent & { data: SESComplaintData }
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    // Find send log by message ID
    const sendLog = await getSendLogByMessageId(event.messageId);

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
    await suppressContact(
      sendLog.contactId,
      `Complaint: ${event.data.complaintFeedbackType || 'unknown'}`,
      'complaint'
    );
    affectedContactIds.push(sendLog.contactId);

    // Emit contact suppressed event
    domainEvents.emit(
      createEvent(DomainEventType.CONTACT_SUPPRESSED, {
        contactId: sendLog.contactId,
        messageId: event.messageId,
        reason: `Complaint: ${event.data.complaintFeedbackType || 'unknown'}`,
        suppressionType: 'complaint',
      })
    );

    // Emit complaint processed event
    domainEvents.emit(
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
      reason: `Complaint: ${event.data.complaintFeedbackType || 'unknown'}`,
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
  event: ParsedSESEvent & { data: SESDeliveryData }
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    // Find send log by message ID
    const sendLog = await getSendLogByMessageId(event.messageId);

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
    domainEvents.emit(
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
 * Handle open event
 * Records open event for analytics
 * @param event - Parsed SES event with open data
 * @returns Processing result
 */
export async function handleOpenEvent(
  event: ParsedSESEvent & { data: SESOpenData }
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    // Find send log by message ID
    const sendLog = await getSendLogByMessageId(event.messageId);

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

    // Record open event
    const openTime = new Date(event.data.timestamp);
    await incrementSendLogOpens(sendLog.id, openTime);

    // Record engagement event
    await recordEngagementEvent(sendLog.id, sendLog.contactId, 'open', {
      timestamp: openTime,
      ipAddress: event.data.ipAddress,
      userAgent: event.data.userAgent,
    });

    // Emit open recorded event
    domainEvents.emit(
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
  event: ParsedSESEvent & { data: SESClickData }
): Promise<EventProcessingResult> {
  const affectedContactIds: string[] = [];
  const updatedSendLogIds: string[] = [];

  try {
    // Find send log by message ID
    const sendLog = await getSendLogByMessageId(event.messageId);

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

    // Record click event
    const clickTime = new Date(event.data.timestamp);
    await incrementSendLogClicks(sendLog.id, {
      timestamp: clickTime,
      link: event.data.link,
    });

    // Record engagement event
    await recordEngagementEvent(sendLog.id, sendLog.contactId, 'click', {
      timestamp: clickTime,
      link: event.data.link,
      ipAddress: event.data.ipAddress,
      userAgent: event.data.userAgent,
    });

    // Emit click recorded event
    domainEvents.emit(
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
