/**
 * Configuration module for TermiSend
 * Centralized environment variable loading and configuration using dotenv
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { validateTemplatePath } from './path-validator.js';

// ============================================================================
// Environment Configuration
// ============================================================================

function getEnvFileCandidates(): string[] {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();

  if (nodeEnv === 'production') {
    return ['.env.production', '.env.prod'];
  }

  if (!nodeEnv || nodeEnv === 'development') {
    return ['.env.development', '.env'];
  }

  return [`.env.${nodeEnv}`, '.env.development', '.env'];
}

/**
 * Load environment variables from the appropriate .env file
 * Uses dotenv for robust parsing
 * @returns Record of environment variables
 */
export function loadEnv(): Record<string, string> {
  for (const envFile of getEnvFileCandidates()) {
    try {
      // Check if env file exists first
      const envPath = resolve(process.cwd(), envFile);
      readFileSync(envPath, 'utf-8');

      // Load using dotenv
      const result = config({ path: envPath });

      if (result.error) {
        console.warn(`⚠️  Could not load ${envFile}`);
        console.warn('   This is optional - using existing environment variables');
        console.warn(`   To create: cp .env.example ${envFile}`);
        return {};
      }

      // Return parsed environment variables
      return result.parsed || {};
    } catch {
      // Try the next matching env file name
    }
  }

  // No matching env file exists or could be read
  return {};
}

// Cache for loaded environment - immutable after initialization
let cachedEnv: Readonly<Record<string, string>> | null = null;

/**
 * Get environment variables with caching
 * @returns Readonly record of environment variables (cached after first call)
 */
export function getEnv(): Readonly<Record<string, string>> {
  if (!cachedEnv) {
    const loadedEnv = loadEnv();
    // Freeze the cached environment to make it immutable
    cachedEnv = Object.freeze({ ...loadedEnv });
  }
  // Always merge with current process.env to allow test overrides
  // Filter out undefined values from process.env
  const envVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      envVars[key] = value;
    }
  }
  // Return frozen merged object to maintain immutability
  return Object.freeze({ ...cachedEnv, ...envVars });
}

/**
 * Reset the environment cache (for testing purposes only)
 * @internal
 */
export function resetEnvCacheForTesting(): void {
  cachedEnv = null;
}

// ============================================================================
// Throttling Configuration
// ============================================================================

import type { ThrottleConfig } from './types';

const EMAIL_VERIFICATION_POLICY_ALLOWED_OUTCOMES = Object.freeze({
  strict: ['valid:low'],
  balanced: ['valid:low', 'catch-all:low', 'catch-all:medium'],
  permissive: ['valid:low', 'valid:medium', 'catch-all:low', 'catch-all:medium', 'role:low'],
});
const DEFAULT_EMAIL_VERIFICATION_ALLOWED_OUTCOMES = Object.freeze(
  EMAIL_VERIFICATION_POLICY_ALLOWED_OUTCOMES.balanced
);

type EmailVerificationPolicy = keyof typeof EMAIL_VERIFICATION_POLICY_ALLOWED_OUTCOMES;
const EMAIL_VERIFICATION_POLICIES = Object.keys(
  EMAIL_VERIFICATION_POLICY_ALLOWED_OUTCOMES
) as EmailVerificationPolicy[];

/**
 * Get throttling configuration from environment variables
 * All values have sensible defaults for production use
 * @returns ThrottleConfig with validated settings
 */
export function getThrottleConfig(): ThrottleConfig {
  const env = getEnv();

  // Parse values from environment with PDD-compliant defaults
  const minDelayMs = Number.parseInt(env.THROTTLE_MIN_DELAY_MS || '60000', 10);
  const maxDelayMs = Number.parseInt(env.THROTTLE_MAX_DELAY_MS || '120000', 10);

  return {
    minDelayMs,
    maxDelayMs,
    breakProbabilityPercent: Number.parseInt(env.THROTTLE_BREAK_PROBABILITY_PERCENT || '5', 10),
    breakMinMinutes: Number.parseInt(env.THROTTLE_BREAK_MIN_MINUTES || '3', 10),
    breakMaxMinutes: Number.parseInt(env.THROTTLE_BREAK_MAX_MINUTES || '5', 10),
  };
}

/**
 * Get SES rate limit from environment variables
 * AWS SES default is 14 emails per second for sandbox
 * @returns Maximum emails per second
 */
export function getSesRateLimit(): number {
  const env = getEnv();
  return Number.parseInt(env.SES_RATE_LIMIT_PER_SECOND || '14', 10);
}

/**
 * Get quota buffer percentage from environment variables
 * Buffer prevents hitting the hard quota limit
 * @returns Percentage of quota to reserve as buffer (0-100)
 */
export function getQuotaBufferPercent(): number {
  const env = getEnv();
  return Number.parseInt(env.SES_QUOTA_BUFFER_PERCENT || '10', 10);
}

// ============================================================================
// Development / Safety Controls
// ============================================================================

import { isProduction } from './utils/security.js';

/**
 * Get the internal test email for dev/staging redirection
 * @returns Test recipient email address
 * @throws Error if not in production and TEST_RECIPIENT_EMAIL is missing
 */
export function getTestRecipientEmail(): string {
  const env = getEnv();
  const testEmail = env.TEST_RECIPIENT_EMAIL || process.env.TEST_RECIPIENT_EMAIL;

  if (!isProduction() && !testEmail) {
    throw new Error('TEST_RECIPIENT_EMAIL must be configured when not in production');
  }

  return testEmail || '';
}

/**
 * Check if email verification should be simulated
 * Defaults to true in non-production environments
 */
export function shouldSimulateVerifier(): boolean {
  const env = getEnv();
  const simulate = env.SIMULATE_VERIFIER || process.env.SIMULATE_VERIFIER;

  if (isProduction()) {
    return false;
  }

  return simulate !== 'false';
}

/**
 * Check if the MyEmailVerifier API should be bypassed entirely.
 * This is an explicit experiment switch and works in any environment.
 */
export function shouldBypassVerifierApi(): boolean {
  const env = getEnv();
  const bypass = env.BYPASS_MYEMAILVERIFIER_API || process.env.BYPASS_MYEMAILVERIFIER_API;
  return bypass === 'true';
}

/**
 * Get the verification outcomes that are allowed to proceed to sending.
 * Controlled by the EMAIL_VERIFICATION_POLICY environment variable.
 */
export function getAllowedVerificationOutcomes(): ReadonlySet<string> {
  const env = getEnv();
  const rawPolicyName = env.EMAIL_VERIFICATION_POLICY || process.env.EMAIL_VERIFICATION_POLICY;

  if (rawPolicyName?.trim()) {
    const normalizedPolicy = rawPolicyName.trim().toLowerCase() as EmailVerificationPolicy;

    if (!EMAIL_VERIFICATION_POLICIES.includes(normalizedPolicy)) {
      throw new Error(
        `Invalid EMAIL_VERIFICATION_POLICY "${rawPolicyName}". Expected one of: ${EMAIL_VERIFICATION_POLICIES.join(', ')}`
      );
    }

    return new Set(EMAIL_VERIFICATION_POLICY_ALLOWED_OUTCOMES[normalizedPolicy]);
  }

  return new Set(DEFAULT_EMAIL_VERIFICATION_ALLOWED_OUTCOMES);
}

/**
 * Check if outgoing emails should be redirected to test email
 * ALWAYS returns true in non-production environments to prevent accidental sending.
 */
export function shouldRedirectEmails(): boolean {
  if (isProduction()) {
    return false;
  }

  return true;
}

/**
 * Check if the List-Unsubscribe header should be included in emails.
 * Defaults to true for safety/compliance.
 */
export function isListUnsubscribeEnabled(): boolean {
  const env = getEnv();
  const enabled = env.ENABLE_LIST_UNSUBSCRIBE || process.env.ENABLE_LIST_UNSUBSCRIBE;

  // Default to true if not explicitly set to 'false'
  return enabled !== 'false';
}

// ============================================================================
// Analytics Configuration
// ============================================================================

import type { AnalyticsConfig } from './types';

/**
 * Get analytics configuration from environment variables
 * Controls SES analytics data collection and retention
 * @returns AnalyticsConfig with validated settings
 */
export function getAnalyticsConfig(): AnalyticsConfig {
  const env = getEnv();

  return {
    enabled: env.ANALYTICS_ENABLED !== 'false', // Default to true
    syncIntervalMinutes: Number.parseInt(env.ANALYTICS_SYNC_INTERVAL_MINUTES || '60', 10),
    retentionDays: Number.parseInt(env.ANALYTICS_RETENTION_DAYS || '90', 10),
  };
}

/**
 * Get SES analytics API rate limit
 * AWS SES analytics APIs have a 1 request per second limit
 * @returns Minimum delay between analytics API calls in milliseconds
 */
export function getAnalyticsRateLimitMs(): number {
  const env = getEnv();
  // Default to 1000ms (1 req/sec) as per AWS SES API limits
  return Number.parseInt(env.ANALYTICS_RATE_LIMIT_MS || '1000', 10);
}

/**
 * Get the SES configuration set used for event publishing on outbound mail.
 * This is required for per-message SES event publishing with SendRawEmail.
 */
export function getSESConfigurationSetName(): string | undefined {
  const env = getEnv();
  const value = env.SES_CONFIGURATION_SET || process.env.SES_CONFIGURATION_SET;
  return value?.trim() ? value.trim() : undefined;
}

// ============================================================================
// Email Template Configuration
// ============================================================================

/**
 * Get the email template path from environment variables
 * @returns Validated absolute path to the email template file
 * @throws Error if EMAIL_TEMPLATE_PATH is not configured or the template file cannot be found
 */
export function getEmailTemplatePath(): string {
  const env = getEnv();
  const templatePath = env.EMAIL_TEMPLATE_PATH;

  if (!templatePath) {
    throw new Error('EMAIL_TEMPLATE_PATH is not configured or the template file cannot be found.');
  }

  const validation = validateTemplatePath(templatePath);

  if (!validation.valid) {
    throw new Error('EMAIL_TEMPLATE_PATH is not configured or the template file cannot be found.');
  }

  return validation.sanitizedPath;
}

/**
 * Get the subject template path from environment variables
 * @returns Validated absolute path to the subject template file
 * @throws Error if SUBJECT_TEMPLATE_PATH is not configured or the template file cannot be found
 */
export function getSubjectTemplatePath(): string {
  const env = getEnv();
  const templatePath = env.SUBJECT_TEMPLATE_PATH;

  if (!templatePath) {
    throw new Error(
      'SUBJECT_TEMPLATE_PATH is not configured or the template file cannot be found.'
    );
  }

  const validation = validateTemplatePath(templatePath);

  if (!validation.valid) {
    throw new Error(
      'SUBJECT_TEMPLATE_PATH is not configured or the template file cannot be found.'
    );
  }

  return validation.sanitizedPath;
}

// ============================================================================
// SQS Consumer Configuration
// ============================================================================

import type { SQSConsumerConfig } from './types.js';

/**
 * Get SQS consumer configuration from environment
 * @returns SQSConsumerConfig with validated settings, or null if not configured
 */
export function getSQSConfig(): SQSConsumerConfig | null {
  const env = getEnv();

  const queueUrl = env.SQS_QUEUE_URL || process.env.SQS_QUEUE_URL;
  const awsAccessKeyId = env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  // Return null if required configuration is missing (SQS is optional)
  if (!queueUrl || !awsAccessKeyId || !awsSecretAccessKey) {
    return null;
  }

  const region = env.AWS_REGION || process.env.AWS_REGION || 'us-east-1';

  return {
    queueUrl,
    region,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
    pollingIntervalMs: Number.parseInt(env.SQS_POLLING_INTERVAL_MS || '10000', 10),
    maxMessagesPerPoll: Number.parseInt(env.SQS_MAX_MESSAGES_PER_POLL || '10', 10),
    visibilityTimeoutSeconds: Number.parseInt(env.SQS_VISIBILITY_TIMEOUT_SECONDS || '300', 10),
    waitTimeSeconds: Number.parseInt(env.SQS_WAIT_TIME_SECONDS || '20', 10),
    maxReceiveCount: Number.parseInt(env.SQS_MAX_RECEIVE_COUNT || '3', 10),
    autoDelete: (env.SQS_AUTO_DELETE || 'true') === 'true',
    debugLogging: (env.SQS_DEBUG_LOGGING || 'false') === 'true',
  };
}

/**
 * Check if SQS consumer is enabled
 * @returns Boolean indicating if consumer should start
 */
export function isSQSConsumerEnabled(): boolean {
  const env = getEnv();
  const enabled = env.SQS_CONSUMER_ENABLED || process.env.SQS_CONSUMER_ENABLED;

  // Consumer is only enabled if explicitly enabled AND config is present
  if (enabled !== 'true') {
    return false;
  }

  const config = getSQSConfig();
  return config !== null;
}

/**
 * Get SQS queue URL from environment
 * @returns Queue URL string
 * @throws Error if not configured
 */
export function getSQSQueueUrl(): string {
  const env = getEnv();
  const queueUrl = env.SQS_QUEUE_URL || process.env.SQS_QUEUE_URL;

  if (!queueUrl) {
    throw new Error(
      'SQS_QUEUE_URL is not configured. Set it in environment variables or .env file.'
    );
  }

  return queueUrl;
}
