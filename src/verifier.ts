/**
 * Email Verifier module for TermiSend
 * Handles MyEmailVerifier API integration for email validation
 */

import {
  getAllowedVerificationOutcomes,
  getEnv,
  shouldBypassVerifierApi,
  shouldSimulateVerifier,
} from './config.js';
import { updateEmailVerifierCredits } from './db.js';
import {
  createEvent,
  DomainEventType,
  domainEvents,
  type VerifierApiCalledPayload,
} from './events/index.js';
import { logger } from './logger.js';
import { delay } from './throttle.js';
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

const API_BASE_URL = 'https://api.myemailverifier.com/api';

/**
 * Rate limiter for email verification API
 * Max 1 request per 5 seconds per email
 */
const verificationRateLimiter = new RateLimiter(5000, 1);

// ============================================================================
// Credits Update Error Tracking
// ============================================================================

/**
 * Maximum number of retry attempts for credits update failures
 */
const MAX_CREDITS_UPDATE_RETRIES = 3;

/**
 * Counter for consecutive credits update failures
 * Used to detect persistent issues with credits API
 */
let creditsUpdateFailureCount = 0;

/**
 * Flag indicating if credits updates are consistently failing
 * Can be checked by monitoring/alerting systems
 */
export let isCreditsUpdateFailing = false;

/**
 * Reset the credits update failure tracking
 * Call this after successful recovery or manual intervention
 */
export function resetCreditsUpdateFailureTracking(): void {
  creditsUpdateFailureCount = 0;
  isCreditsUpdateFailing = false;
}

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
// Simulation (Development Mode)
// ============================================================================

/**
 * Simulate MyEmailVerifier API response for development
 */
async function simulateVerifyEmail(email: string): Promise<EmailVerificationResponse> {
  const lowEmail = email.toLowerCase();
  await delay(100); // Simulate network delay

  if (lowEmail.includes('invalid')) {
    return { status: 'invalid', risk: 'high', message: 'Simulated: Address does not exist' };
  }
  if (lowEmail.includes('catchall')) {
    return { status: 'catch-all', risk: 'medium', message: 'Simulated: Catch-all domain' };
  }
  if (lowEmail.includes('unknown')) {
    return { status: 'unknown', risk: 'medium', message: 'Simulated: Unable to verify' };
  }
  if (lowEmail.includes('role')) {
    return { status: 'role', risk: 'low', message: 'Simulated: Role-based address' };
  }
  if (lowEmail.includes('disposable')) {
    return { status: 'disposable', risk: 'high', message: 'Simulated: Disposable address' };
  }

  // Default to valid for other addresses
  return { status: 'valid', risk: 'low', message: 'Simulated: Valid email address' };
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

  // Explicit bypass for experiments in any environment.
  if (shouldBypassVerifierApi()) {
    await logger.info(`BYPASS: Skipping MyEmailVerifier API for ${redactEmail(email)}`);
    const simulatedResponse = await simulateVerifyEmail(email);
    await logger.logApiVerifierResponse(email, simulatedResponse);
    return simulatedResponse;
  }

  // Handle simulation in development
  if (shouldSimulateVerifier()) {
    await logger.info(`SIMULATION: Verifying email ${redactEmail(email)}`);
    const simulatedResponse = await simulateVerifyEmail(email);
    await logger.logApiVerifierResponse(email, simulatedResponse);
    return simulatedResponse;
  }

  let apiCallSuccess = false;
  let apiCallError: string | undefined;

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MYEMAILVERIFIER_API_KEY is not configured');
  }

  // Log the request (email is redacted inside logger)
  await logger.logApiVerifierRequest(email);

  // New API uses .php endpoint with query parameters
  const url = new URL(`${API_BASE_URL}/validate_single.php`);
  url.searchParams.append('apikey', apiKey);
  url.searchParams.append('email', email);

  const apiCallStartTime = Date.now();

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
      apiCallError = `API request failed: ${response.status} ${response.statusText}`;
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // Validate and map response (security: prevent blind type casts)
    const rawData = (await response.json()) as Record<string, unknown>;
    apiCallSuccess = true;

    // Map the MyEmailVerifier raw response to our internal format
    const validatedData = mapRawResponseToInternal(rawData);

    // Log the response (email is redacted inside logger)
    const responseData: Record<string, unknown> = { ...validatedData };
    await logger.logApiVerifierResponse(email, responseData);

    // Emit VERIFIER_API_CALLED event (fire-and-forget)
    const apiCallDuration = Date.now() - apiCallStartTime;
    try {
      const event = createEvent<VerifierApiCalledPayload>(DomainEventType.VERIFIER_API_CALLED, {
        email: redactEmail(email),
        durationMs: apiCallDuration,
        success: apiCallSuccess,
        error: apiCallError,
      });
      domainEvents.emit(event);
    } catch {
      // Silently ignore event emission errors
    }

    // Event-driven: Fetch and update credits after each verification API call
    // This is intentionally fire-and-forget (non-blocking) and best-effort.
    // Credit tracking is not critical path - verification response is returned immediately.
    // Failures are logged but don't block the user-facing verification flow.
    syncCreditsAfterVerification().catch(() => {
      // Ignore promise rejection - errors are handled internally
    });

    return validatedData;
  } catch (error) {
    // Don't log the full email in error messages (security)
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Emit VERIFIER_API_CALLED event for failed call (fire-and-forget)
    const apiCallDuration = Date.now() - apiCallStartTime;
    try {
      const event = createEvent<VerifierApiCalledPayload>(DomainEventType.VERIFIER_API_CALLED, {
        email: redactEmail(email),
        durationMs: apiCallDuration,
        success: false,
        error: errorMessage,
      });
      domainEvents.emit(event);
    } catch {
      // Silently ignore event emission errors
    }

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
 * Fetch MyEmailVerifier credits from the API
 * This is called event-driven after each verification to track remaining credits
 *
 * @returns Number of credits remaining, or null if fetch fails
 */
export async function fetchVerifierCredits(): Promise<number | null> {
  // Guard: return simulated credits in development/simulation mode
  if (shouldSimulateVerifier()) {
    await logger.info('SIMULATION: Returning simulated verifier credits');
    return 9999;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    await logger.warn('MYEMAILVERIFIER_API_KEY not configured, cannot fetch credits');
    return null;
  }

  const url = `https://client.myemailverifier.com/verifier/getcredits/${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      await logger.warn(`Credits API request failed: ${response.status} - ${errorText}`);
      return null;
    }

    const data: unknown = await response.json();

    // Validate response has credits or Credits field (API returns lowercase, code expected uppercase)
    if (typeof data === 'object' && data !== null) {
      const rawData = data as Record<string, unknown>;
      const creditsValue = rawData.credits ?? rawData.Credits;

      if (creditsValue !== undefined && creditsValue !== null) {
        const credits = Number.parseInt(String(creditsValue), 10);
        if (!Number.isNaN(credits)) {
          await logger.info(`MyEmailVerifier credits fetched: ${credits}`);
          return credits;
        }
      }
    }

    await logger.warn(`Invalid credits response format: ${JSON.stringify(data)}`);
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.warn(`Error fetching MyEmailVerifier credits: ${errorMessage}`);
    return null;
  }
}

/**
 * Sync credits after verification - fire-and-forget operation
 * Updates the database with current credit balance from the API
 * Failures are tracked but don't block the verification flow
 */
async function syncCreditsAfterVerification(): Promise<void> {
  try {
    const credits = await fetchVerifierCredits();
    if (credits !== null) {
      // Reset failure tracking on success
      creditsUpdateFailureCount = 0;
      isCreditsUpdateFailing = false;
      await updateEmailVerifierCredits(credits);
      const { emitAnalyticsEvent } = await import('./events/bus.js');
      emitAnalyticsEvent({ type: 'verifier:credits_updated', credits });
    }
  } catch (err) {
    // Track consecutive failures and enforce retry limit
    creditsUpdateFailureCount += 1;

    if (creditsUpdateFailureCount >= MAX_CREDITS_UPDATE_RETRIES) {
      isCreditsUpdateFailing = true;
      logger
        .logError(
          'Credits Update - Post-verification sync',
          err instanceof Error ? err : new Error(String(err)),
          {
            consecutiveFailures: creditsUpdateFailureCount,
            retryLimit: MAX_CREDITS_UPDATE_RETRIES,
            message: `Credits update consistently failing after ${MAX_CREDITS_UPDATE_RETRIES} attempts. Consider checking MyEmailVerifier API status or credentials.`,
          }
        )
        .catch(() => {
          // Ignore logging errors
        });
    } else {
      logger
        .warn(
          `Failed to update credits (attempt ${creditsUpdateFailureCount}/${MAX_CREDITS_UPDATE_RETRIES}): ` +
            'Context: post-verification credits sync. ' +
            `Error: ${err instanceof Error ? err.message : String(err)}`
        )
        .catch(() => {
          // Ignore logging errors
        });
    }
  }
}

/**
 * Maps MyEmailVerifier raw response to internal EmailVerificationResponse
 *
 * API Response Fields:
 * - Address: string
 * - Status: "Valid" | "Invalid" | "Unknown" | "Catch All" | "Grey-listed"
 * - Disposable_Domain: "true" | "false"
 * - Role_Based: "true" | "false"
 * - Diagnosis: string
 */
export function mapRawResponseToInternal(data: Record<string, unknown>): EmailVerificationResponse {
  const status = String(data.Status || 'Unknown');

  // Handle boolean-like fields which can be string "true"/"false", "1"/"0", or numeric 1/0
  const isTrue = (val: unknown): boolean => {
    if (typeof val === 'boolean') {
      return val;
    }
    const strVal = String(val).toLowerCase();
    return strVal === 'true' || strVal === '1';
  };

  const isDisposable = isTrue(data.Disposable_Domain);
  const isRole = isTrue(data.Role_Based);

  let internalStatus: EmailVerificationResponse['status'] = 'unknown';
  let risk: EmailVerificationResponse['risk'] = 'medium';

  // Determine status
  if (isDisposable) {
    internalStatus = 'disposable';
    risk = 'high';
  } else if (isRole) {
    internalStatus = 'role';
    risk = 'low'; // Roles are valid emails, just often filtered
  } else if (status === 'Valid') {
    internalStatus = 'valid';
    risk = 'low';
  } else if (status === 'Invalid') {
    internalStatus = 'invalid';
    risk = 'high';
  } else if (status === 'Catch All') {
    internalStatus = 'catch-all';
    risk = 'medium';
  } else if (status === 'Unknown' || status === 'Grey-listed') {
    internalStatus = 'unknown';
    risk = 'medium';
  }

  const result: EmailVerificationResponse = {
    status: internalStatus,
    risk,
  };

  if (data.Address) {
    result.email = String(data.Address);
  }

  if (data.Diagnosis) {
    result.message = String(data.Diagnosis);
  }

  // Still run through Zod to ensure final internal format is correct
  return validateEmailVerificationResponse(result);
}

/**
 * Check if an email is safe to send to based on verification result
 *
 * @param result - Verification response from API
 * @returns boolean indicating if email is safe
 */
export function isEmailSafe(result: EmailVerificationResponse): boolean {
  const allowedOutcomes = getAllowedVerificationOutcomes();
  return allowedOutcomes.has(`${result.status}:${result.risk}`);
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
