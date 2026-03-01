/**
 * AWS SES Integration module for TermiSend
 * Handles sending emails via Amazon Simple Email Service
 */

import { SESClient, SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-ses';
import { getEnv } from './config.js';
import { logger } from './logger.js';
import type { EmailSendParams, EmailSendResult } from './types.js';

// ============================================================================
// Environment Configuration
// ============================================================================

const env = getEnv();

const AWS_REGION = process.env.AWS_REGION || env.AWS_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || env.SES_FROM_EMAIL;

// ============================================================================
// SES Client Setup
// ============================================================================

let sesClient: SESClient | null = null;

/**
 * Get or create SES client with lazy initialization
 */
function getSesClient(): SESClient {
  if (!sesClient) {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      throw new Error(
        'AWS credentials are not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in environment variables or .env file.'
      );
    }
    sesClient = new SESClient({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return sesClient;
}

// ============================================================================
// Email Sending
// ============================================================================

/**
 * Send an email via AWS SES
 *
 * @param params - Email parameters including recipient, subject, and body
 * @returns Result of the send operation
 */
export async function sendEmail(params: EmailSendParams): Promise<EmailSendResult> {
  // Validate required configuration
  if (!SES_FROM_EMAIL) {
    return {
      success: false,
      error: 'SES_FROM_EMAIL is not configured',
    };
  }

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return {
      success: false,
      error: 'AWS credentials are not configured',
    };
  }

  // Validate email parameters
  if (!params.to || !params.subject) {
    return {
      success: false,
      error: 'Missing required parameters: to, subject',
    };
  }

  // Log the request (excluding full body content for privacy)
  await logger.logAwsSesRequest(params.to, {
    from: SES_FROM_EMAIL,
    subject: params.subject,
    hasHtmlBody: !!params.htmlBody,
    hasTextBody: !!params.textBody,
  });

  // Build message body conditionally
  const htmlPart = params.htmlBody
    ? {
        Data: params.htmlBody,
        Charset: 'UTF-8' as const,
      }
    : undefined;

  const textPart = params.textBody
    ? {
        Data: params.textBody,
        Charset: 'UTF-8' as const,
      }
    : undefined;

  const body: Record<string, unknown> = {};
  if (htmlPart) {
    body.Html = htmlPart;
  }
  if (textPart) {
    body.Text = textPart;
  }

  const sendEmailInput: SendEmailCommandInput = {
    Source: SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [params.to],
    },
    Message: {
      Subject: {
        Data: params.subject,
        Charset: 'UTF-8',
      },
      Body: body,
    },
  };

  try {
    const command = new SendEmailCommand(sendEmailInput);
    const response = await getSesClient().send(command);

    const messageId = response.MessageId;

    if (!messageId) {
      throw new Error('No MessageId returned from SES');
    }

    // Log the response
    await logger.logAwsSesResponse(params.to, messageId);

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logger.logError('AWS SES Send', errorMessage, {
      to: params.to,
      subject: params.subject,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send a test email to verify SES configuration
 *
 * @param testEmail - Email address to send test to
 * @returns Result of the test send
 */
export function sendTestEmail(testEmail: string): Promise<EmailSendResult> {
  const testParams: EmailSendParams = {
    to: testEmail,
    subject: 'TermiSend - Test Email',
    htmlBody: `
      <html>
        <body>
          <h1>TermiSend Test Email</h1>
          <p>This is a test email from TermiSend to verify your SES configuration.</p>
          <p>If you received this, your AWS SES integration is working correctly!</p>
        </body>
      </html>
    `,
    textBody:
      'TermiSend Test Email\n\nThis is a test email from TermiSend to verify your SES configuration.\nIf you received this, your AWS SES integration is working correctly!',
  };

  return sendEmail(testParams);
}

/**
 * Verify AWS SES configuration
 *
 * @returns Object with configuration status
 */
export function verifyConfiguration(): {
  configured: boolean;
  region: string;
  fromEmail: string;
  hasCredentials: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!SES_FROM_EMAIL) {
    issues.push('SES_FROM_EMAIL is not configured');
  }

  if (!AWS_ACCESS_KEY_ID) {
    issues.push('AWS_ACCESS_KEY_ID is not configured');
  }

  if (!AWS_SECRET_ACCESS_KEY) {
    issues.push('AWS_SECRET_ACCESS_KEY is not configured');
  }

  return {
    configured: issues.length === 0,
    region: AWS_REGION,
    fromEmail: SES_FROM_EMAIL || '',
    hasCredentials: !!AWS_ACCESS_KEY_ID && !!AWS_SECRET_ACCESS_KEY,
    issues,
  };
}

// ============================================================================
// SES Account Info (Optional)
// ============================================================================

/**
 * Get SES account sending limits and statistics
 * Note: This requires additional IAM permissions
 */
export async function getAccountInfo(): Promise<{
  success: boolean;
  sendQuota?: {
    max24HourSend: number;
    maxSendRate: number;
    sentLast24Hours: number;
  };
  error?: string;
}> {
  try {
    const { GetSendQuotaCommand } = await import('@aws-sdk/client-ses');
    const command = new GetSendQuotaCommand({});
    const response = await getSesClient().send(command);

    return {
      success: true,
      sendQuota: {
        max24HourSend: response.Max24HourSend || 0,
        maxSendRate: response.MaxSendRate || 0,
        sentLast24Hours: response.SentLast24Hours || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
