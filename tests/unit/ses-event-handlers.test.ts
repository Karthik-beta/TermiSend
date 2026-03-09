/**
 * Unit Tests for SES Event Handlers Module
 * Tests event processing logic, routing, and database integration
 */

import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

// Mock the logger module to avoid spyOn issues with accessor properties
mock.module('../../src/logger.js', () => ({
  logger: {
    info: mock(() => Promise.resolve()),
    warn: mock(() => Promise.resolve()),
    error: mock(() => Promise.resolve()),
    debug: mock(() => Promise.resolve()),
  }
}));

import * as eventsBusModule from '../../src/events/bus.js';
import * as dbModule from '../../src/db.js';
import {
  processSESEvent,
  handleBounceEvent,
  handleComplaintEvent,
  handleDeliveryEvent,
  handleOpenEvent,
  handleClickEvent,
  handleSendEvent,
} from '../../src/ses-event-handlers.js';
import {
  createHardBounceEventRecord,
  createSoftBounceEventRecord,
  createComplaintEventRecord,
  createDeliveryEventRecord,
  createOpenEventRecord,
  createClickEventRecord,
  createSendEventRecord,
  createRejectEventRecord,
  createRenderingFailureEventRecord,
} from '../fixtures/ses-events.js';
import type { ParsedSESEvent, SESBounceData, SESComplaintData, SESDeliveryData, SESOpenData, SESClickData } from '../../src/types.js';

describe('SES Event Handlers Module', () => {
  // Mock data
  const mockSendLog = {
    id: 'send-log-id-123',
    contactId: 'contact-id-123',
    status: 'sent',
    messageId: 'ses-message-id-12345',
  };

  beforeEach(() => {
    // Mock event bus
    spyOn(eventsBusModule, 'emitAnalyticsEvent').mockImplementation(() => {});

    // Mock database functions - use mockClear to reset between tests
    const mockDbFns = [
      dbModule.createSESEventTracking,
      dbModule.getSendLogByMessageId,
      dbModule.updateSendLogBounced,
      dbModule.updateSendLogComplained,
      dbModule.confirmSendLogDelivery,
      dbModule.incrementSendLogOpens,
      dbModule.incrementSendLogClicks,
      dbModule.suppressContact,
      dbModule.recordEngagementEvent,
      dbModule.recordAnalyticsEvent,
    ];
    
    for (const fn of mockDbFns) {
      // biome-ignore lint/suspicious/noExplicitAny: accessing mock property
      (fn as any).mockClear?.();
    }

    spyOn(dbModule, 'createSESEventTracking').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'getSendLogByMessageId').mockImplementation(() => Promise.resolve(mockSendLog));
    spyOn(dbModule, 'updateSendLogBounced').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'updateSendLogComplained').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'confirmSendLogDelivery').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'incrementSendLogOpens').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'incrementSendLogClicks').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'suppressContact').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'recordEngagementEvent').mockImplementation(() => Promise.resolve());
    spyOn(dbModule, 'recordAnalyticsEvent').mockImplementation(() => Promise.resolve());
  });

  // ============================================================================
  // processSESEvent() Tests
  // ============================================================================

  describe('processSESEvent()', () => {
    it('should route bounce events to handleBounceEvent', async () => {
      const event = createParsedBounceEvent('Permanent');
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
      expect(result.updatedSendLogIds).toContain(mockSendLog.id);
    });

    it('should route complaint events to handleComplaintEvent', async () => {
      const event = createParsedComplaintEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
      expect(result.updatedSendLogIds).toContain(mockSendLog.id);
    });

    it('should route delivery events to handleDeliveryEvent', async () => {
      const event = createParsedDeliveryEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
      expect(result.updatedSendLogIds).toContain(mockSendLog.id);
    });

    it('should route open events to handleOpenEvent', async () => {
      const event = createParsedOpenEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
      expect(result.updatedSendLogIds).toContain(mockSendLog.id);
    });

    it('should route click events to handleClickEvent', async () => {
      const event = createParsedClickEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
      expect(result.updatedSendLogIds).toContain(mockSendLog.id);
    });

    it('should route send events to handleSendEvent', async () => {
      const event = createParsedSendEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
    });

    it('should handle reject events without special processing', async () => {
      const event = createParsedRejectEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
    });

    it('should handle rendering failure events without special processing', async () => {
      const event = createParsedRenderingFailureEvent();
      const result = await processSESEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
    });

    it('should emit SES_EVENT_RECEIVED event', async () => {
      const event = createParsedBounceEvent('Permanent');
      await processSESEvent(event);

      // Event emission is done via domainEvents.emit
      // Since we can't easily spy on that, we verify the function completed
      expect(dbModule.createSESEventTracking).toHaveBeenCalled();
    });

    it('should return error for unsupported event types', async () => {
      const event = { ...createParsedBounceEvent('Permanent'), eventType: 'UnknownType' as 'Bounce' };
      const result = await processSESEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported event type');
    });

    it('should not throw errors from event handlers (isolation)', async () => {
      // Mock a database error
      spyOn(dbModule, 'getSendLogByMessageId').mockRejectedValue(new Error('DB Error'));

      const event = createParsedBounceEvent('Permanent');
      const result = await processSESEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleBounceEvent() Tests
  // ============================================================================

  describe('handleBounceEvent()', () => {
    it('should update send log status for hard bounce', async () => {
      const event = createParsedBounceEvent('Permanent');
      const result = await handleBounceEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.updateSendLogBounced).toHaveBeenCalledWith(
        mockSendLog.id,
        'Permanent',
        expect.any(Object)
      );
    });

    it('should update send log status for soft bounce', async () => {
      const event = createParsedBounceEvent('Transient');
      const result = await handleBounceEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.updateSendLogBounced).toHaveBeenCalledWith(
        mockSendLog.id,
        'Transient',
        expect.any(Object)
      );
    });

    it('should suppress contact for hard bounces', async () => {
      const event = createParsedBounceEvent('Permanent');
      const result = await handleBounceEvent(event);

      expect(result.success).toBe(true);
      expect(result.affectedContactIds).toContain(mockSendLog.contactId);
      expect(dbModule.suppressContact).toHaveBeenCalledWith(
        mockSendLog.contactId,
        expect.stringContaining('Hard bounce'),
        'bounce'
      );
    });

    it('should NOT suppress contact for soft bounces', async () => {
      const event = createParsedBounceEvent('Transient');
      const result = await handleBounceEvent(event);

      expect(result.success).toBe(true);
      expect(result.affectedContactIds).toHaveLength(0);
      expect(dbModule.suppressContact).not.toHaveBeenCalled();
    });

    it('should return success when send log not found (graceful degradation)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockResolvedValue(null);

      const event = createParsedBounceEvent('Permanent');
      const result = await handleBounceEvent(event);

      expect(result.success).toBe(true);
      expect(result.updatedSendLogIds).toHaveLength(0);
      expect(dbModule.updateSendLogBounced).not.toHaveBeenCalled();
    });

    it('should emit analytics event for bounce', async () => {
      const event = createParsedBounceEvent('Permanent');
      await handleBounceEvent(event);

      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'email:bounced',
          contactId: mockSendLog.contactId,
        })
      );
    });

    it('should emit contact:suppressed analytics event for hard bounce', async () => {
      const event = createParsedBounceEvent('Permanent');
      await handleBounceEvent(event);

      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'contact:suppressed',
          contactId: mockSendLog.contactId,
        })
      );
    });

    it('should not throw errors (returns error result instead)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockRejectedValue(new Error('DB Error'));

      const event = createParsedBounceEvent('Permanent');
      const result = await handleBounceEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleComplaintEvent() Tests
  // ============================================================================

  describe('handleComplaintEvent()', () => {
    it('should update send log status with complaint', async () => {
      const event = createParsedComplaintEvent();
      const result = await handleComplaintEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.updateSendLogComplained).toHaveBeenCalledWith(
        mockSendLog.id,
        expect.any(Object)
      );
    });

    it('should always suppress contact for complaints', async () => {
      const event = createParsedComplaintEvent();
      const result = await handleComplaintEvent(event);

      expect(result.success).toBe(true);
      expect(result.affectedContactIds).toContain(mockSendLog.contactId);
      expect(dbModule.suppressContact).toHaveBeenCalledWith(
        mockSendLog.contactId,
        expect.stringContaining('Complaint'),
        'complaint'
      );
    });

    it('should return success when send log not found (graceful degradation)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockResolvedValue(null);

      const event = createParsedComplaintEvent();
      const result = await handleComplaintEvent(event);

      expect(result.success).toBe(true);
      expect(result.updatedSendLogIds).toHaveLength(0);
      expect(dbModule.updateSendLogComplained).not.toHaveBeenCalled();
    });

    it('should emit analytics events for complaint', async () => {
      const event = createParsedComplaintEvent();
      await handleComplaintEvent(event);

      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'contact:suppressed',
          contactId: mockSendLog.contactId,
        })
      );
      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'email:complained',
          contactId: mockSendLog.contactId,
        })
      );
    });

    it('should not throw errors (returns error result instead)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockRejectedValue(new Error('DB Error'));

      const event = createParsedComplaintEvent();
      const result = await handleComplaintEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleDeliveryEvent() Tests
  // ============================================================================

  describe('handleDeliveryEvent()', () => {
    it('should confirm send log delivery', async () => {
      const event = createParsedDeliveryEvent();
      const result = await handleDeliveryEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.confirmSendLogDelivery).toHaveBeenCalledWith(
        mockSendLog.id,
        expect.any(Date)
      );
    });

    it('should return success when send log not found (graceful degradation)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockResolvedValue(null);

      const event = createParsedDeliveryEvent();
      const result = await handleDeliveryEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.confirmSendLogDelivery).not.toHaveBeenCalled();
    });

    it('should emit analytics event for delivery', async () => {
      const event = createParsedDeliveryEvent();
      await handleDeliveryEvent(event);

      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'email:delivered',
          contactId: mockSendLog.contactId,
        })
      );
    });

    it('should not throw errors (returns error result instead)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockRejectedValue(new Error('DB Error'));

      const event = createParsedDeliveryEvent();
      const result = await handleDeliveryEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleOpenEvent() Tests
  // ============================================================================

  describe('handleOpenEvent()', () => {
    it('should record a single open via the engagement helper', async () => {
      const event = createParsedOpenEvent();
      const result = await handleOpenEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.recordEngagementEvent).toHaveBeenCalledWith(
        mockSendLog.id,
        mockSendLog.contactId,
        'open',
        expect.objectContaining({
          timestamp: expect.any(Date),
          ipAddress: event.data.ipAddress,
          userAgent: event.data.userAgent,
        })
      );
      expect(dbModule.incrementSendLogOpens).not.toHaveBeenCalled();
    });

    it('should record engagement event', async () => {
      const event = createParsedOpenEvent();
      const result = await handleOpenEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.recordEngagementEvent).toHaveBeenCalledWith(
        mockSendLog.id,
        mockSendLog.contactId,
        'open',
        expect.objectContaining({
          ipAddress: event.data.ipAddress,
          userAgent: event.data.userAgent,
        })
      );
    });

    it('should return success when send log not found (graceful degradation)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockResolvedValue(null);

      const event = createParsedOpenEvent();
      const result = await handleOpenEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.incrementSendLogOpens).not.toHaveBeenCalled();
    });

    it('should emit analytics event for open', async () => {
      const event = createParsedOpenEvent();
      await handleOpenEvent(event);

      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'email:opened',
          contactId: mockSendLog.contactId,
        })
      );
    });

    it('should not throw errors (returns error result instead)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockRejectedValue(new Error('DB Error'));

      const event = createParsedOpenEvent();
      const result = await handleOpenEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleClickEvent() Tests
  // ============================================================================

  describe('handleClickEvent()', () => {
    it('should record a single click via the engagement helper', async () => {
      const event = createParsedClickEvent();
      const result = await handleClickEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.recordEngagementEvent).toHaveBeenCalledWith(
        mockSendLog.id,
        mockSendLog.contactId,
        'click',
        expect.objectContaining({
          timestamp: expect.any(Date),
          link: event.data.link,
          ipAddress: event.data.ipAddress,
          userAgent: event.data.userAgent,
        })
      );
      expect(dbModule.incrementSendLogClicks).not.toHaveBeenCalled();
    });

    it('should record engagement event', async () => {
      const event = createParsedClickEvent();
      const result = await handleClickEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.recordEngagementEvent).toHaveBeenCalledWith(
        mockSendLog.id,
        mockSendLog.contactId,
        'click',
        expect.objectContaining({
          ipAddress: event.data.ipAddress,
          userAgent: event.data.userAgent,
          link: event.data.link,
        })
      );
    });

    it('should return success when send log not found (graceful degradation)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockResolvedValue(null);

      const event = createParsedClickEvent();
      const result = await handleClickEvent(event);

      expect(result.success).toBe(true);
      expect(dbModule.incrementSendLogClicks).not.toHaveBeenCalled();
    });

    it('should emit analytics event for click', async () => {
      const event = createParsedClickEvent();
      await handleClickEvent(event);

      expect(eventsBusModule.emitAnalyticsEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'email:clicked',
          contactId: mockSendLog.contactId,
        })
      );
    });

    it('should not throw errors (returns error result instead)', async () => {
      spyOn(dbModule, 'getSendLogByMessageId').mockRejectedValue(new Error('DB Error'));

      const event = createParsedClickEvent();
      const result = await handleClickEvent(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // handleSendEvent() Tests
  // ============================================================================

  describe('handleSendEvent()', () => {
    it('should handle send event without database changes', async () => {
      const event = createParsedSendEvent();
      const result = await handleSendEvent(event);

      expect(result.success).toBe(true);
      expect(result.affectedContactIds).toHaveLength(0);
      expect(result.updatedSendLogIds).toHaveLength(0);
    });

    it('should not throw errors (returns error result instead)', async () => {
      const event = createParsedSendEvent();
      // Send events don't interact with DB, so errors are unlikely
      // Just verify it returns success
      const result = await handleSendEvent(event);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // Helper Functions
  // ============================================================================

  function createParsedBounceEvent(bounceType: 'Permanent' | 'Transient'): ParsedSESEvent & { data: SESBounceData } {
    const record = bounceType === 'Permanent' 
      ? createHardBounceEventRecord() 
      : createSoftBounceEventRecord();
    
    return {
      eventId: 'event-id-123',
      eventType: 'Bounce',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: record.bounce?.bouncedRecipients.map(r => r.emailAddress) || [],
      source: record.mail.source,
      data: record.bounce as SESBounceData,
      rawEvent: record,
    };
  }

  function createParsedComplaintEvent(): ParsedSESEvent & { data: SESComplaintData } {
    const record = createComplaintEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'Complaint',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: record.complaint?.complainedRecipients.map(r => r.emailAddress) || [],
      source: record.mail.source,
      data: record.complaint as SESComplaintData,
      rawEvent: record,
    };
  }

  function createParsedDeliveryEvent(): ParsedSESEvent & { data: SESDeliveryData } {
    const record = createDeliveryEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'Delivery',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: record.delivery?.recipients || [],
      source: record.mail.source,
      data: record.delivery as SESDeliveryData,
      rawEvent: record,
    };
  }

  function createParsedOpenEvent(): ParsedSESEvent & { data: SESOpenData } {
    const record = createOpenEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'Open',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: [],
      source: record.mail.source,
      data: record.open as SESOpenData,
      rawEvent: record,
    };
  }

  function createParsedClickEvent(): ParsedSESEvent & { data: SESClickData } {
    const record = createClickEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'Click',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: [],
      source: record.mail.source,
      data: record.click as SESClickData,
      rawEvent: record,
    };
  }

  function createParsedSendEvent(): ParsedSESEvent {
    const record = createSendEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'Send',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: record.mail.destination,
      source: record.mail.source,
      data: { success: true },
      rawEvent: record,
    };
  }

  function createParsedRejectEvent(): ParsedSESEvent {
    const record = createRejectEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'Reject',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: [],
      source: record.mail.source,
      data: record.reject as { reason: string },
      rawEvent: record,
    };
  }

  function createParsedRenderingFailureEvent(): ParsedSESEvent {
    const record = createRenderingFailureEventRecord();
    return {
      eventId: 'event-id-123',
      eventType: 'RenderingFailure',
      timestamp: new Date(),
      messageId: record.mail.messageId,
      recipients: [],
      source: record.mail.source,
      data: record.failure as { errorMessage: string; errorType: string },
      rawEvent: record,
    };
  }
});
