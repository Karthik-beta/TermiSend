/**
 * Configuration module for TermiSend
 * Centralized environment variable loading and configuration using dotenv
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// ============================================================================
// Environment Configuration
// ============================================================================

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';

/**
 * Load environment variables from the appropriate .env file
 * Uses dotenv for robust parsing
 * @returns Record of environment variables
 */
export function loadEnv(): Record<string, string> {
  try {
    // Check if env file exists first
    const envPath = resolve(process.cwd(), envFile);
    readFileSync(envPath, 'utf-8');

    // Load using dotenv
    const result = config({ path: envPath });

    if (result.error) {
      console.warn(`Warning: Could not load ${envFile}:`, result.error.message);
      return {};
    }

    // Return parsed environment variables
    return result.parsed || {};
  } catch {
    // File doesn't exist or can't be read
    return {};
  }
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
 * Check if outgoing emails should be redirected to test email
 * ALWAYS returns true in non-production environments to prevent accidental sending.
 */
export function shouldRedirectEmails(): boolean {
  if (isProduction()) {
    return false;
  }

  return true;
}
