/**
 * Unit Tests for SES Events Module
 * Tests SNS notification parsing, SES event parsing, and type guards
 */

import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as loggerModule from '../../src/logger.js';
import {
  parseSNSNotification,
  parseSESEventRecord,
  parseSESEvent,
  isSupportedEventType,
  extractRecipients,
  extractMessageIdFromSNS,
  isBounceEvent,
  isComplaintEvent,
  isDeliveryEvent,
  isOpenEvent,
  isClickEvent,
  isSendEvent,
} from '../../src/ses-events.js';
import {
  createHardBounceNotification,
  createSoftBounceNotification,
  createComplaintNotification,
  createDeliveryNotification,
  createOpenNotification,
  createClickNotification,
  createSendNotification,
  createRejectNotification,
  createRenderingFailureNotification,
  createInvalidSNSNotification,
  createInvalidSESEventNotification,
  createMalformedJSONNotification,
  createNonSNSNotification,
  createHardBounceEventRecord,
  createSoftBounceEventRecord,
  createComplaintEventRecord,
  createDeliveryEventRecord,
  createOpenEventRecord,
  createClickEventRecord,
  createSendEventRecord,
  createRejectEventRecord,
  createRenderingFailureEventRecord,
  createSNSNotification,
} from '../fixtures/ses-events.js';

describe('SES Events Module', () => {
  beforeEach(() => {
    // Mock logger to prevent test noise
    spyOn(loggerModule.logger, 'info').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'warn').mockImplementation(() => Promise.resolve());
  });

  // ============================================================================
  // parseSNSNotification() Tests
  // ============================================================================

  describe('parseSNSNotification()', () => {
    it('should parse valid SNS notification with all fields', () => {
      const message = createHardBounceNotification();
      const result = parseSNSNotification(message);

      expect(result).not.toBeNull();
      expect(result?.Type).toBe('Notification');
      expect(result?.MessageId).toBeDefined();
      expect(result?.TopicArn).toContain('arn:aws:sns');
      expect(result?.Message).toBeDefined();
      expect(result?.Timestamp).toBeDefined();
      expect(result?.SignatureVersion).toBe('1');
      expect(result?.Signature).toBeDefined();
      expect(result?.SigningCertURL).toBeDefined();
    });

    it('should handle optional Subject field', () => {
      const message = JSON.stringify(
        createSNSNotification('{"test": true}', { Subject: 'Test Subject' })
      );
      const result = parseSNSNotification(message);

      expect(result).not.toBeNull();
      expect(result?.Subject).toBe('Test Subject');
    });

    it('should handle missing optional fields with defaults', () => {
      const message = createHardBounceNotification();
      const result = parseSNSNotification(message);

      expect(result).not.toBeNull();
      expect(result?.SignatureVersion).toBe('1');
      expect(result?.Signature).toBeDefined();
    });

    it('should return null for invalid JSON', () => {
      const result = parseSNSNotification('not valid json');
      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const result = parseSNSNotification(createMalformedJSONNotification());
      expect(result).toBeNull();
    });

    it('should return null for non-object JSON', () => {
      const result = parseSNSNotification('"just a string"');
      expect(result).toBeNull();
    });

    it('should return null for null JSON', () => {
      const result = parseSNSNotification('null');
      expect(result).toBeNull();
    });

    it('should return null when missing required Type field', () => {
      const result = parseSNSNotification(createInvalidSNSNotification());
      expect(result).toBeNull();
    });

    it('should return null for non-SNS notification structure', () => {
      const result = parseSNSNotification(createNonSNSNotification());
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // parseSESEventRecord() Tests
  // ============================================================================

  describe('parseSESEventRecord()', () => {
    it('should parse valid bounce event record', () => {
      const record = createHardBounceEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Bounce');
      expect(result?.eventTime).toBeDefined();
      expect(result?.mail).toBeDefined();
      expect(result?.mail.messageId).toBeDefined();
      expect(result?.bounce).toBeDefined();
    });

    it('should parse valid complaint event record', () => {
      const record = createComplaintEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Complaint');
      expect(result?.complaint).toBeDefined();
    });

    it('should parse valid delivery event record', () => {
      const record = createDeliveryEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Delivery');
      expect(result?.delivery).toBeDefined();
    });

    it('should parse valid open event record', () => {
      const record = createOpenEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Open');
      expect(result?.open).toBeDefined();
    });

    it('should parse valid click event record', () => {
      const record = createClickEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Click');
      expect(result?.click).toBeDefined();
    });

    it('should parse valid send event record', () => {
      const record = createSendEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Send');
      expect(result?.send).toBeDefined();
    });

    it('should parse valid reject event record', () => {
      const record = createRejectEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Reject');
      expect(result?.reject).toBeDefined();
    });

    it('should parse valid rendering failure event record', () => {
      const record = createRenderingFailureEventRecord();
      const result = parseSESEventRecord(JSON.stringify(record));

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('RenderingFailure');
      expect(result?.failure).toBeDefined();
    });

    it('should return null for invalid JSON', () => {
      const result = parseSESEventRecord('not valid json');
      expect(result).toBeNull();
    });

    it('should return null for non-object JSON', () => {
      const result = parseSESEventRecord('12345');
      expect(result).toBeNull();
    });

    it('should return null when missing required eventType field', () => {
      const result = parseSESEventRecord(createInvalidSESEventNotification());
      expect(result).toBeNull();
    });

    it('should return null when missing required eventTime field', () => {
      const invalidRecord = {
        eventType: 'Bounce',
        // Missing eventTime
        mail: createHardBounceEventRecord().mail,
      };
      const result = parseSESEventRecord(JSON.stringify(invalidRecord));
      expect(result).toBeNull();
    });

    it('should return null when missing required mail field', () => {
      const invalidRecord = {
        eventType: 'Bounce',
        eventTime: new Date().toISOString(),
        // Missing mail
      };
      const result = parseSESEventRecord(JSON.stringify(invalidRecord));
      expect(result).toBeNull();
    });

    it('should return null when mail fields are invalid', () => {
      const invalidRecord = {
        eventType: 'Bounce',
        eventTime: new Date().toISOString(),
        mail: {
          // Missing required mail fields
          timestamp: new Date().toISOString(),
        },
      };
      const result = parseSESEventRecord(JSON.stringify(invalidRecord));
      expect(result).toBeNull();
    });

    it('should return null for unsupported event types', () => {
      const invalidRecord = createHardBounceEventRecord({ eventType: 'UnknownType' as 'Bounce' });
      const result = parseSESEventRecord(JSON.stringify(invalidRecord));
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // parseSESEvent() Tests
  // ============================================================================

  describe('parseSESEvent()', () => {
    it('should parse complete hard bounce event', () => {
      const message = createHardBounceNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Bounce');
      expect(result?.messageId).toContain('bounce');
      expect(result?.recipients).toContain('recipient@example.com');
      expect(result?.source).toBe('sender@example.com');
      expect(result?.timestamp).toBeInstanceOf(Date);
      expect(result?.data).toBeDefined();
      expect(result?.eventId).toBeDefined();
      expect(result?.rawEvent).toBeDefined();
    });

    it('should parse complete soft bounce event', () => {
      const message = createSoftBounceNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Bounce');
      expect(result?.data).toHaveProperty('bounceType', 'Transient');
    });

    it('should parse complete complaint event', () => {
      const message = createComplaintNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Complaint');
      expect(result?.recipients).toContain('complainer@example.com');
    });

    it('should parse complete delivery event', () => {
      const message = createDeliveryNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Delivery');
      expect(result?.data).toHaveProperty('processingTimeMillis');
    });

    it('should parse complete open event', () => {
      const message = createOpenNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Open');
      expect(result?.data).toHaveProperty('ipAddress');
      expect(result?.data).toHaveProperty('userAgent');
    });

    it('should parse complete click event', () => {
      const message = createClickNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Click');
      expect(result?.data).toHaveProperty('link');
    });

    it('should parse complete send event', () => {
      const message = createSendNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Send');
      expect(result?.data).toHaveProperty('success', true);
    });

    it('should parse complete reject event', () => {
      const message = createRejectNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('Reject');
      expect(result?.data).toHaveProperty('reason');
    });

    it('should parse complete rendering failure event', () => {
      const message = createRenderingFailureNotification();
      const result = parseSESEvent(message);

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe('RenderingFailure');
      expect(result?.data).toHaveProperty('errorMessage');
    });

    it('should return null for invalid SNS notification', () => {
      const result = parseSESEvent(createInvalidSNSNotification());
      expect(result).toBeNull();
    });

    it('should return null for invalid SES event', () => {
      const result = parseSESEvent(createInvalidSESEventNotification());
      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const result = parseSESEvent(createMalformedJSONNotification());
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // isSupportedEventType() Tests
  // ============================================================================

  describe('isSupportedEventType()', () => {
    it('should return true for Bounce', () => {
      expect(isSupportedEventType('Bounce')).toBe(true);
    });

    it('should return true for Complaint', () => {
      expect(isSupportedEventType('Complaint')).toBe(true);
    });

    it('should return true for Delivery', () => {
      expect(isSupportedEventType('Delivery')).toBe(true);
    });

    it('should return true for Open', () => {
      expect(isSupportedEventType('Open')).toBe(true);
    });

    it('should return true for Click', () => {
      expect(isSupportedEventType('Click')).toBe(true);
    });

    it('should return true for Send', () => {
      expect(isSupportedEventType('Send')).toBe(true);
    });

    it('should return true for Reject', () => {
      expect(isSupportedEventType('Reject')).toBe(true);
    });

    it('should return true for RenderingFailure', () => {
      expect(isSupportedEventType('RenderingFailure')).toBe(true);
    });

    it('should return false for unsupported event types', () => {
      expect(isSupportedEventType('Unknown')).toBe(false);
      expect(isSupportedEventType('Custom')).toBe(false);
      expect(isSupportedEventType('')).toBe(false);
    });
  });

  // ============================================================================
  // extractRecipients() Tests
  // ============================================================================

  describe('extractRecipients()', () => {
    it('should extract recipients from bouncedRecipients', () => {
      const record = createHardBounceEventRecord();
      const result = extractRecipients(record);

      expect(result).toContain('recipient@example.com');
      expect(result).toHaveLength(1);
    });

    it('should extract recipients from complainedRecipients', () => {
      const record = createComplaintEventRecord();
      const result = extractRecipients(record);

      expect(result).toContain('complainer@example.com');
    });

    it('should extract recipients from delivery recipients', () => {
      const record = createDeliveryEventRecord();
      const result = extractRecipients(record);

      expect(result).toContain('recipient@example.com');
    });

    it('should fallback to mail.destination when no specific recipients', () => {
      const record = createSendEventRecord();
      const result = extractRecipients(record);

      expect(result).toContain('recipient@example.com');
    });

    it('should handle multiple bounced recipients', () => {
      const record = createHardBounceEventRecord({
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [
            { emailAddress: 'user1@example.com' },
            { emailAddress: 'user2@example.com' },
          ],
          timestamp: new Date().toISOString(),
          feedbackId: 'test-feedback-id',
        },
      });
      const result = extractRecipients(record);

      expect(result).toContain('user1@example.com');
      expect(result).toContain('user2@example.com');
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no recipients found', () => {
      const record = createSendEventRecord({
        mail: {
          ...createSendEventRecord().mail,
          destination: [],
        },
      });
      const result = extractRecipients(record);

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // extractMessageIdFromSNS() Tests
  // ============================================================================

  describe('extractMessageIdFromSNS()', () => {
    it('should extract message ID from valid SNS notification', () => {
      const message = createHardBounceNotification();
      const notification = parseSNSNotification(message)!;
      const result = extractMessageIdFromSNS(notification);

      expect(result).toContain('bounce');
    });

    it('should extract message ID from delivery event', () => {
      const message = createDeliveryNotification();
      const notification = parseSNSNotification(message)!;
      const result = extractMessageIdFromSNS(notification);

      expect(result).toContain('delivery');
    });

    it('should return null for invalid message content', () => {
      const notification = createSNSNotification('invalid json');
      const result = extractMessageIdFromSNS(notification);

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // Type Guard Tests
  // ============================================================================

  describe('Type Guards', () => {
    describe('isBounceEvent()', () => {
      it('should return true for bounce events', () => {
        const record = createHardBounceEventRecord();
        expect(isBounceEvent(record)).toBe(true);
      });

      it('should return false for non-bounce events', () => {
        const record = createComplaintEventRecord();
        expect(isBounceEvent(record)).toBe(false);
      });

      it('should return false for bounce events without bounce data', () => {
        const record = { ...createHardBounceEventRecord(), bounce: undefined };
        expect(isBounceEvent(record)).toBe(false);
      });
    });

    describe('isComplaintEvent()', () => {
      it('should return true for complaint events', () => {
        const record = createComplaintEventRecord();
        expect(isComplaintEvent(record)).toBe(true);
      });

      it('should return false for non-complaint events', () => {
        const record = createHardBounceEventRecord();
        expect(isComplaintEvent(record)).toBe(false);
      });

      it('should return false for complaint events without complaint data', () => {
        const record = { ...createComplaintEventRecord(), complaint: undefined };
        expect(isComplaintEvent(record)).toBe(false);
      });
    });

    describe('isDeliveryEvent()', () => {
      it('should return true for delivery events', () => {
        const record = createDeliveryEventRecord();
        expect(isDeliveryEvent(record)).toBe(true);
      });

      it('should return false for non-delivery events', () => {
        const record = createHardBounceEventRecord();
        expect(isDeliveryEvent(record)).toBe(false);
      });

      it('should return false for delivery events without delivery data', () => {
        const record = { ...createDeliveryEventRecord(), delivery: undefined };
        expect(isDeliveryEvent(record)).toBe(false);
      });
    });

    describe('isOpenEvent()', () => {
      it('should return true for open events', () => {
        const record = createOpenEventRecord();
        expect(isOpenEvent(record)).toBe(true);
      });

      it('should return false for non-open events', () => {
        const record = createHardBounceEventRecord();
        expect(isOpenEvent(record)).toBe(false);
      });

      it('should return false for open events without open data', () => {
        const record = { ...createOpenEventRecord(), open: undefined };
        expect(isOpenEvent(record)).toBe(false);
      });
    });

    describe('isClickEvent()', () => {
      it('should return true for click events', () => {
        const record = createClickEventRecord();
        expect(isClickEvent(record)).toBe(true);
      });

      it('should return false for non-click events', () => {
        const record = createHardBounceEventRecord();
        expect(isClickEvent(record)).toBe(false);
      });

      it('should return false for click events without click data', () => {
        const record = { ...createClickEventRecord(), click: undefined };
        expect(isClickEvent(record)).toBe(false);
      });
    });

    describe('isSendEvent()', () => {
      it('should return true for send events', () => {
        const record = createSendEventRecord();
        expect(isSendEvent(record)).toBe(true);
      });

      it('should return false for non-send events', () => {
        const record = createHardBounceEventRecord();
        expect(isSendEvent(record)).toBe(false);
      });

      it('should return true for send events even without explicit send data', () => {
        const record = { ...createSendEventRecord(), send: undefined };
        expect(isSendEvent(record)).toBe(true);
      });
    });
  });
});
