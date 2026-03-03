/**
 * AWS SES Integration module for TermiSend
 * Handles sending emails via Amazon Simple Email Service
 */

import {
  type Body,
  type SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-ses';
import { getTestRecipientEmail, shouldRedirectEmails } from './config.js';
import {
  createEvent,
  DomainEventType,
  domainEvents,
  type SesApiCalledPayload,
} from './events/index.js';
import { logger } from './logger.js';
import { getSesClient, verifySesConfiguration } from './ses-quota.js';
import { isShuttingDown } from './shutdown.js';
import type { EmailThrottleController } from './throttle.js';
import { delay, getEmailThrottleController } from './throttle.js';
import type { EmailSendParams, EmailSendResult } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum retries for SES sending */
const MAX_SEND_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 1000;

/** Maximum delay for exponential backoff (ms) - 10 seconds */
const MAX_BACKOFF_DELAY_MS = 10000;

// Test-only variable for client override
let testClientOverride: SESClient | null = null;

// Test-only exports for dependency injection
export const __test = {
  setSesClient: (client: unknown) => {
    testClientOverride = client as SESClient;
  },
  reset: () => {
    testClientOverride = null;
  },
  get testClientOverride() {
    return testClientOverride;
  },
};

/**
 * Internal helper to get the SES client (allows for test overrides)
 */
function getClient(): SESClient {
  if (__test.testClientOverride) {
    return __test.testClientOverride;
  }
  return getSesClient();
}

// ============================================================================
// Environment Configuration
// ============================================================================

function getSESFromEmail(): string | undefined {
  return process.env.SES_FROM_EMAIL;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error is a throttling error from AWS SES
 */
function isThrottlingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { code?: string; name?: string };
  const code = err.code || err.name;
  return (
    code === 'Throttling' ||
    code === 'ThrottlingException' ||
    code === 'ProvisionedThroughputExceededException' ||
    code === 'RequestLimitExceeded'
  );
}

/**
 * Prepare message body for SendEmailCommand
 */
function prepareMessageBody(params: EmailSendParams): Body {
  const body: Body = {};

  if (params.htmlBody) {
    body.Html = {
      Data: params.htmlBody,
      Charset: 'UTF-8',
    };
  }

  if (params.textBody) {
    body.Text = {
      Data: params.textBody,
      Charset: 'UTF-8',
    };
  }

  return body;
}

/**
 * Construct the input for the SendEmailCommand
 */
function constructSendEmailInput(
  params: EmailSendParams,
  fromEmail: string
): SendEmailCommandInput {
  return {
    Source: fromEmail,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: params.subject, Charset: 'UTF-8' },
      Body: prepareMessageBody(params),
    },
  };
}

/**
 * Handles the retry logic for sending an email
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Retry logic needs complexity - refactoring risk outweighs benefit
async function sendWithRetry(
  sesClient: SESClient,
  input: SendEmailCommandInput,
  params: EmailSendParams,
  controller: EmailThrottleController
): Promise<EmailSendResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_SEND_RETRIES; attempt++) {
    // Check for shutdown before each retry attempt
    if (isShuttingDown()) {
      return { success: false, error: 'Shutdown requested' };
    }

    const canSend = await controller.checkQuota();
    if (!canSend) {
      return { success: false, error: 'SES quota exhaustion' };
    }

    await controller.acquireSendPermission();

    const apiCallStartTime = Date.now();
    let apiCallSuccess = false;
    let apiCallError: string | undefined;
    let requestId: string | undefined;

    try {
      if (attempt === 0) {
        await logger.logAwsSesRequest(params.to, { from: input.Source, subject: params.subject });
      }

      const response = await sesClient.send(new SendEmailCommand(input));
      if (!response.MessageId) {
        throw new Error('No MessageId returned');
      }

      apiCallSuccess = true;
      requestId = response.MessageId;

      await logger.logAwsSesResponse(params.to, response.MessageId);

      // Emit SES_API_CALLED event (fire-and-forget)
      const apiCallDuration = Date.now() - apiCallStartTime;
      try {
        const event = createEvent<SesApiCalledPayload>(DomainEventType.SES_API_CALLED, {
          apiEndpoint: 'SendEmail',
          durationMs: apiCallDuration,
          success: apiCallSuccess,
          requestId,
        });
        domainEvents.emit(event);
      } catch {
        // Silently ignore event emission errors
      }

      return { success: true, messageId: response.MessageId };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      apiCallError = lastError.message;

      // Emit SES_API_CALLED event for failed call (fire-and-forget)
      const apiCallDuration = Date.now() - apiCallStartTime;
      try {
        const event = createEvent<SesApiCalledPayload>(DomainEventType.SES_API_CALLED, {
          apiEndpoint: 'SendEmail',
          durationMs: apiCallDuration,
          success: false,
          error: apiCallError,
        });
        domainEvents.emit(event);
      } catch {
        // Silently ignore event emission errors
      }

      if (isThrottlingError(error) && attempt < MAX_SEND_RETRIES) {
        // Check for shutdown before retry delay
        if (isShuttingDown()) {
          return { success: false, error: 'Shutdown requested' };
        }

        const rawBackoffMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
        const backoffMs = Math.min(rawBackoffMs, MAX_BACKOFF_DELAY_MS);
        await logger.warn(`Throttling, retrying in ${backoffMs}ms: ${lastError.message}`);

        controller.releaseSendPermission();
        await delay(backoffMs);
        continue;
      }

      await logger.logError('AWS SES Send', lastError.message, {
        to: params.to,
        attempt: attempt + 1,
      });
      return { success: false, error: lastError.message };
    } finally {
      controller.releaseSendPermission();
    }
  }

  return { success: false, error: lastError?.message || 'Max retries' };
}

// ============================================================================
// Email Sending
// ============================================================================

/**
 * Send an email via AWS SES with retries and throttling
 */
export function sendEmail(
  params: EmailSendParams,
  controller: EmailThrottleController = getEmailThrottleController(),
  providedSesClient?: SESClient
): Promise<EmailSendResult> {
  const sesClient = providedSesClient || getClient();
  const sesFromEmail = getSESFromEmail();

  if (!sesFromEmail) {
    return Promise.resolve({ success: false, error: 'SES_FROM_EMAIL not configured' });
  }
  if (!params.to || !params.subject) {
    return Promise.resolve({ success: false, error: 'Missing parameters' });
  }

  // Handle environment-based redirection
  let finalTo = params.to;
  let finalSubject = params.subject;

  if (shouldRedirectEmails()) {
    try {
      finalTo = getTestRecipientEmail();
      finalSubject = `[DEV: ${params.to}] ${params.subject}`;
    } catch (error) {
      return Promise.resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Redirection error',
      });
    }
  }

  const sendEmailInput = constructSendEmailInput(
    {
      ...params,
      to: finalTo,
      subject: finalSubject,
    },
    sesFromEmail
  );
  return sendWithRetry(sesClient, sendEmailInput, params, controller);
}

/**
 * Send a test email
 */
export function sendTestEmail(testEmail: string): Promise<EmailSendResult> {
  return sendEmail({
    to: testEmail,
    subject: 'TermiSend - Test Email',
    htmlBody: '<h1>Test Working!</h1>',
    textBody: 'Test Working!',
  });
}

/**
 * Verify AWS SES configuration
 */
export function verifyConfiguration() {
  const sesFromEmail = getSESFromEmail();
  const quotaConfig = verifySesConfiguration();
  const issues = [...quotaConfig.issues];
  if (!sesFromEmail) {
    issues.push('SES_FROM_EMAIL is not configured');
  }

  return {
    configured: issues.length === 0,
    region: quotaConfig.region,
    fromEmail: sesFromEmail || '',
    hasCredentials: quotaConfig.hasCredentials,
    issues,
  };
}
