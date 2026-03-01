/**
 * Email Verifier module for TermiSend
 * Handles MyEmailVerifier API integration for email validation
 */

import { getEnv } from './config.js';
import { logger } from './logger.js';
import type { EmailVerificationResponse } from './types.js';
import {
  RateLimiter,
  redactEmail,
  validateEmailFormat,
  validateEmailVerificationResponse,
} from './utils/security.js';

// ============================================================================
// Environment Configuration
// ============================================================================

const API_BASE_URL = 'https://api.myemailverifier.com/v1';

/**
 * Rate limiter for email verification API
 * Max 1 request per 5 seconds per email
 */
const verificationRateLimiter = new RateLimiter(5000, 1);

/**
 * Get API key dynamically (not cached)
 * This allows tests to change env vars between tests
 */
function getApiKey(): string {
  const env = getEnv();
  return process.env.MYEMAILVERIFIER_API_KEY || env.MYEMAILVERIFIER_API_KEY || '';
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Email validation error
 */
export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailValidationError';
  }
}

// ============================================================================
// API Client
// ============================================================================

/**
 * Verify an email address using MyEmailVerifier API
 *
 * @param email - Email address to verify
 * @returns Verification response with status and risk level
 * @throws RateLimitError if rate limit exceeded
 * @throws EmailValidationError if email format is invalid
 * @throws Error if API request fails
 */
export async function verifyEmail(email: string): Promise<EmailVerificationResponse> {
  // Validate email format before making API call
  const formatValidation = validateEmailFormat(email);
  if (!formatValidation.valid) {
    throw new EmailValidationError(formatValidation.error || 'Invalid email format');
  }

  // Check rate limit (per-email rate limiting)
  const rateLimitCheck = verificationRateLimiter.checkLimit(email.toLowerCase());
  if (!rateLimitCheck.allowed) {
    throw new RateLimitError(rateLimitCheck.retryAfterMs || 5000);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MYEMAILVERIFIER_API_KEY is not configured');
  }

  // Log the request (email is redacted inside logger)
  await logger.logApiVerifierRequest(email);

  const url = new URL(`${API_BASE_URL}/verify`);
  url.searchParams.append('email', email);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // Validate response with Zod schema (security: prevent blind type casts)
    const rawData: unknown = await response.json();
    const validatedData = validateEmailVerificationResponse(rawData);

    // Log the response (email is redacted inside logger)
    const responseData: Record<string, unknown> = { ...validatedData };
    await logger.logApiVerifierResponse(email, responseData);

    return validatedData;
  } catch (error) {
    // Don't log the full email in error messages (security)
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log error with redacted email
    await logger.logError('Email Verification API', errorMessage, {
      email: redactEmail(email),
    });

    // Re-throw the error to allow caller to handle it appropriately
    // Use redacted email in error message for security
    throw new Error(`Email verification failed for ${redactEmail(email)}: ${errorMessage}`);
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

/**
 * Verify multiple emails in bulk
 * Processes emails sequentially with rate limiting
 *
 * @param emails - Array of email addresses to verify
 * @returns Array of verification results with email and result/error
 */
export async function verifyEmailsBulk(
  emails: string[]
): Promise<Array<{ email: string; result?: EmailVerificationResponse; error?: string }>> {
  const results: Array<{ email: string; result?: EmailVerificationResponse; error?: string }> = [];

  for (const email of emails) {
    try {
      const result = await verifyEmail(email);
      results.push({ email: redactEmail(email), result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({ email: redactEmail(email), error: errorMessage });
    }
  }

  return results;
}
