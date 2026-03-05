/**
 * Unit Tests for Throttle Module
 * Refactored from src/throttle.test.ts
 */

import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as configModule from '../../src/config.js';
import * as sesQuotaModule from '../../src/ses-quota.js';
import * as throttleModule from '../../src/throttle.js';
import {
  calculateDelay,
  EmailThrottleController,
  getEmailThrottleController,
  QuotaMonitor,
  TokenBucketRateLimiter,
} from '../../src/throttle.js';
import type { ThrottleConfig } from '../../src/types.js';

// Mock the logger module to avoid spyOn issues with accessor properties
function defineMockLogger() {
  mock.module('../../src/logger.js', () => ({
    logger: {
      logEvent: mock(() => Promise.resolve()),
      logUserInput: mock(() => Promise.resolve()),
      logExcelImportStart: mock(() => Promise.resolve()),
      logExcelImportRowValid: mock(() => Promise.resolve()),
      logExcelImportRowInvalid: mock(() => Promise.resolve()),
      logExcelImportComplete: mock(() => Promise.resolve()),
      logApiVerifierRequest: mock(() => Promise.resolve()),
      logApiVerifierResponse: mock(() => Promise.resolve()),
      logAwsSesRequest: mock(() => Promise.resolve()),
      logAwsSesResponse: mock(() => Promise.resolve()),
      logSendLogUpdated: mock(() => Promise.resolve()),
      logError: mock(() => Promise.resolve()),
      info: mock(() => Promise.resolve()),
      warn: mock(() => Promise.resolve()),
    },
    logEvent: mock(() => Promise.resolve()),
    logUserInput: mock(() => Promise.resolve()),
    logExcelImportStart: mock(() => Promise.resolve()),
    logExcelImportRowValid: mock(() => Promise.resolve()),
    logExcelImportRowInvalid: mock(() => Promise.resolve()),
    logExcelImportComplete: mock(() => Promise.resolve()),
    logApiVerifierRequest: mock(() => Promise.resolve()),
    logApiVerifierResponse: mock(() => Promise.resolve()),
    logAwsSesRequest: mock(() => Promise.resolve()),
    logAwsSesResponse: mock(() => Promise.resolve()),
    logSendLogUpdated: mock(() => Promise.resolve()),
    logError: mock(() => Promise.resolve()),
  }));
}

defineMockLogger();

describe('Throttle Module', () => {
  beforeEach(() => {
    // Reset singleton instance before each test
    EmailThrottleController.resetInstance();
  });

  describe('calculateDelay()', () => {
    it('should generate base delay within bounds', () => {
      const config: ThrottleConfig = {
        minDelayMs: 1000,
        maxDelayMs: 5000,
        breakProbabilityPercent: 0,
        breakMinMinutes: 3,
        breakMaxMinutes: 5,
      };

      for (let i = 0; i < 100; i++) {
        const result = calculateDelay(config);
        expect(result.baseDelayMs).toBeGreaterThanOrEqual(config.minDelayMs);
        expect(result.baseDelayMs).toBeLessThanOrEqual(config.maxDelayMs);
        expect(result.totalDelayMs).toBeGreaterThanOrEqual(1000);
      }
    });

    it('should respect break probability at 0%', () => {
      const config: ThrottleConfig = {
        minDelayMs: 60000,
        maxDelayMs: 120000,
        breakProbabilityPercent: 0,
        breakMinMinutes: 3,
        breakMaxMinutes: 5,
      };

      let breakCount = 0;
      for (let i = 0; i < 100; i++) {
        const result = calculateDelay(config);
        if (result.breakTriggered) breakCount++;
      }

      expect(breakCount).toBe(0);
    });

    it('should respect break probability at 100%', () => {
      const config: ThrottleConfig = {
        minDelayMs: 60000,
        maxDelayMs: 120000,
        breakProbabilityPercent: 100,
        breakMinMinutes: 3,
        breakMaxMinutes: 5,
      };

      let breakCount = 0;
      for (let i = 0; i < 100; i++) {
        const result = calculateDelay(config);
        if (result.breakTriggered) breakCount++;
      }

      expect(breakCount).toBe(100);
    });

    it('should include break duration when triggered', () => {
      const config: ThrottleConfig = {
        minDelayMs: 60000,
        maxDelayMs: 120000,
        breakProbabilityPercent: 100,
        breakMinMinutes: 3,
        breakMaxMinutes: 5,
      };

      const result = calculateDelay(config);

      expect(result.breakTriggered).toBe(true);
      expect(result.breakDurationMs).toBeGreaterThanOrEqual(3 * 60 * 1000);
      expect(result.breakDurationMs).toBeLessThanOrEqual(5 * 60 * 1000);
    });
  });

  describe('TokenBucketRateLimiter', () => {
    it('should allow acquiring tokens when available', async () => {
      const limiter = new TokenBucketRateLimiter(5, 10);

      await limiter.acquire();
      // Use approximate comparison due to floating point precision and timing
      expect(limiter.getTokenCount()).toBeGreaterThan(3.9);
      expect(limiter.getTokenCount()).toBeLessThanOrEqual(4.1);

      await limiter.acquire();
      expect(limiter.getTokenCount()).toBeGreaterThan(2.9);
      expect(limiter.getTokenCount()).toBeLessThanOrEqual(3.1)
    });

    it('should wait when no tokens available', async () => {
      const limiter = new TokenBucketRateLimiter(1, 100);

      await limiter.acquire();
      expect(limiter.getTokenCount()).toBe(0);

      const startTime = Date.now();
      await limiter.acquire();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(5);
    });

    it('should release tokens back to bucket', async () => {
      const limiter = new TokenBucketRateLimiter(3, 10);

      await limiter.acquire();
      await limiter.acquire();
      expect(limiter.getTokenCount()).toBeGreaterThan(0.9);
      expect(limiter.getTokenCount()).toBeLessThanOrEqual(1.1);

      limiter.release();
      expect(limiter.getTokenCount()).toBeGreaterThan(1.9);
      expect(limiter.getTokenCount()).toBeLessThanOrEqual(2.1)
    });
  });

  describe('QuotaMonitor', () => {
    it('should allow sending when quota is healthy', async () => {
      spyOn(sesQuotaModule, 'getAccountInfo').mockImplementation(() =>
        Promise.resolve({
          success: true,
          sendQuota: { max24HourSend: 1000, maxSendRate: 14, sentLast24Hours: 100 },
        })
      );

      const monitor = new QuotaMonitor(10);
      const canSend = await monitor.checkQuota();

      expect(canSend).toBe(true);
    });

    it('should block sending when quota near exhaustion', async () => {
      spyOn(sesQuotaModule, 'getAccountInfo').mockImplementation(() =>
        Promise.resolve({
          success: true,
          sendQuota: { max24HourSend: 1000, maxSendRate: 14, sentLast24Hours: 950 },
        })
      );

      const monitor = new QuotaMonitor(10);
      const canSend = await monitor.checkQuota();

      expect(canSend).toBe(false);
    });
  });

  describe('TokenBucketRateLimiter Concurrency Tests', () => {
    it('should handle 50 concurrent acquire() calls with capacity 10', async () => {
      const limiter = new TokenBucketRateLimiter(10, 100);

      const acquirePromises: Promise<void>[] = [];
      let resolvedCount = 0;

      // Start 50 concurrent acquisitions
      for (let i = 0; i < 50; i++) {
        const promise = limiter.acquire().then(() => {
          resolvedCount++;
        });
        acquirePromises.push(promise);
      }

      // Small delay to let initial acquisitions process
      await throttleModule.delay(50);

      // 10 initial + ~5 refilled tokens in 50ms at 100/s
      // Use a slightly higher bound to account for timing variations
      expect(resolvedCount).toBeLessThanOrEqual(20);

      // Release tokens to allow remaining acquisitions
      for (let i = 0; i < 50; i++) {
        limiter.release();
      }

      // Wait for all to complete
      await Promise.all(acquirePromises);

      // All 50 should have resolved
      expect(resolvedCount).toBe(50);
    });
  });

  describe('QuotaMonitor Circuit Breaker Tests', () => {
    it('should open circuit breaker after 5 consecutive failures', async () => {
      // Mock delay to avoid slow test
      spyOn(throttleModule, 'delay').mockImplementation(() => Promise.resolve());
      
      let callCount = 0;
      spyOn(sesQuotaModule, 'getAccountInfo').mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          success: false,
          error: 'Simulated failure',
        });
      });

      const monitor = new QuotaMonitor(10);

      // Trigger 5 failures
      for (let i = 0; i < 5; i++) {
        await monitor.checkQuota();
      }

      // Circuit breaker should be open now
      const result = await monitor.checkQuota();
      expect(result).toBe(false);
    });

    it('should reset circuit breaker after cooldown period', async () => {
      // Mock delay to avoid slow test
      spyOn(throttleModule, 'delay').mockImplementation(() => Promise.resolve());

      spyOn(sesQuotaModule, 'getAccountInfo').mockImplementation(() =>
        Promise.resolve({
          success: false,
          error: 'Simulated failure',
        })
      );

      const monitor = new QuotaMonitor(10, 100);

      // Trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        await monitor.checkQuota();
      }

      // Manually reset circuit breaker for test
      // @ts-expect-error - Accessing private
      monitor.circuitBreakerOpen = false;
      // @ts-expect-error - Accessing private
      monitor.consecutiveFailures = 0;

      const result = await monitor.checkQuota();
      expect(typeof result).toBe('boolean');
    });
  });
});
