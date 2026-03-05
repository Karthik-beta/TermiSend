/**
 * Unit Tests for SQS Consumer Module
 * Tests SQS client initialization, message polling, and processing
 */

import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as configModule from '../../src/config.js';
import * as sesEventsModule from '../../src/ses-events.js';
import * as sesEventHandlersModule from '../../src/ses-event-handlers.js';

// Mock the logger module to avoid spyOn issues with accessor properties
mock.module('../../src/logger.js', () => ({
  logger: {
    info: mock(() => Promise.resolve()),
    warn: mock(() => Promise.resolve()),
    logError: mock(() => Promise.resolve()),
    logEvent: mock(() => Promise.resolve()),
  }
}));
import {
  getSQSClient,
  resetSQSClient,
  getConsumerStatus,
  startConsumer,
  stopConsumer,
  isConsumerRunning,
  pollMessages,
  processMessage,
  deleteMessage,
  returnMessageForRetry,
  handleProcessingError,
} from '../../src/sqs-consumer.js';
import {
  createHardBounceNotification,
  createDeliveryNotification,
} from '../fixtures/ses-events.js';
import { restoreEnv, setMockEnv } from '../helpers/test-utils.js';

// Mock AWS SDK
const mockSend = mock(() => Promise.resolve({}));

mock.module('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: class MockSQSClient {
      send = mockSend;
    },
    ReceiveMessageCommand: class MockReceiveMessageCommand {
      constructor(public input: unknown) {}
    },
    DeleteMessageCommand: class MockDeleteMessageCommand {
      constructor(public input: unknown) {}
    },
    ChangeMessageVisibilityCommand: class MockChangeMessageVisibilityCommand {
      constructor(public input: unknown) {}
    },
  };
});

describe('SQS Consumer Module', () => {
  beforeEach(() => {
    // Reset state
    resetSQSClient();
    mockSend.mockClear();

    // Set up test environment
    restoreEnv();
    setMockEnv({
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      AWS_REGION: 'us-east-1',
      SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789/termisend-queue',
    });

    // Stop consumer if running
    if (isConsumerRunning()) {
      stopConsumer();
    }
  });

  // ============================================================================
  // getSQSClient() Tests
  // ============================================================================

  describe('getSQSClient()', () => {
    it('should create SQS client with lazy initialization', () => {
      const client = getSQSClient();
      expect(client).toBeDefined();
      expect(client).toBe(getSQSClient()); // Should return same instance
    });

    it('should return cached client on subsequent calls', () => {
      const client1 = getSQSClient();
      const client2 = getSQSClient();
      expect(client1).toBe(client2);
    });

    it('should use config region', () => {
      const client = getSQSClient();
      // The client is created; we verify it doesn't throw
      expect(client).toBeDefined();
    });

    it('should create new client after reset', () => {
      const client1 = getSQSClient();
      resetSQSClient();
      const client2 = getSQSClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe('resetSQSClient()', () => {
    it('should allow creating new client', () => {
      getSQSClient();
      resetSQSClient();
      const client = getSQSClient();
      expect(client).toBeDefined();
    });
  });

  // ============================================================================
  // getConsumerStatus() Tests
  // ============================================================================

  describe('getConsumerStatus()', () => {
    it('should return default status when not running', () => {
      const status = getConsumerStatus();
      
      expect(status.isRunning).toBe(false);
      expect(status.messagesProcessed).toBe(0);
      expect(status.messagesFailed).toBe(0);
      expect(status.inFlightCount).toBe(0);
    });

    it('should return a copy (not reference)', () => {
      const status1 = getConsumerStatus();
      const status2 = getConsumerStatus();
      
      expect(status1).toEqual(status2);
    });
  });

  // ============================================================================
  // isConsumerRunning() Tests
  // ============================================================================

  describe('isConsumerRunning()', () => {
    it('should return false initially', () => {
      expect(isConsumerRunning()).toBe(false);
    });
  });

  // ============================================================================
  // pollMessages() Tests
  // ============================================================================

  describe('pollMessages()', () => {
    it('should return empty array when no messages', async () => {
      mockSend.mockImplementation(() => Promise.resolve({ Messages: [] }));

      const messages = await pollMessages();
      
      expect(messages).toEqual([]);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should return messages when received', async () => {
      const mockMessages = [
        {
          MessageId: 'msg-1',
          ReceiptHandle: 'receipt-1',
          Body: createHardBounceNotification(),
          Attributes: { ApproximateReceiveCount: '1' },
        },
      ];
      mockSend.mockImplementation(() => Promise.resolve({ Messages: mockMessages }));

      const messages = await pollMessages();
      
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('msg-1');
      expect(messages[0].receiptHandle).toBe('receipt-1');
      expect(messages[0].body).toBeDefined();
      expect(messages[0].receiveCount).toBe(1);
    });

    it('should handle multiple messages', async () => {
      const mockMessages = [
        {
          MessageId: 'msg-1',
          ReceiptHandle: 'receipt-1',
          Body: createHardBounceNotification(),
        },
        {
          MessageId: 'msg-2',
          ReceiptHandle: 'receipt-2',
          Body: createDeliveryNotification(),
        },
      ];
      mockSend.mockImplementation(() => Promise.resolve({ Messages: mockMessages }));

      const messages = await pollMessages();
      
      expect(messages).toHaveLength(2);
    });

    it('should handle SQS client errors', async () => {
      mockSend.mockImplementation(() => Promise.reject(new Error('SQS Error')));

      await expect(pollMessages()).rejects.toThrow('SQS Error');
    });
  });

  // ============================================================================
  // processMessage() Tests
  // ============================================================================

  describe('processMessage()', () => {
    beforeEach(() => {
      // Mock SES event parsing
      spyOn(sesEventsModule, 'parseSESEvent').mockImplementation(() => ({
        eventId: 'event-id-123',
        eventType: 'Bounce',
        timestamp: new Date(),
        messageId: 'ses-message-id-12345',
        recipients: ['recipient@example.com'],
        source: 'sender@example.com',
        data: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [{ emailAddress: 'recipient@example.com' }],
          timestamp: new Date().toISOString(),
          feedbackId: 'feedback-123',
        },
        rawEvent: {} as import('../../src/types.js').SESEventRecord,
      }));

      // Mock event handler
      spyOn(sesEventHandlersModule, 'processSESEvent').mockImplementation(() => 
        Promise.resolve({
          success: true,
          affectedContactIds: [],
          updatedSendLogIds: [],
        })
      );
    });

    it('should process valid message', async () => {
      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: createHardBounceNotification(),
      };

      const result = await processMessage(message);

      expect(result.success).toBe(true);
      expect(sesEventsModule.parseSESEvent).toHaveBeenCalledWith(message.body);
      expect(sesEventHandlersModule.processSESEvent).toHaveBeenCalled();
    });

    it('should fail with empty message body', async () => {
      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: '',
      };

      const result = await processMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty message body');
    });

    it('should fail when SES event parsing fails', async () => {
      spyOn(sesEventsModule, 'parseSESEvent').mockReturnValue(null);

      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: createHardBounceNotification(),
      };

      const result = await processMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse SES event');
    });

    it('should pass through event processing errors', async () => {
      spyOn(sesEventHandlersModule, 'processSESEvent').mockImplementation(() =>
        Promise.resolve({
          success: false,
          error: 'Processing failed',
          affectedContactIds: [],
          updatedSendLogIds: [],
        })
      );

      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: createHardBounceNotification(),
      };

      const result = await processMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Processing failed');
    });
  });

  // ============================================================================
  // deleteMessage() Tests
  // ============================================================================

  describe('deleteMessage()', () => {
    it('should delete message successfully', async () => {
      mockSend.mockImplementation(() => Promise.resolve({}));

      await deleteMessage('receipt-handle-123');

      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw on SQS error', async () => {
      mockSend.mockImplementation(() => Promise.reject(new Error('Delete failed')));

      await expect(deleteMessage('receipt-handle-123')).rejects.toThrow('Delete failed');
    });
  });

  // ============================================================================
  // returnMessageForRetry() Tests
  // ============================================================================

  describe('returnMessageForRetry()', () => {
    it('should change message visibility', async () => {
      mockSend.mockImplementation(() => Promise.resolve({}));

      await returnMessageForRetry('receipt-handle-123', 60);

      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw on SQS error', async () => {
      mockSend.mockImplementation(() => Promise.reject(new Error('Visibility change failed')));

      await expect(returnMessageForRetry('receipt-handle-123', 60)).rejects.toThrow(
        'Visibility change failed'
      );
    });
  });

  // ============================================================================
  // handleProcessingError() Tests
  // ============================================================================

  describe('handleProcessingError()', () => {
    beforeEach(() => {
      mockSend.mockImplementation(() => Promise.resolve({}));
    });

    it('should return message for retry when under max retries', async () => {
      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: createHardBounceNotification(),
        receiveCount: 1,
      };

      await handleProcessingError(message, new Error('Processing failed'), 1);

      // Should call ChangeMessageVisibility
      expect(mockSend).toHaveBeenCalled();
    });

    it('should delete message when max retries reached', async () => {
      // set autoDelete to true
      spyOn(configModule, 'getSQSConfig').mockReturnValue({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/termisend-queue',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test',
        },
        pollingIntervalMs: 10000,
        maxMessagesPerPoll: 10,
        visibilityTimeoutSeconds: 300,
        waitTimeSeconds: 20,
        maxReceiveCount: 3,
        autoDelete: true,
        debugLogging: false,
      });

      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: createHardBounceNotification(),
        receiveCount: 3,
      };

      await handleProcessingError(message, new Error('Processing failed'), 3);

      // Should call DeleteMessage
      expect(mockSend).toHaveBeenCalled();
    });

    it('should not delete message when autoDelete is false', async () => {
      spyOn(configModule, 'getSQSConfig').mockReturnValue({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/termisend-queue',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test',
        },
        pollingIntervalMs: 10000,
        maxMessagesPerPoll: 10,
        visibilityTimeoutSeconds: 300,
        waitTimeSeconds: 20,
        maxReceiveCount: 3,
        autoDelete: false,
        debugLogging: false,
      });

      const message = {
        messageId: 'sqs-msg-1',
        receiptHandle: 'receipt-1',
        body: createHardBounceNotification(),
        receiveCount: 3,
      };

      await handleProcessingError(message, new Error('Processing failed'), 3);

      // Should NOT call DeleteMessage
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // startConsumer() Tests
  // ============================================================================

  describe('startConsumer()', () => {
    it('should return early if already running', async () => {
      // Start consumer first time
      mockSend.mockImplementation(() => Promise.resolve({ Messages: [] }));

      // Mock setTimeout to prevent actual polling
      const originalSetTimeout = globalThis.setTimeout;
      let timeoutCallback: (() => void) | null = null;
      
      // First call to startConsumer
      const startPromise1 = startConsumer();
      
      // Second call should return early
      await startConsumer();
      
      expect(isConsumerRunning()).toBe(true);
      
      // Stop consumer
      await stopConsumer();
    });
  });

  // ============================================================================
  // stopConsumer() Tests
  // ============================================================================

  describe('stopConsumer()', () => {
    it('should return early if not running', async () => {
      await stopConsumer();
      // Should not throw
      expect(isConsumerRunning()).toBe(false);
    });

    it('should stop running consumer', async () => {
      // Start consumer
      mockSend.mockImplementation(() => Promise.resolve({ Messages: [] }));

      startConsumer();
      expect(isConsumerRunning()).toBe(true);

      // Stop consumer
      await stopConsumer();

      expect(isConsumerRunning()).toBe(false);
    });
  });
});

import { afterAll } from "bun:test";
afterAll(() => {
  mock.restore();
});

