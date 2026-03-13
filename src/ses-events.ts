/**
 * SES Event Parser Module for TermiSend
 * Parses SNS notifications and extracts SES event data
 */

import { logger } from './logger.js';
import type {
  ParsedSESEvent,
  SESBounceData,
  SESClickData,
  SESComplaintData,
  SESDeliveryData,
  SESDeliveryDelayData,
  SESEventRecord,
  SESEventType,
  SESFailureData,
  SESOpenData,
  SESRejectData,
  SESSendData,
  SNSNotification,
} from './types.js';

export type ParseSESEventResult =
  | {
      kind: 'event';
      event: ParsedSESEvent;
    }
  | {
      kind: 'skip';
      reason: string;
    }
  | {
      kind: 'invalid';
      reason: string;
    };

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse SQS message body as SNS notification
 * @param messageBody - Raw SQS message body string
 * @returns Parsed SNS notification or null if invalid
 */
export function parseSNSNotification(messageBody: string): SNSNotification | null {
  try {
    const parsed = JSON.parse(messageBody) as unknown;

    // Basic validation
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const notification = parsed as Record<string, unknown>;

    // Check required fields
    if (
      typeof notification.Type !== 'string' ||
      typeof notification.MessageId !== 'string' ||
      typeof notification.TopicArn !== 'string' ||
      typeof notification.Message !== 'string' ||
      typeof notification.Timestamp !== 'string'
    ) {
      return null;
    }

    return {
      Type: notification.Type as SNSNotification['Type'],
      MessageId: notification.MessageId,
      TopicArn: notification.TopicArn,
      Subject: typeof notification.Subject === 'string' ? notification.Subject : undefined,
      Message: notification.Message,
      Timestamp: notification.Timestamp,
      SignatureVersion:
        typeof notification.SignatureVersion === 'string' ? notification.SignatureVersion : '1',
      Signature: typeof notification.Signature === 'string' ? notification.Signature : '',
      SigningCertURL:
        typeof notification.SigningCertURL === 'string' ? notification.SigningCertURL : '',
      UnsubscribeURL:
        typeof notification.UnsubscribeURL === 'string' ? notification.UnsubscribeURL : undefined,
    };
  } catch (error) {
    logger.warn(
      `Failed to parse SNS notification: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Parse SNS message content as SES event record
 * @param snsMessage - SNS Message field containing JSON event
 * @returns Parsed SES event record or null if invalid
 */
export function parseSESEventRecord(snsMessage: string): SESEventRecord | null {
  try {
    const parsed = JSON.parse(snsMessage) as unknown;

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const record = parsed as Record<string, unknown>;

    // Validate required fields
    if (typeof record.eventType !== 'string' || typeof record.mail !== 'object' || record.mail === null) {
      return null;
    }

    const mail = record.mail as Record<string, unknown>;

    // Validate mail data
    if (
      typeof mail.timestamp !== 'string' ||
      typeof mail.messageId !== 'string' ||
      typeof mail.source !== 'string' ||
      typeof mail.sendingAccountId !== 'string' ||
      !Array.isArray(mail.destination)
    ) {
      return null;
    }

    if (!isSupportedEventType(record.eventType)) {
      logger.warn(`Unsupported SES event type: ${record.eventType}`);
      return null;
    }

    const eventTime = resolveEventTime(record, mail);
    if (!eventTime) {
      return null;
    }

    return {
      ...(record as unknown as Omit<SESEventRecord, 'eventTime'>),
      eventTime,
    };
  } catch (error) {
    logger.warn(
      `Failed to parse SES event record: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

function resolveEventTime(
  record: Record<string, unknown>,
  mail: Record<string, unknown>
): string | null {
  if (typeof record.eventTime === 'string') {
    return record.eventTime;
  }

  const eventDataFields = [
    'bounce',
    'complaint',
    'delivery',
    'deliveryDelay',
    'open',
    'click',
  ] as const;
  for (const field of eventDataFields) {
    const value = record[field];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).timestamp === 'string'
    ) {
      return (value as Record<string, unknown>).timestamp as string;
    }
  }

  if (typeof mail.timestamp === 'string') {
    return mail.timestamp;
  }

  return null;
}

/**
 * Main entry point: Parse complete SQS message to structured SES event
 * Performs full validation and transformation
 * @param messageBody - SQS message body
 * @returns Parsed event or null if parsing fails
 */
export function parseSESEventMessage(messageBody: string): ParseSESEventResult {
  try {
    const snsNotification = parseSNSNotification(messageBody);

    if (snsNotification) {
      if (snsNotification.Type !== 'Notification') {
        return {
          kind: 'skip',
          reason: `Skipping SNS ${snsNotification.Type} message`,
        };
      }

      const sesRecord = parseSESEventRecord(snsNotification.Message);
      if (!sesRecord) {
        logger.warn('Failed to parse SES event record from SNS message');
        return {
          kind: 'invalid',
          reason: 'Failed to parse SES event record from SNS message',
        };
      }

      const event = buildParsedEvent(sesRecord, snsNotification.MessageId);
      if (!event) {
        return {
          kind: 'invalid',
          reason: `Failed to extract event data for type: ${sesRecord.eventType}`,
        };
      }

      return {
        kind: 'event',
        event,
      };
    }

    const sesRecord = parseSESEventRecord(messageBody);
    if (!sesRecord) {
      logger.warn('Failed to parse SES event from message body');
      return {
        kind: 'invalid',
        reason: 'Failed to parse SES event from message body',
      };
    }

    const event = buildParsedEvent(sesRecord, sesRecord.mail.messageId);
    if (!event) {
      return {
        kind: 'invalid',
        reason: `Failed to extract event data for type: ${sesRecord.eventType}`,
      };
    }

    return {
      kind: 'event',
      event,
    };
  } catch (error) {
    logger.warn(
      `Failed to parse SES event: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Backwards-compatible event parser that returns only the parsed event.
 * Use parseSESEventMessage() when the caller needs skip vs invalid classification.
 */
export function parseSESEvent(messageBody: string): ParsedSESEvent | null {
  const result = parseSESEventMessage(messageBody);
  return result.kind === 'event' ? result.event : null;
}

/**
 * Validate that event type is supported
 * @param eventType - Raw event type string
 * @returns Whether event type is supported
 */
export function isSupportedEventType(eventType: string): eventType is SESEventType {
  const supportedTypes: SESEventType[] = [
    'Bounce',
    'Complaint',
    'Delivery',
    'DeliveryDelay',
    'Open',
    'Click',
    'Send',
    'Reject',
    'RenderingFailure',
  ];
  return supportedTypes.includes(eventType as SESEventType);
}

/**
 * Extract recipients from event based on event type
 * Different event types store recipients in different fields
 * @param event - Parsed SES event record
 * @returns Array of recipient email addresses
 */
export function extractRecipients(event: SESEventRecord): string[] {
  // Try to get recipients from event-specific data first
  if (event.bounce?.bouncedRecipients) {
    return event.bounce.bouncedRecipients.map((r) => r.emailAddress);
  }

  if (event.complaint?.complainedRecipients) {
    return event.complaint.complainedRecipients.map((r) => r.emailAddress);
  }

  if (event.delivery?.recipients) {
    return event.delivery.recipients;
  }

  if (event.deliveryDelay?.delayedRecipients) {
    return event.deliveryDelay.delayedRecipients.map((recipient) => recipient.emailAddress);
  }

  // Default to mail.destination
  return event.mail.destination || [];
}

/**
 * Extract event-specific data from SES event record
 * @param event - SES event record
 * @returns Event data or null if not found
 */
function extractEventData(
  event: SESEventRecord
):
  | SESBounceData
  | SESComplaintData
  | SESDeliveryData
  | SESDeliveryDelayData
  | SESOpenData
  | SESClickData
  | SESSendData
  | SESRejectData
  | SESFailureData
  | null {
  switch (event.eventType) {
    case 'Bounce':
      return event.bounce || null;
    case 'Complaint':
      return event.complaint || null;
    case 'Delivery':
      return event.delivery || null;
    case 'DeliveryDelay':
      return event.deliveryDelay || null;
    case 'Open':
      return event.open || null;
    case 'Click':
      return event.click || null;
    case 'Send':
      return event.send || { success: true };
    case 'Reject':
      return event.reject || null;
    case 'RenderingFailure':
      return event.failure || null;
    default:
      return null;
  }
}

function buildParsedEvent(
  sesRecord: SESEventRecord,
  eventId: string
): ParsedSESEvent | null {
  const eventData = extractEventData(sesRecord);
  if (!eventData) {
    logger.warn(`Failed to extract event data for type: ${sesRecord.eventType}`);
    return null;
  }

  return {
    eventId,
    eventType: sesRecord.eventType,
    timestamp: new Date(sesRecord.eventTime),
    messageId: sesRecord.mail.messageId,
    recipients: extractRecipients(sesRecord),
    source: sesRecord.mail.source,
    data: eventData,
    rawEvent: sesRecord,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for bounce events
 */
export function isBounceEvent(
  event: SESEventRecord
): event is SESEventRecord & { bounce: NonNullable<SESEventRecord['bounce']> } {
  return event.eventType === 'Bounce' && event.bounce !== undefined;
}

/**
 * Type guard for complaint events
 */
export function isComplaintEvent(
  event: SESEventRecord
): event is SESEventRecord & { complaint: NonNullable<SESEventRecord['complaint']> } {
  return event.eventType === 'Complaint' && event.complaint !== undefined;
}

/**
 * Type guard for delivery events
 */
export function isDeliveryEvent(
  event: SESEventRecord
): event is SESEventRecord & { delivery: NonNullable<SESEventRecord['delivery']> } {
  return event.eventType === 'Delivery' && event.delivery !== undefined;
}

/**
 * Type guard for open events
 */
export function isOpenEvent(
  event: SESEventRecord
): event is SESEventRecord & { open: NonNullable<SESEventRecord['open']> } {
  return event.eventType === 'Open' && event.open !== undefined;
}

/**
 * Type guard for click events
 */
export function isClickEvent(
  event: SESEventRecord
): event is SESEventRecord & { click: NonNullable<SESEventRecord['click']> } {
  return event.eventType === 'Click' && event.click !== undefined;
}

/**
 * Type guard for send events
 */
export function isSendEvent(
  event: SESEventRecord
): event is SESEventRecord & { send: NonNullable<SESEventRecord['send']> } {
  return event.eventType === 'Send';
}

/**
 * Extract SES message ID from SNS notification
 * @param snsNotification - Parsed SNS notification
 * @returns SES message ID or null
 */
export function extractMessageIdFromSNS(snsNotification: SNSNotification): string | null {
  try {
    const record = parseSESEventRecord(snsNotification.Message);
    return record?.mail?.messageId || null;
  } catch {
    return null;
  }
}
