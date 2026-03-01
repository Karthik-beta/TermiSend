/**
 * Email Verifier module for TermiSend
 * Handles MyEmailVerifier API integration for email validation
 */

import { getEnv } from './config.js';
import { logger } from './logger.js';
import type { EmailVerificationResponse } from './types.js';

// ============================================================================
// Environment Configuration
// ============================================================================

const env = getEnv();

const API_KEY = process.env.MYEMAILVERIFIER_API_KEY || env.MYEMAILVERIFIER_API_KEY || '';
const API_BASE_URL = 'https://api.myemailverifier.com/v1';

// ============================================================================
// API Client
// ============================================================================

/**
 * Verify an email address using MyEmailVerifier API
 *
 * @param email - Email address to verify
 * @returns Verification response with status and risk level
 */
export async function verifyEmail(email: string): Promise<EmailVerificationResponse> {
  if (!API_KEY) {
    throw new Error('MYEMAILVERIFIER_API_KEY is not configured');
  }

  // Log the request
  await logger.logApiVerifierRequest(email);

  const url = new URL(`${API_BASE_URL}/verify`);
  url.searchParams.append('email', email);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as EmailVerificationResponse;

    // Log the response
    const responseData: Record<string, unknown> = { ...data };
    await logger.logApiVerifierResponse(email, responseData);

    return data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError('Email Verification API', errorMessage, { email });

    // Re-throw the error to allow caller to handle it appropriately
    throw new Error(`Email verification failed for ${email}: ${errorMessage}`);
  }
}

/**
 * Check if an email is safe to send to based on verification result
 *
 * @param result - Verification response from API
 * @returns boolean indicating if email is safe
 */
export function isEmailSafe(result: EmailVerificationResponse): boolean {
  // Safe to send if:
  // - Status is 'valid' and risk is 'low'
  // - Status is 'catch-all' and risk is 'low' or 'medium'

  if (result.status === 'valid' && result.risk === 'low') {
    return true;
  }

  if (result.status === 'catch-all' && (result.risk === 'low' || result.risk === 'medium')) {
    return true;
  }

  return false;
}

/**
 * Get human-readable verification status
 */
export function getVerificationStatusDescription(result: EmailVerificationResponse): string {
  const statusMap: Record<string, string> = {
    valid: '✓ Valid email address',
    invalid: '✗ Invalid email address',
    'catch-all': '⚠ Catch-all domain (accepts all emails)',
    unknown: '? Unable to verify email',
    role: '⚠ Role-based email (e.g., admin@, support@)',
    disposable: '✗ Disposable email address',
  };

  const riskMap: Record<string, string> = {
    low: 'Low risk',
    medium: 'Medium risk',
    high: 'High risk',
  };

  const statusDesc = statusMap[result.status] || `Unknown status: ${result.status}`;
  const riskDesc = riskMap[result.risk] || `Unknown risk: ${result.risk}`;

  return `${statusDesc} (${riskDesc})`;
}

// ============================================================================
// Bulk Verification (Optional)
// ============================================================================

/**
 * Verify multiple emails in sequence with rate limiting
 *
 * @param emails - Array of email addresses
 * @param delayMs - Delay between requests in milliseconds (default: 1000)
 * @returns Array of verification results
 */
export async function verifyEmailsBulk(
  emails: string[],
  delayMs: number = 1000
): Promise<Array<{ email: string; result: EmailVerificationResponse }>> {
  const results: Array<{ email: string; result: EmailVerificationResponse }> = [];

  for (const email of emails) {
    const result = await verifyEmail(email);
    results.push({ email, result });

    // Rate limiting delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
