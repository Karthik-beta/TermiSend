/**
 * AWS SES Quota and Client Module for TermiSend
 * Isolated module to prevent circular dependencies
 * This module handles SES client creation and quota fetching
 */

import { type GetSendQuotaCommandOutput, SESClient } from '@aws-sdk/client-ses';
import { logger } from './logger.js';
import type { QuotaStatus } from './types.js';

// ============================================================================
// Environment Configuration (Dynamic)
// ============================================================================

function getAWSRegion(): string {
  return process.env.AWS_REGION || 'us-east-1';
}

function getAWSAccessKeyId(): string | undefined {
  return process.env.AWS_ACCESS_KEY_ID;
}

function getAWSSecretAccessKey(): string | undefined {
  return process.env.AWS_SECRET_ACCESS_KEY;
}

// ============================================================================
// SES Client Setup with Lazy Initialization
// ============================================================================

let sesClient: SESClient | null = null;

/**
 * Get or create SES client with lazy initialization
 * Creates a singleton SES client instance
 */
export function getSesClient(): SESClient {
  if (!sesClient) {
    const awsAccessKeyId = getAWSAccessKeyId();
    const awsSecretAccessKey = getAWSSecretAccessKey();

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      throw new Error(
        'AWS credentials are not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in environment variables or .env file.'
      );
    }

    sesClient = new SESClient({
      region: getAWSRegion(),
      credentials: {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
    });

    logger.info('SES client initialized').catch(() => {
      // Silently ignore logging errors
    });
  }
  return sesClient;
}

/**
 * Close the SES client connection
 * Call this during application shutdown for proper cleanup
 */
export async function closeSesClient(): Promise<void> {
  if (sesClient) {
    try {
      // SESClient doesn't have an explicit close method in AWS SDK v3
      // The client will be garbage collected when no longer referenced
      // We just clear our reference to allow cleanup
      sesClient = null;

      await logger.info('SES client closed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await logger.warn(`Error closing SES client: ${errorMessage}`);
    }
  }
}

/**
 * Reset the SES client (for testing purposes only)
 * @internal
 */
export function resetSesClient(): void {
  sesClient = null;
}

// ============================================================================
// SES Account Info and Quota
// ============================================================================

/**
 * Get SES account sending limits and statistics
 * Note: This requires additional IAM permissions
 *
 * @returns Object with success status and quota information
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
    const response: GetSendQuotaCommandOutput = await getSesClient().send(command);

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

/**
 * Fetch quota status from AWS SES
 * Used by QuotaMonitor in throttle.ts
 *
 * @returns QuotaStatus object or null if fetch fails
 */
export async function fetchQuotaStatus(): Promise<QuotaStatus | null> {
  try {
    const result = await getAccountInfo();

    if (!result.success || !result.sendQuota) {
      await logger.warn('Failed to fetch SES quota status');
      return null;
    }

    const { max24HourSend, maxSendRate, sentLast24Hours } = result.sendQuota;
    const remainingQuota = max24HourSend - sentLast24Hours;

    return {
      max24HourSend,
      maxSendRate,
      sentLast24Hours,
      remainingQuota,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.warn(`Error fetching quota status: ${errorMessage}`);
    return null;
  }
}

/**
 * Verify AWS SES configuration
 * Checks if required environment variables are set
 *
 * @returns Object with configuration status
 */
export function verifySesConfiguration(): {
  configured: boolean;
  region: string;
  hasCredentials: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const awsAccessKeyId = getAWSAccessKeyId();
  const awsSecretAccessKey = getAWSSecretAccessKey();

  if (!awsAccessKeyId) {
    issues.push('AWS_ACCESS_KEY_ID is not configured');
  }

  if (!awsSecretAccessKey) {
    issues.push('AWS_SECRET_ACCESS_KEY is not configured');
  }

  return {
    configured: issues.length === 0,
    region: getAWSRegion(),
    hasCredentials: !!awsAccessKeyId && !!awsSecretAccessKey,
    issues,
  };
}
