/**
 * SES Event Fixtures for TermiSend Tests
 * Sample SES event payloads for testing
 */

import type {
  SNSNotification,
  SESEventRecord,
  SESBounceData,
  SESComplaintData,
  SESDeliveryData,
  SESDeliveryDelayData,
  SESOpenData,
  SESClickData,
  SESSendData,
  SESRejectData,
  SESFailureData,
} from '../../src/types.js';

// ============================================================================
// SNS Notification Wrappers
// ============================================================================

/**
 * Create a valid SNS notification wrapper for testing
 * @param message - SES event JSON string
 * @param overrides - Properties to override
 * @returns SNS notification object
 */
export function createSNSNotification(
  message: string,
  overrides: Partial<SNSNotification> = {}
): SNSNotification {
  return {
    Type: 'Notification',
    MessageId: `sns-message-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    TopicArn: 'arn:aws:sns:us-east-1:123456789:termisend-ses-email-events',
    Message: message,
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: 'test-signature',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    ...overrides,
  };
}

/**
 * Create a valid SNS notification as SQS message body string
 * @param message - SES event JSON string
 * @returns JSON string of SNS notification
 */
export function createSNSNotificationBody(message: string): string {
  return JSON.stringify(createSNSNotification(message));
}

// ============================================================================
// Common Mail Data
// ============================================================================

const baseMailData = {
  timestamp: new Date().toISOString(),
  source: 'sender@example.com',
  sourceArn: 'arn:aws:ses:us-east-1:123456789:identity/sender@example.com',
  sendingAccountId: '123456789',
  messageId: 'ses-message-id-12345',
  destination: ['recipient@example.com'],
  headers: [
    { name: 'From', value: 'sender@example.com' },
    { name: 'To', value: 'recipient@example.com' },
    { name: 'Subject', value: 'Test Email Subject' },
  ],
  commonHeaders: {
    from: ['sender@example.com'],
    to: ['recipient@example.com'],
    subject: 'Test Email Subject',
    messageId: 'original-message-id-12345',
  },
};

// ============================================================================
// Bounce Events
// ============================================================================

/**
 * Create a hard bounce (Permanent) SES event record
 */
export function createHardBounceEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const bounceData: SESBounceData = {
    bounceType: 'Permanent',
    bounceSubType: 'General',
    bouncedRecipients: [
      {
        emailAddress: 'recipient@example.com',
        action: 'failed',
        status: '5.1.1',
        diagnosticCode: 'smtp; 550 5.1.1 user unknown',
      },
    ],
    timestamp: new Date().toISOString(),
    feedbackId: 'bounce-feedback-id-12345',
    reportingMTA: 'dsn; mta.example.com',
  };

  return {
    eventType: 'Bounce',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'bounce-message-id-12345',
      destination: ['recipient@example.com'],
    },
    bounce: bounceData,
    ...overrides,
  };
}

/**
 * Create a soft bounce (Transient) SES event record
 */
export function createSoftBounceEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const bounceData: SESBounceData = {
    bounceType: 'Transient',
    bounceSubType: 'MailboxFull',
    bouncedRecipients: [
      {
        emailAddress: 'recipient@example.com',
        action: 'delayed',
        status: '4.2.2',
        diagnosticCode: 'smtp; 452 4.2.2 mailbox full',
      },
    ],
    timestamp: new Date().toISOString(),
    feedbackId: 'bounce-feedback-id-soft-12345',
    reportingMTA: 'dsn; mta.example.com',
  };

  return {
    eventType: 'Bounce',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'soft-bounce-message-id-12345',
      destination: ['recipient@example.com'],
    },
    bounce: bounceData,
    ...overrides,
  };
}

/**
 * Create a hard bounce SNS notification body
 */
export function createHardBounceNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createHardBounceEventRecord()));
}

/**
 * Create a soft bounce SNS notification body
 */
export function createSoftBounceNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createSoftBounceEventRecord()));
}

// ============================================================================
// Complaint Events
// ============================================================================

/**
 * Create a complaint SES event record
 */
export function createComplaintEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const complaintData: SESComplaintData = {
    complaintFeedbackType: 'abuse',
    complainedRecipients: [
      {
        emailAddress: 'complainer@example.com',
      },
    ],
    timestamp: new Date().toISOString(),
    feedbackId: 'complaint-feedback-id-12345',
    userAgent: 'Mozilla/5.0',
    arrivalDate: new Date().toISOString(),
  };

  return {
    eventType: 'Complaint',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'complaint-message-id-12345',
      destination: ['complainer@example.com'],
    },
    complaint: complaintData,
    ...overrides,
  };
}

/**
 * Create a complaint SNS notification body
 */
export function createComplaintNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createComplaintEventRecord()));
}

// ============================================================================
// Delivery Events
// ============================================================================

/**
 * Create a delivery SES event record
 */
export function createDeliveryEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const deliveryData: SESDeliveryData = {
    timestamp: new Date().toISOString(),
    processingTimeMillis: 1200,
    recipients: ['recipient@example.com'],
    smtpResponse: '250 ok: Message accepted',
    reportingMTA: 'mta.example.com',
  };

  return {
    eventType: 'Delivery',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'delivery-message-id-12345',
      destination: ['recipient@example.com'],
    },
    delivery: deliveryData,
    ...overrides,
  };
}

/**
 * Create a delivery SNS notification body
 */
export function createDeliveryNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createDeliveryEventRecord()));
}

/**
 * Create a delivery delay SES event record
 */
export function createDeliveryDelayEventRecord(
  overrides: Partial<SESEventRecord> = {}
): SESEventRecord {
  const deliveryDelayData: SESDeliveryDelayData = {
    timestamp: new Date().toISOString(),
    delayType: 'TransientCommunicationFailure',
    expirationTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    delayedRecipients: [
      {
        emailAddress: 'recipient@example.com',
        status: '4.4.1',
        diagnosticCode: 'smtp; 421 4.4.1 connection timed out',
      },
    ],
  };

  return {
    eventType: 'DeliveryDelay',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'delivery-delay-message-id-12345',
      destination: ['recipient@example.com'],
    },
    deliveryDelay: deliveryDelayData,
    ...overrides,
  };
}

/**
 * Create a delivery delay SNS notification body
 */
export function createDeliveryDelayNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createDeliveryDelayEventRecord()));
}

// ============================================================================
// Open Events
// ============================================================================

/**
 * Create an open SES event record
 */
export function createOpenEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const openData: SESOpenData = {
    ipAddress: '192.168.1.1',
    timestamp: new Date().toISOString(),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  return {
    eventType: 'Open',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'open-message-id-12345',
    },
    open: openData,
    ...overrides,
  };
}

/**
 * Create an open SNS notification body
 */
export function createOpenNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createOpenEventRecord()));
}

// ============================================================================
// Click Events
// ============================================================================

/**
 * Create a click SES event record
 */
export function createClickEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const clickData: SESClickData = {
    ipAddress: '192.168.1.1',
    timestamp: new Date().toISOString(),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    link: 'https://example.com/unsubscribe',
    linkTags: {
      campaign: ['test-campaign'],
    },
  };

  return {
    eventType: 'Click',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'click-message-id-12345',
    },
    click: clickData,
    ...overrides,
  };
}

/**
 * Create a click SNS notification body
 */
export function createClickNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createClickEventRecord()));
}

// ============================================================================
// Send Events
// ============================================================================

/**
 * Create a send SES event record
 */
export function createSendEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const sendData: SESSendData = {
    success: true,
  };

  return {
    eventType: 'Send',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'send-message-id-12345',
    },
    send: sendData,
    ...overrides,
  };
}

/**
 * Create a send SNS notification body
 */
export function createSendNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createSendEventRecord()));
}

// ============================================================================
// Reject Events
// ============================================================================

/**
 * Create a reject SES event record
 */
export function createRejectEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const rejectData: SESRejectData = {
    reason: 'Message content rejected by policy',
  };

  return {
    eventType: 'Reject',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'reject-message-id-12345',
    },
    reject: rejectData,
    ...overrides,
  };
}

/**
 * Create a reject SNS notification body
 */
export function createRejectNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createRejectEventRecord()));
}

// ============================================================================
// Rendering Failure Events
// ============================================================================

/**
 * Create a rendering failure SES event record
 */
export function createRenderingFailureEventRecord(overrides: Partial<SESEventRecord> = {}): SESEventRecord {
  const failureData: SESFailureData = {
    errorMessage: 'Template rendering failed: Missing variable',
    errorType: 'TemplateError',
  };

  return {
    eventType: 'RenderingFailure',
    eventTime: new Date().toISOString(),
    mail: {
      ...baseMailData,
      messageId: 'failure-message-id-12345',
    },
    failure: failureData,
    ...overrides,
  };
}

/**
 * Create a rendering failure SNS notification body
 */
export function createRenderingFailureNotification(): string {
  return createSNSNotificationBody(JSON.stringify(createRenderingFailureEventRecord()));
}

// ============================================================================
// Malformed Events (for error testing)
// ============================================================================

/**
 * Create an invalid SNS notification (missing required fields)
 */
export function createInvalidSNSNotification(): string {
  return JSON.stringify({
    Type: 'Notification',
    // Missing MessageId, TopicArn, Message, Timestamp
  });
}

/**
 * Create an invalid SES event (missing required fields)
 */
export function createInvalidSESEventNotification(): string {
  const invalidEvent = {
    eventType: 'InvalidType',
    // Missing eventTime and mail
  };

  return createSNSNotificationBody(JSON.stringify(invalidEvent));
}

/**
 * Create a malformed JSON SNS notification
 */
export function createMalformedJSONNotification(): string {
  return '{"Type": "Notification", "Message": }'; // Invalid JSON
}

/**
 * Create a raw SES event body as delivered by SNS raw message delivery.
 */
export function createRawSESEventMessage(
  event: SESEventRecord = createHardBounceEventRecord()
): string {
  return JSON.stringify(event);
}

/**
 * Create an SNS subscription confirmation message body.
 */
export function createSubscriptionConfirmationNotification(): string {
  return JSON.stringify({
    Type: 'SubscriptionConfirmation',
    MessageId: `sns-message-${Date.now()}`,
    Token: 'subscription-token',
    TopicArn: 'arn:aws:sns:us-east-1:123456789:termisend-ses-email-events',
    Message: 'You have chosen to subscribe to the topic.',
    SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: 'test-signature',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
  });
}

/**
 * Create a non-SNS notification (e.g., SQS message)
 */
export function createNonSNSNotification(): string {
  return JSON.stringify({
    messageId: 'sqs-message-id-123',
    body: 'This is not an SNS notification',
    timestamp: new Date().toISOString(),
  });
}
