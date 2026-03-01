/**
 * Security utilities for TermiSend
 * Contains functions for PII redaction, validation, and sanitization
 */

import path from 'node:path';
import { z } from 'zod';

// ============================================================================
// Email Redaction
// ============================================================================

/**
 * Redact an email address for safe logging
 * Masks most of the address while preserving structure
 *
 * @example
 * redactEmail('user@example.com') // returns 'u***@e******.com'
 * redactEmail('john.doe@company.co.uk') // returns 'j*******@c******.co.uk'
 *
 * @param email - Email address to redact
 * @returns Redacted email address safe for logging
 */
export function redactEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    return '[INVALID_EMAIL]';
  }

  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    // Not a valid email format, redact entirely
    return email.length > 3 ? `${email[0]}***${email[email.length - 1]}` : '***';
  }

  const localPart = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);

  // Redact local part: keep first char, mask the rest
  const redactedLocal =
    localPart.length > 0 ? `${localPart[0]}${'*'.repeat(Math.max(0, localPart.length - 1))}` : '';

  // Redact domain: keep first char of each domain segment
  const domainSegments = domainPart.split('.');
  const redactedDomain = domainSegments
    .map((segment, index) => {
      // For TLD segments (last 1-2 segments), show them as-is if they're short
      const isTld = index >= domainSegments.length - 2;
      if (isTld && segment.length <= 3) {
        return segment;
      }
      // Redact segment: keep first char, mask the rest
      return segment.length > 0
        ? `${segment[0]}${'*'.repeat(Math.max(0, segment.length - 1))}`
        : '';
    })
    .join('.');

  return `${redactedLocal}@${redactedDomain}`;
}

// ============================================================================
// Email Validation
// ============================================================================

/**
 * RFC 5322 compliant email regex (simplified but effective)
 * Validates email format before making API calls
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validate email format
 *
 * @param email - Email address to validate
 * @returns Object with validation result and optional error message
 */
export function validateEmailFormat(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const trimmedEmail = email.trim();

  if (trimmedEmail.length === 0) {
    return { valid: false, error: 'Email is required' };
  }

  if (trimmedEmail.length > 254) {
    return { valid: false, error: 'Email exceeds maximum length of 254 characters' };
  }

  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return { valid: false, error: 'Invalid email format' };
  }

  // Additional checks for common issues
  const atIndex = trimmedEmail.indexOf('@');
  if (atIndex === 0) {
    return { valid: false, error: 'Email missing local part before @' };
  }

  const domain = trimmedEmail.slice(atIndex + 1);
  if (!domain || domain.length === 0) {
    return { valid: false, error: 'Email missing domain after @' };
  }

  if (domain.indexOf('.') === -1) {
    return { valid: false, error: 'Email domain missing TLD' };
  }

  return { valid: true };
}

// ============================================================================
// File Path Sanitization
// ============================================================================

/**
 * Extract only the filename from a path for safe logging
 * Prevents disclosure of directory structure
 *
 * @param filePath - Full file path
 * @returns Filename only, or '[INVALID_PATH]' if input is invalid
 */
export function getSafeFilename(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    return '[INVALID_PATH]';
  }

  try {
    return path.basename(filePath);
  } catch {
    // If path parsing fails, try basic string manipulation
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || '[INVALID_PATH]';
  }
}

// ============================================================================
// API Response Validation Schemas
// ============================================================================

/**
 * Zod schema for EmailVerificationResponse
 * Validates external API responses before use
 */
export const EmailVerificationResponseSchema = z
  .object({
    status: z.enum(['valid', 'invalid', 'catch-all', 'unknown', 'role', 'disposable']),
    risk: z.enum(['low', 'medium', 'high']),
    email: z.string().email().optional(),
    message: z.string().optional(),
  })
  .strict();

export type ValidatedEmailVerificationResponse = z.infer<typeof EmailVerificationResponseSchema>;

/**
 * Validate email verification API response
 *
 * @param data - Unknown data from API response
 * @returns Validated response object
 * @throws Error with validation details if schema fails
 */
export function validateEmailVerificationResponse(
  data: unknown
): ValidatedEmailVerificationResponse {
  const result = EmailVerificationResponseSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`API response validation failed: ${issues}`);
  }

  return result.data;
}

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitEntry {
  count: number;
  firstRequest: number;
  lastRequest: number;
}

/**
 * In-memory rate limiter for API calls
 * Tracks requests per key with time windows
 */
export class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a request is allowed for the given key
   *
   * @param key - Unique identifier (e.g., email or IP)
   * @returns Object with allowed status and time to wait if rate limited
   */
  checkLimit(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const entry = this.requests.get(key);

    if (!entry) {
      // First request for this key
      this.requests.set(key, {
        count: 1,
        firstRequest: now,
        lastRequest: now,
      });
      return { allowed: true };
    }

    // Check if window has expired
    if (now - entry.firstRequest > this.windowMs) {
      // Reset window
      this.requests.set(key, {
        count: 1,
        firstRequest: now,
        lastRequest: now,
      });
      return { allowed: true };
    }

    // Check if limit exceeded
    if (entry.count >= this.maxRequests) {
      const retryAfterMs = this.windowMs - (now - entry.firstRequest);
      return { allowed: false, retryAfterMs };
    }

    // Increment count
    entry.count++;
    entry.lastRequest = now;
    return { allowed: true };
  }

  /**
   * Clean up expired entries (call periodically to prevent memory leaks)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now - entry.firstRequest > this.windowMs) {
        this.requests.delete(key);
      }
    }
  }
}

// ============================================================================
// Environment Checks
// ============================================================================

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}
