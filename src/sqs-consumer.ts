/**
 * SQS Consumer Module for TermiSend
 * Polls SQS queue for SES events and dispatches to handlers
 */

import type { Message, SQSClientConfig } from '@aws-sdk/client-sqs';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { getSQSConfig } from './config.js';
import { logger } from './logger.js';
import { processSESEvent } from './ses-event-handlers.js';
import { parseSESEventMessage } from './ses-events.js';
import { isShuttingDown } from './shutdown.js';
import type { EventProcessingResult, SQSConsumerStatus, SQSMessage } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Delay before retrying failed messages (seconds) */
const RETRY_VISIBILITY_TIMEOUT_SECONDS = 60;

// ============================================================================
// SQS Client Setup
// ============================================================================

let sqsClient: SQSClient | null = null;

/**
 * Get or create SQS client with lazy initialization
 * Creates a singleton SQS client instance
 * @throws Error if SQS is not configured (getSQSConfig() returns null)
 */
export function getSQSClient(): SQSClient {
  if (!sqsClient) {
    const config = getSQSConfig();

    if (!config) {
      throw new Error('SQS is not configured. Set SQS_QUEUE_URL and AWS credentials.');
    }

    const clientConfig: SQSClientConfig = {
      region: config.region,
      credentials: config.credentials,
    };

    sqsClient = new SQSClient(clientConfig);

    logger.info('SQS client initialized').catch(() => {
      // Silently ignore logging errors
    });
  }
  return sqsClient;
}

/**
 * Reset the SQS client (for testing purposes only)
 * @internal
 */
export function resetSQSClient(): void {
  sqsClient = null;
}

// ============================================================================
// Consumer State
// ============================================================================

let isRunning = false;
let sleepTimeout: NodeJS.Timeout | null = null;
let sleepResolve: (() => void) | null = null;
const consumerStatus: SQSConsumerStatus = {
  isRunning: false,
  messagesProcessed: 0,
  messagesFailed: 0,
  lastPollAt: undefined,
  lastError: undefined,
  inFlightCount: 0,
};

/**
 * Get current consumer status
 * @returns Copy of current status
 */
export function getConsumerStatus(): SQSConsumerStatus {
  return { ...consumerStatus };
}

// ============================================================================
// Consumer Control
// ============================================================================

/**
 * Start the SQS consumer polling loop
 * Runs indefinitely until stopConsumer() is called or shutdown signal received
 * @returns Promise that resolves when consumer stops
 */
export async function startConsumer(): Promise<void> {
  if (isRunning) {
    logger.warn('SQS consumer is already running').catch((e) => console.error('Log failed:', e));
    return;
  }

  // Set isRunning synchronously to prevent race conditions when called concurrently
  isRunning = true;
  consumerStatus.isRunning = true;

  const config = getSQSConfig();

  if (!config) {
    isRunning = false;
    consumerStatus.isRunning = false;
    logger
      .info('SQS consumer disabled: configuration not present')
      .catch((e) => console.error('Log failed:', e));
    return;
  }

  logger.info('Starting SQS consumer').catch((e) => console.error('Log failed:', e));

  try {
    while (isRunning && !isShuttingDown()) {
      try {
        await pollAndProcessMessages();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger
          .warn(`Error in polling loop: ${errorMessage}`)
          .catch((e) => console.error('Log failed:', e));
        consumerStatus.lastError = errorMessage;
      }

      // Exit immediately if stop was requested during processing
      if (!isRunning || isShuttingDown()) {
        break;
      }

      // Wait before next poll to avoid tight loops
      await sleep(config.pollingIntervalMs);

      // Check shutdown immediately after sleep to exit faster
      if (!isRunning || isShuttingDown()) {
        break;
      }
    }
  } finally {
    isRunning = false;
    consumerStatus.isRunning = false;
    logger.info('SQS consumer stopped').catch((e) => console.error('Log failed:', e));
  }
}

/**
 * Stop the SQS consumer gracefully
 * Waits for in-flight messages to complete before returning
 */
export async function stopConsumer(): Promise<void> {
  if (!isRunning) {
    return;
  }

  logger.info('Stopping SQS consumer...').catch((e) => console.error('Log failed:', e));
  isRunning = false;

  // Clear any pending timeouts
  if (sleepTimeout) {
    clearTimeout(sleepTimeout);
    sleepTimeout = null;
  }
  if (sleepResolve) {
    sleepResolve();
    sleepResolve = null;
  }

  // Wait for in-flight messages to complete (with timeout)
  // This is a best-effort wait - we give active messages up to 30 seconds to complete
  const maxWaitMs = 30000; // 30 seconds
  const startTime = Date.now();

  while (consumerStatus.inFlightCount > 0 && Date.now() - startTime < maxWaitMs) {
    await sleep(100);
  }

  if (consumerStatus.inFlightCount > 0) {
    logger
      .warn(
        `Shutdown timeout reached with ${consumerStatus.inFlightCount} in-flight messages still incomplete`
      )
      .catch((e) => console.error('Log failed:', e));
  }

  consumerStatus.isRunning = false;
}

/**
 * Check if the consumer is currently running
 */
export function isConsumerRunning(): boolean {
  return isRunning;
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Poll SQS queue for new messages and process them
 * @returns Number of messages successfully processed
 */
async function pollAndProcessMessages(): Promise<number> {
  const messages = await pollMessages();

  if (messages.length === 0) {
    return 0;
  }

  consumerStatus.inFlightCount += messages.length;

  try {
    // Process messages sequentially
    let successCount = 0;
    let messageIndex = 0;
    for (const message of messages) {
      messageIndex++;
      try {
        const result = await processMessage(message);

        if (result.success) {
          successCount++;
          consumerStatus.messagesProcessed++;

          // Delete message after successful processing
          const config = getSQSConfig();
          if (config?.autoDelete) {
            await deleteMessage(message.receiptHandle);
          }
        } else {
          if (result.nonRetryable) {
            await handlePermanentProcessingFailure(
              message,
              new Error(result.error || 'Unknown error')
            );
          } else {
            const receiveCount = getReceiveCount(message);
            await handleProcessingError(
              message,
              new Error(result.error || 'Unknown error'),
              receiveCount
            );
          }
        }
      } catch (error) {
        const receiveCount = getReceiveCount(message);
        await handleProcessingError(
          message,
          error instanceof Error ? error : new Error(String(error)),
          receiveCount
        );
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger
          .warn(`Message ${messageIndex} failed with error: ${errorMessage}`)
          .catch((e) => console.error('Log failed:', e));
      }
    }

    return successCount;
  } finally {
    consumerStatus.inFlightCount -= messages.length;
  }
}

/**
 * Poll SQS queue for new messages
 * @returns Array of messages received (empty if none)
 */
export async function pollMessages(): Promise<SQSMessage[]> {
  const config = getSQSConfig();
  if (!config) {
    throw new Error('SQS is not configured');
  }
  const client = getSQSClient();

  const command = new ReceiveMessageCommand({
    QueueUrl: config.queueUrl,
    MaxNumberOfMessages: config.maxMessagesPerPoll,
    VisibilityTimeout: config.visibilityTimeoutSeconds,
    WaitTimeSeconds: config.waitTimeSeconds,
    AttributeNames: ['All'],
    MessageAttributeNames: ['All'],
  });

  consumerStatus.lastPollAt = new Date();

  const response = await client.send(command);

  if (!response.Messages || response.Messages.length === 0) {
    return [];
  }

  if (config.debugLogging) {
    logger
      .info(`Received ${response.Messages.length} messages from SQS`)
      .catch((e) => console.error('Log failed:', e));
  }

  // Transform AWS SDK messages to our SQSMessage format
  return response.Messages.map(
    (msg: Message): SQSMessage => ({
      messageId: msg.MessageId || '',
      receiptHandle: msg.ReceiptHandle || '',
      body: msg.Body || '',
      attributes: msg.Attributes as Record<string, string> | undefined,
      messageAttributes: msg.MessageAttributes as
        | Record<string, { stringValue?: string; dataType: string }>
        | undefined,
      receiveCount: msg.Attributes?.ApproximateReceiveCount
        ? Number.parseInt(msg.Attributes.ApproximateReceiveCount, 10)
        : undefined,
      sentTimestamp: msg.Attributes?.SentTimestamp,
    })
  );
}

/**
 * Process a single SQS message
 * Parses SNS notification, extracts SES event, routes to handler
 * @param message - SQS message from queue
 * @returns Processing result
 */
export async function processMessage(message: SQSMessage): Promise<EventProcessingResult> {
  if (!message.body) {
    return {
      success: false,
      error: 'Empty message body',
      nonRetryable: true,
      affectedContactIds: [],
      updatedSendLogIds: [],
    };
  }

  const parseResult = parseSESEventMessage(message.body);

  if (parseResult.kind === 'skip') {
    logger.info(parseResult.reason).catch((e) => console.error('Log failed:', e));
    return {
      success: false,
      error: parseResult.reason,
      nonRetryable: true,
      affectedContactIds: [],
      updatedSendLogIds: [],
    };
  }

  if (parseResult.kind === 'invalid') {
    return {
      success: false,
      error: parseResult.reason,
      nonRetryable: true,
      affectedContactIds: [],
      updatedSendLogIds: [],
    };
  }

  return await processSESEvent(parseResult.event);
}

/**
 * Delete a processed message from the queue
 * @param receiptHandle - Message receipt handle
 */
export async function deleteMessage(receiptHandle: string): Promise<void> {
  const config = getSQSConfig();
  if (!config) {
    throw new Error('SQS is not configured');
  }
  const client = getSQSClient();

  const command = new DeleteMessageCommand({
    QueueUrl: config.queueUrl,
    ReceiptHandle: receiptHandle,
  });

  await client.send(command);

  if (config.debugLogging) {
    logger.info('Deleted message from SQS').catch((e) => console.error('Log failed:', e));
  }
}

/**
 * Return message to queue for retry with visibility timeout
 * @param receiptHandle - Message receipt handle
 * @param seconds - Visibility timeout seconds
 */
export async function returnMessageForRetry(receiptHandle: string, seconds: number): Promise<void> {
  const config = getSQSConfig();
  if (!config) {
    throw new Error('SQS is not configured');
  }
  const client = getSQSClient();

  const command = new ChangeMessageVisibilityCommand({
    QueueUrl: config.queueUrl,
    ReceiptHandle: receiptHandle,
    VisibilityTimeout: seconds,
  });

  await client.send(command);

  if (config.debugLogging) {
    logger
      .info(`Returned message for retry in ${seconds}s`)
      .catch((e) => console.error('Log failed:', e));
  }
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Handle processing error with retry logic
 * Deletes message if max retries reached, otherwise returns to queue
 * @param message - Original SQS message
 * @param error - Error that occurred
 * @param receiveCount - Number of times message has been received
 */
export async function handleProcessingError(
  message: SQSMessage,
  error: Error,
  receiveCount: number
): Promise<void> {
  const config = getSQSConfig();
  if (!config) {
    throw new Error('SQS is not configured');
  }

  // Cache config and assert non-null for the rest of the function
  const sqsConfig = config;

  consumerStatus.messagesFailed++;
  consumerStatus.lastError = error.message;

  logger
    .warn(`Message processing failed (attempt ${receiveCount}): ${error.message}`)
    .catch((e) => console.error('Log failed:', e));

  if (receiveCount >= sqsConfig.maxReceiveCount) {
    // Max retries reached - delete message (will go to DLQ if configured)
    logger
      .warn(`Max retries (${sqsConfig.maxReceiveCount}) reached, deleting message`)
      .catch((e) => console.error('Log failed:', e));

    if (sqsConfig.autoDelete) {
      await deleteMessage(message.receiptHandle);
    }
  } else {
    // Return to queue for retry
    await returnMessageForRetry(message.receiptHandle, RETRY_VISIBILITY_TIMEOUT_SECONDS);
  }
}

async function handlePermanentProcessingFailure(message: SQSMessage, error: Error): Promise<void> {
  const config = getSQSConfig();
  if (!config) {
    throw new Error('SQS is not configured');
  }

  consumerStatus.messagesFailed++;
  consumerStatus.lastError = error.message;

  logger
    .warn(`Dropping non-retryable SQS message: ${error.message}`)
    .catch((e) => console.error('Log failed:', e));

  if (config.autoDelete) {
    await deleteMessage(message.receiptHandle);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get receive count from message attributes
 * @param message - SQS message
 * @returns Number of times message has been received
 */
function getReceiveCount(message: SQSMessage): number {
  if (message.receiveCount !== undefined) {
    return message.receiveCount;
  }

  // Try to get from attributes
  const countStr = message.attributes?.ApproximateReceiveCount;
  if (countStr) {
    return Number.parseInt(countStr, 10);
  }

  return 1;
}

/**
 * Sleep for specified milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after ms milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepResolve = resolve;
    sleepTimeout = setTimeout(() => {
      sleepTimeout = null;
      sleepResolve = null;
      resolve();
    }, ms);
    // Unref the timeout so it doesn't prevent Node.js from exiting (memory leak prevention)
    if (sleepTimeout?.unref) {
      sleepTimeout.unref();
    }
  });
}
