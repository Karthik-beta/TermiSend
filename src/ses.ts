/**
 * AWS SES Integration module for TermiSend
 * Handles sending emails via Amazon Simple Email Service
 */

import {
  type SESClient,
  SendRawEmailCommand,
  type SendRawEmailCommandInput,
} from '@aws-sdk/client-ses';
import {
  getAnalyticsConfig,
  getSESConfigurationSetName,
  getTestRecipientEmail,
  isListUnsubscribeEnabled,
  shouldRedirectEmails,
} from './config.js';
import {
  createEvent,
  DomainEventType,
  domainEvents,
  type SesApiCalledPayload,
} from './events/index.js';
import { logger } from './logger.js';
import { getSesClient, verifySesConfiguration } from './ses-quota.js';
import { getShutdownSignal, isShuttingDown } from './shutdown.js';
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
let hasWarnedMissingAnalyticsConfigSet = false;

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

function getSESFromName(): string | undefined {
  return process.env.SES_FROM_NAME;
}

/**
 * Format the From address with optional display name per RFC 5322
 * e.g. "Karthik" <karthik@pivotr.in> or just karthik@pivotr.in
 */
function formatFromAddress(email: string): string {
  const name = getSESFromName();
  if (name) {
    // RFC 5322: use quoted display name to handle special characters
    const safeName = name.replace(/"/g, '\\"');
    return `"${safeName}" <${email}>`;
  }
  return email;
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
  const err = error as {
    code?: string;
    name?: string;
    // biome-ignore lint/style/useNamingConvention: AWS SDK uses this property name
    $metadata?: { httpStatusCode?: number };
  };
  const errorIdentifier = err.name || err.code;

  // Check for explicit throttling error names
  const isThrottlingName =
    errorIdentifier === 'Throttling' ||
    errorIdentifier === 'ThrottlingException' ||
    errorIdentifier === 'TooManyRequestsException' ||
    errorIdentifier === 'ProvisionedThroughputExceededException' ||
    errorIdentifier === 'RequestLimitExceeded';

  // Also check for HTTP 429 status code
  const isHttp429 = err.$metadata?.httpStatusCode === 429;

  return isThrottlingName || isHttp429;
}

/**
 * Build a raw MIME message for SendRawEmailCommand.
 * This allows setting custom headers like List-Unsubscribe
 * which are not supported by SendEmailCommand.
 */
function buildRawMimeMessage(params: EmailSendParams, fromEmail: string): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const formattedFrom = formatFromAddress(fromEmail);

  const headers = [
    `From: ${formattedFrom}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
  ];

  if (isListUnsubscribeEnabled()) {
    headers.push(
      `List-Unsubscribe: <mailto:${fromEmail}?subject=unsubscribe%20-%20${encodeURIComponent(params.to)}>`,
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click'
    );
  }

  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const parts: string[] = [];

  // Plain text part
  if (params.textBody) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      params.textBody
    );
  }

  // HTML part
  if (params.htmlBody) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      params.htmlBody
    );
  }

  parts.push(`--${boundary}--`);

  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

/**
 * Construct the input for SendRawEmailCommand
 */
function constructSendRawEmailInput(
  params: EmailSendParams,
  fromEmail: string
): SendRawEmailCommandInput {
  const rawMessage = buildRawMimeMessage(params, fromEmail);
  const input: SendRawEmailCommandInput = {
    RawMessage: {
      Data: new TextEncoder().encode(rawMessage),
    },
  };

  const configurationSetName = getSESConfigurationSetName();
  if (configurationSetName) {
    input.ConfigurationSetName = configurationSetName;
  }

  return input;
}

/**
 * Handles the retry logic for sending an email
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Retry logic needs complexity - refactoring risk outweighs benefit
async function sendWithRetry(
  sesClient: SESClient,
  input: SendRawEmailCommandInput,
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
        await logger.logAwsSesRequest(params.to, { subject: params.subject });
      }

      const response = await sesClient.send(new SendRawEmailCommand(input));
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
        await delay(backoffMs, getShutdownSignal());
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

  if (
    getAnalyticsConfig().enabled &&
    !getSESConfigurationSetName() &&
    !hasWarnedMissingAnalyticsConfigSet
  ) {
    hasWarnedMissingAnalyticsConfigSet = true;
    logger
      .warn(
        'SES analytics is enabled but SES_CONFIGURATION_SET is not configured. Delivery, bounce, complaint, open, and click events will not be published for SendRawEmail traffic.'
      )
      .catch(() => {
        // Ignore logging errors
      });
  }

  // Handle environment-based redirection
  let finalTo = params.to;
  let finalSubject = params.subject;

  if (shouldRedirectEmails()) {
    try {
      finalTo = getTestRecipientEmail();
      finalSubject = params.subject;
    } catch (error) {
      return Promise.resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Redirection error',
      });
    }
  }

  const sendEmailInput = constructSendRawEmailInput(
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
  const analyticsConfig = getAnalyticsConfig();
  const configurationSetName = getSESConfigurationSetName();
  if (!sesFromEmail) {
    issues.push('SES_FROM_EMAIL is not configured');
  }
  if (analyticsConfig.enabled && !configurationSetName) {
    issues.push(
      'SES_CONFIGURATION_SET is not configured. SES event publishing analytics will be incomplete for SendRawEmail traffic.'
    );
  }

  return {
    configured: issues.length === 0,
    region: quotaConfig.region,
    fromEmail: sesFromEmail || '',
    configurationSetName: configurationSetName || '',
    hasCredentials: quotaConfig.hasCredentials,
    issues,
  };
}
