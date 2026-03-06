/**
 * Throttling Utility Module for TermiSend
 * Core throttling functionality for email sending rate control
 */

import { getQuotaBufferPercent, getSesRateLimit, getThrottleConfig } from './config.js';
import {
  createEvent,
  DomainEventType,
  domainEvents,
  type QuotaCheckFailedPayload,
  type QuotaCheckPassedPayload,
  type ThrottleDelayCompletedPayload,
  type ThrottleDelayStartedPayload,
} from './events/index.js';
import { logger } from './logger.js';
import { getAccountInfo } from './ses-quota.js';
import { getShutdownSignal, isShuttingDown, throwIfShuttingDown } from './shutdown.js';
import type { DelayResult, QuotaStatus, RateLimiter, ThrottleConfig } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Milliseconds per minute for conversions */
const MS_PER_MINUTE = 60000;

/** Default quota refresh interval in milliseconds (5 minutes) */
const QUOTA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Maximum retries for quota checks */
const MAX_QUOTA_RETRIES = 3;

/** Base delay for exponential backoff in milliseconds */
const QUOTA_RETRY_BASE_MS = 1000;

/** Circuit breaker threshold for consecutive failures */
const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Maximum number of pending requests in the rate limiter queue */
const MAX_PENDING_REQUESTS = 100;

// ============================================================================
// Delay Calculator
// ============================================================================

/**
 * Calculate delay with optional break for email throttling
 * Uses bounded uniform distribution via Math.random()
 *
 * @param config - Throttle configuration with delay bounds and break settings
 * @returns DelayResult with base delay, break info, and total delay
 */
export function calculateDelay(config: ThrottleConfig): DelayResult {
  // Calculate base delay using bounded uniform distribution
  const delayRange = config.maxDelayMs - config.minDelayMs;
  const baseDelayMs = config.minDelayMs + Math.random() * delayRange;

  // Determine if a break should be triggered
  const breakTriggered = Math.random() < config.breakProbabilityPercent / 100;

  let breakDurationMs = 0;

  if (breakTriggered) {
    // Calculate random break duration within configured bounds
    const breakRangeMinutes = config.breakMaxMinutes - config.breakMinMinutes;
    const breakMinutes = config.breakMinMinutes + Math.random() * breakRangeMinutes;
    breakDurationMs = breakMinutes * MS_PER_MINUTE;

    // Log break trigger (fire-and-forget with error handling)
    logger
      .info(`Break triggered: ${Math.round(breakMinutes)} minutes (${breakDurationMs}ms)`)
      .catch(() => {
        // Silently ignore logging errors to not disrupt throttling logic
      });
  }

  // Calculate total delay
  const totalDelayMs = baseDelayMs + breakDurationMs;

  const result: DelayResult = {
    baseDelayMs: Math.round(baseDelayMs),
    breakTriggered,
    breakDurationMs: Math.round(breakDurationMs),
    totalDelayMs: Math.round(totalDelayMs),
  };

  // Log delay calculation (fire-and-forget with error handling)
  logger
    .info(
      `Delay calculated: base=${result.baseDelayMs}ms, break=${result.breakTriggered}, total=${result.totalDelayMs}ms`
    )
    .catch(() => {
      // Silently ignore logging errors to not disrupt throttling logic
    });

  return result;
}

// ============================================================================
// Async Delay Function
// ============================================================================

/**
 * Async wrapper around setTimeout for delay operations
 * Supports optional AbortSignal for cancellation during shutdown
 *
 * @param ms - Milliseconds to delay
 * @param signal - Optional AbortSignal to cancel the delay
 * @returns Promise that resolves after the specified delay or rejects if aborted
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Delay aborted'));
      });
    }
  });
}

// ============================================================================
// Token Bucket Rate Limiter
// ============================================================================

/**
 * Pending request in the acquisition queue
 */
interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Token Bucket implementation of RateLimiter interface
 * Provides concurrency-safe rate limiting using an async queue pattern
 *
 * Uses integer math to avoid floating point precision issues.
 * Tokens are stored as integer "microtokens" (tokens × 1000) for precision.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  // Tokens are stored as integer "microtokens" (tokens × 1000) to avoid floating point drift
  private microTokens: number;
  private lastRefillTime: number;
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;
  private readonly refillIntervalMs: number;
  private pendingQueue: PendingRequest[] = [];
  private processingQueue: boolean = false;

  // Conversion factor: 1 token = 1000 microtokens
  private static readonly MICROTOKENS_PER_TOKEN = 1000;

  /**
   * Create a new TokenBucketRateLimiter
   *
   * @param capacity - Maximum number of tokens in the bucket
   * @param refillRatePerSecond - Rate at which tokens are refilled (tokens per second)
   */
  constructor(capacity: number, refillRatePerSecond: number) {
    this.capacity = capacity;
    this.refillRatePerSecond = refillRatePerSecond;
    this.microTokens = capacity * TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN;
    this.lastRefillTime = performance.now();
    // Calculate refill interval (one token worth of time)
    this.refillIntervalMs = 1000 / refillRatePerSecond;
  }

  /**
   * Refill tokens based on elapsed time since last refill
   * Must be called within the processing lock to ensure atomicity
   * Uses integer math to avoid floating point precision issues
   */
  private refill(): void {
    const now = performance.now();
    const elapsedMs = now - this.lastRefillTime;

    if (elapsedMs > 0) {
      // Calculate microtokens to add based on elapsed time and refill rate
      // Using integer math: microtokens = (elapsedMs * rate * 1000) / 1000
      const microTokensToAdd = Math.floor(
        (elapsedMs * this.refillRatePerSecond * TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN) / 1000
      );
      const maxMicroTokens = this.capacity * TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN;
      this.microTokens = Math.min(maxMicroTokens, this.microTokens + microTokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Process the pending queue
   * This ensures only one token acquisition happens at a time
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    try {
      while (this.pendingQueue.length > 0) {
        this.refill();

        // Check if we have at least one full token (1000 microtokens)
        if (this.microTokens >= TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN) {
          // Token available, consume it and resolve the next pending request
          this.microTokens -= TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN;
          const request = this.pendingQueue.shift();
          if (request) {
            request.resolve();
          }
        } else {
          // No tokens available, calculate precisely how long to wait
          // to get enough tokens for 1 request
          const tokensNeeded =
            (TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN - this.microTokens) /
            TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN;
          const waitTimeMs = Math.max(1, Math.ceil(this.refillIntervalMs * tokensNeeded));

          // Wait for refill interval
          await delay(waitTimeMs);

          // Refill after waiting, loop continues
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Acquire a token from the bucket
   * Waits if no tokens are available
   * Uses an internal queue to ensure FIFO order and prevent race conditions
   *
   * @returns Promise that resolves when a token is acquired
   */
  acquire(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Check queue size to prevent unbounded growth
      if (this.pendingQueue.length >= MAX_PENDING_REQUESTS) {
        return reject(
          new Error(`Rate limiter queue full (${MAX_PENDING_REQUESTS} requests pending)`)
        );
      }

      // Add request to the queue
      this.pendingQueue.push({ resolve, reject });

      // Start processing the queue
      this.processQueue().catch((error) => {
        // If queue processing fails, reject all pending requests
        for (const req of this.pendingQueue) {
          req.reject(error as Error);
        }
        this.pendingQueue = [];
      });
    });
  }

  release(): void {
    // In a token bucket used for strict rate limiting (requests per time),
    // tokens are NOT released back manually when an operation finishes.
    // The bucket naturally refills over time.
    // Manually adding tokens back turns this into a concurrency limiter
    // (max X active requests) instead of a rate limiter (max X requests/sec).
  }

  /**
   * Get current token count (for debugging/monitoring)
   * Uses integer math internally, returns float for compatibility
   */
  getTokenCount(): number {
    this.refill();
    return this.microTokens / TokenBucketRateLimiter.MICROTOKENS_PER_TOKEN;
  }
}

// ============================================================================
// Quota Monitor
// ============================================================================

/**
 * Monitors AWS SES quota and prevents sending when approaching limits
 * Caches quota status to avoid excessive API calls
 * Implements circuit breaker pattern for repeated failures
 */
export class QuotaMonitor {
  private bufferPercent: number;
  private cachedStatus: QuotaStatus | null = null;
  private lastFetchTime: number = 0;
  private readonly refreshIntervalMs: number;
  private consecutiveFailures: number = 0;
  private circuitBreakerOpen: boolean = false;
  private circuitBreakerResetTime: number = 0;

  /**
   * Create a new QuotaMonitor
   *
   * @param bufferPercent - Percentage of quota to reserve as buffer (0-100)
   * @param refreshIntervalMs - How often to refresh quota from API (default: 5 minutes)
   */
  constructor(bufferPercent: number, refreshIntervalMs: number = QUOTA_REFRESH_INTERVAL_MS) {
    this.bufferPercent = bufferPercent;
    this.refreshIntervalMs = refreshIntervalMs;
  }

  /**
   * Fetch fresh quota status from AWS SES
   */
  private async fetchQuotaStatus(): Promise<QuotaStatus | null> {
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
   * Refresh quota status if cache is stale
   */
  private async refreshStatus(): Promise<void> {
    const now = Date.now();
    const cacheAgeMs = now - this.lastFetchTime;

    if (this.cachedStatus === null || cacheAgeMs >= this.refreshIntervalMs) {
      this.cachedStatus = await this.fetchQuotaStatus();
      this.lastFetchTime = now;
    }
  }

  /**
   * Check if it's safe to send an email based on quota
   * Implements fail-closed: returns false if quota cannot be determined
   *
   * @returns true if quota is OK to proceed, false if approaching limit or check failed
   */
  async checkQuota(): Promise<boolean> {
    // Check if circuit breaker is open
    if (this.circuitBreakerOpen) {
      const now = Date.now();
      if (now < this.circuitBreakerResetTime) {
        await logger.warn(
          'Circuit breaker open: quota check failed too many times, blocking sends'
        );
        return false;
      }
      // Reset circuit breaker after cooldown
      await logger.info('Circuit breaker cooldown elapsed, resetting');
      this.circuitBreakerOpen = false;
      this.consecutiveFailures = 0;
    }

    // Try to refresh with retries
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_QUOTA_RETRIES; attempt++) {
      try {
        await this.refreshStatus();

        if (this.cachedStatus !== null) {
          // Success - reset failure count
          this.consecutiveFailures = 0;

          const { max24HourSend, remainingQuota } = this.cachedStatus;

          // Calculate threshold with buffer
          const bufferAmount = (max24HourSend * this.bufferPercent) / 100;
          const threshold = bufferAmount;

          const isSafeToSend = remainingQuota > threshold;

          if (!isSafeToSend) {
            await logger.warn(
              `Quota pause: ${remainingQuota} remaining, threshold=${threshold} (${this.bufferPercent}% buffer)`
            );
          }

          return isSafeToSend;
        }

        // Cached status is null, treat as failure for retry
        throw new Error('Quota status returned null');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.consecutiveFailures++;

        // Check if we should open circuit breaker
        if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          this.circuitBreakerOpen = true;
          this.circuitBreakerResetTime = Date.now() + 5 * 60 * 1000; // 5 minute cooldown
          await logger.warn(
            `Circuit breaker opened after ${this.consecutiveFailures} consecutive quota check failures`
          );
          return false;
        }

        // Calculate exponential backoff delay
        if (attempt < MAX_QUOTA_RETRIES - 1) {
          const backoffMs = QUOTA_RETRY_BASE_MS * 2 ** attempt;
          await logger.warn(
            `Quota check attempt ${attempt + 1} failed, retrying in ${backoffMs}ms: ${lastError.message}`
          );
          await delay(backoffMs);
        }
      }
    }

    // All retries exhausted - fail closed (return false)
    await logger.warn(
      `Quota check failed after ${MAX_QUOTA_RETRIES} attempts: ${lastError?.message}. Blocking sends (fail-closed).`
    );
    return false;
  }

  /**
   * Get current quota status
   *
   * @returns QuotaStatus or null if not yet fetched
   */
  getStatus(): QuotaStatus | null {
    return this.cachedStatus;
  }

  /**
   * Force a refresh of quota status
   */
  async forceRefresh(): Promise<void> {
    this.cachedStatus = await this.fetchQuotaStatus();
    this.lastFetchTime = Date.now();
  }
}

// ============================================================================
// Main Throttle Controller
// ============================================================================

/**
 * Singleton token for EmailThrottleController constructor
 * Prevents external instantiation
 */
const SINGLETON_TOKEN: unique symbol = Symbol('EmailThrottleControllerSingletonToken');

/**
 * Main controller for email throttling
 * Orchestrates delay calculation, rate limiting, and quota checking
 *
 * This class is a singleton. Use getEmailThrottleController() to get the instance.
 * Do not instantiate directly - the constructor requires a private token.
 */
export class EmailThrottleController {
  private rateLimiter: TokenBucketRateLimiter;
  private quotaMonitor: QuotaMonitor;
  private config: ThrottleConfig;

  /**
   * Private singleton instance
   */
  private static instance: EmailThrottleController | null = null;

  /**
   * Create a new EmailThrottleController
   * NOTE: This constructor is private. Use getEmailThrottleController() instead.
   *
   * @param token - Private symbol token required for instantiation
   */
  constructor(token: typeof SINGLETON_TOKEN) {
    if (token !== SINGLETON_TOKEN) {
      throw new Error(
        'EmailThrottleController is a singleton. Use getEmailThrottleController() instead of new EmailThrottleController()'
      );
    }

    this.config = getThrottleConfig();
    const sesRateLimit = getSesRateLimit();
    const quotaBufferPercent = getQuotaBufferPercent();

    // Initialize rate limiter with SES rate limit
    this.rateLimiter = new TokenBucketRateLimiter(sesRateLimit, sesRateLimit);

    // Initialize quota monitor with buffer percentage
    this.quotaMonitor = new QuotaMonitor(quotaBufferPercent);

    logger
      .info(
        `EmailThrottleController initialized: rateLimit=${sesRateLimit}/s, buffer=${quotaBufferPercent}%`
      )
      .catch(() => {
        // Silently ignore logging errors in constructor
      });
  }

  /**
   * Get the singleton instance of EmailThrottleController
   * Creates the instance on first call
   */
  static getInstance(): EmailThrottleController {
    if (!EmailThrottleController.instance) {
      EmailThrottleController.instance = new EmailThrottleController(SINGLETON_TOKEN);
    }
    return EmailThrottleController.instance;
  }

  /**
   * Reset the singleton instance (for testing purposes only)
   * @internal
   */
  static resetInstance(): void {
    EmailThrottleController.instance = null;
  }

  /**
   * Calculate and wait for the appropriate delay before sending
   *
   * @param onProgress - Optional callback called every second with remaining wait time
   * @returns DelayResult with information about the delay
   */
  async waitBeforeSend(
    onProgress?: (remainingMs: number, totalMs: number) => void,
    contactId?: string
  ): Promise<DelayResult> {
    // Check for shutdown before starting
    throwIfShuttingDown();

    // Get fresh config
    this.config = getThrottleConfig();

    // Calculate delay
    const delayResult = calculateDelay(this.config);

    // Log the delay event
    await logger.info(
      `Throttle delay: waiting ${delayResult.totalDelayMs}ms before next send (base=${delayResult.baseDelayMs}ms, break=${delayResult.breakTriggered})`
    );

    // Emit THROTTLE_DELAY_STARTED event (fire-and-forget)
    const delayStartTime = Date.now();
    try {
      const event = createEvent<ThrottleDelayStartedPayload>(
        DomainEventType.THROTTLE_DELAY_STARTED,
        {
          delayMs: delayResult.totalDelayMs,
          reason: delayResult.breakTriggered ? 'random_break' : 'rate_limit',
          contactId: contactId || 'unknown',
        }
      );
      domainEvents.emit(event);
    } catch {
      // Silently ignore event emission errors
    }

    // Execute the delay with progress callbacks if provided
    if (onProgress && delayResult.totalDelayMs > 0) {
      const totalMs = delayResult.totalDelayMs;
      const startTime = Date.now();
      const endTime = startTime + totalMs;

      // Call progress immediately with full time
      onProgress(totalMs, totalMs);

      // Progress update interval (every second)
      const progressIntervalMs = 1000;

      while (Date.now() < endTime) {
        // Check for shutdown on each iteration
        if (isShuttingDown()) {
          throw new Error('Shutdown requested during throttle delay');
        }

        const remainingMs = Math.max(0, endTime - Date.now());
        onProgress(remainingMs, totalMs);

        // Wait for next interval or until end
        const waitMs = Math.min(progressIntervalMs, remainingMs);
        if (waitMs > 0) {
          await delay(waitMs, getShutdownSignal());
        }
      }

      // Final call with 0 remaining
      onProgress(0, totalMs);
    } else {
      // Execute the delay without progress updates - check shutdown before and after
      throwIfShuttingDown();
      await delay(delayResult.totalDelayMs, getShutdownSignal());
      throwIfShuttingDown();
    }

    // Emit THROTTLE_DELAY_COMPLETED event (fire-and-forget)
    const actualDelayMs = Date.now() - delayStartTime;
    try {
      const event = createEvent<ThrottleDelayCompletedPayload>(
        DomainEventType.THROTTLE_DELAY_COMPLETED,
        {
          actualDelayMs,
          plannedDelayMs: delayResult.totalDelayMs,
          contactId: contactId || 'unknown',
        }
      );
      domainEvents.emit(event);
    } catch {
      // Silently ignore event emission errors
    }

    return delayResult;
  }

  /**
   * Acquire permission to send an email (rate limiting)
   *
   * @returns Promise that resolves when send permission is granted
   */
  async acquireSendPermission(): Promise<void> {
    await logger.info('Acquiring rate limit permission...');
    await this.rateLimiter.acquire();
    await logger.info('Rate limit permission acquired');
  }

  /**
   * Release send permission back to the rate limiter
   */
  releaseSendPermission(): void {
    this.rateLimiter.release();
    logger.info('Rate limit permission released').catch(() => {
      // Silently ignore logging errors
    });
  }

  /**
   * Check if quota allows for sending
   *
   * @returns true if OK to send, false if approaching quota limit
   */
  async checkQuota(): Promise<boolean> {
    const canSend = await this.quotaMonitor.checkQuota();
    const quotaStatus = this.quotaMonitor.getStatus();

    if (canSend) {
      await logger.info('Quota check passed');
      // Emit QUOTA_CHECK_PASSED event (fire-and-forget)
      try {
        const event = createEvent<QuotaCheckPassedPayload>(DomainEventType.QUOTA_CHECK_PASSED, {
          availableQuota: quotaStatus?.remainingQuota || 0,
          requiredQuota: 1,
          bufferPercentage: this.config.breakProbabilityPercent,
        });
        domainEvents.emit(event);
      } catch {
        // Silently ignore event emission errors
      }
    } else {
      await logger.warn('Quota check failed - approaching limit');
      // Emit QUOTA_CHECK_FAILED event (fire-and-forget)
      try {
        const event = createEvent<QuotaCheckFailedPayload>(DomainEventType.QUOTA_CHECK_FAILED, {
          availableQuota: quotaStatus?.remainingQuota || 0,
          requiredQuota: 1,
          reason: 'insufficient_quota',
        });
        domainEvents.emit(event);
      } catch {
        // Silently ignore event emission errors
      }
    }

    return canSend;
  }

  /**
   * Get current quota status
   *
   * @returns QuotaStatus or null
   */
  getQuotaStatus(): QuotaStatus | null {
    return this.quotaMonitor.getStatus();
  }

  /**
   * Refresh quota status from AWS
   */
  async refreshQuotaStatus(): Promise<void> {
    await this.quotaMonitor.forceRefresh();
    await logger.info('Quota status refreshed');
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

/**
 * Get the shared EmailThrottleController singleton instance
 * All modules should use this function to access the throttle controller
 */
export function getEmailThrottleController(): EmailThrottleController {
  return EmailThrottleController.getInstance();
}

/**
 * Shared throttle controller instance
 * Use this for all throttling operations
 * @deprecated Use getEmailThrottleController() instead for clarity
 */
export const throttleController = EmailThrottleController.getInstance();
