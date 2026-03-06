/**
 * TokenBucketRateLimiter Concurrency Tests
 * Verifies that the rate limiter handles multiple concurrent requests correctly
 */

import { describe, expect, it } from 'bun:test';
import { TokenBucketRateLimiter, delay } from '../../src/throttle.js';

describe('TokenBucketRateLimiter Concurrency', () => {
  it('should handle high volume of concurrent acquisitions safely', async () => {
    // Capacity 10, refill 100 per second
    const limiter = new TokenBucketRateLimiter(10, 100);
    const totalRequests = 50;
    const start = Date.now();

    const results: number[] = [];
    const promises = Array.from({ length: totalRequests }, async (_, i) => {
      await limiter.acquire();
      results.push(i);
      return Date.now() - start;
    });

    const completionTimes = await Promise.all(promises);

    // All requests should complete
    expect(results.length).toBe(totalRequests);

    // First 10 should complete very fast
    const first10 = completionTimes.slice(0, 10);
    for (const time of first10) {
      expect(time).toBeLessThan(100);
    }

    // Last request should take at least ~400ms (50 requests, 10 immediate, 40 need refill at 100/s = 10ms per token)
    // 40 * 10ms = 400ms
    const lastTime = completionTimes[totalRequests - 1];
    expect(lastTime).toBeGreaterThanOrEqual(350);
  });

  it('should maintain FIFO order under heavy load', async () => {
    const limiter = new TokenBucketRateLimiter(1, 1000); // 1 token, fast refill
    const totalRequests = 20;
    const order: number[] = [];

    const promises = Array.from({ length: totalRequests }, async (_, i) => {
      await limiter.acquire();
      order.push(i);
    });

    await Promise.all(promises);

    // Order should be exactly 0, 1, 2, ..., 19
    expect(order).toEqual(Array.from({ length: totalRequests }, (_, i) => i));
  });

  it('should not leak tokens or drift over time', async () => {
    const limiter = new TokenBucketRateLimiter(5, 100);

    // Drain bucket
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }

    // Flush event loop using setImmediate/setTimeout
    await new Promise(resolve => setTimeout(resolve, 150));

    // Token count should be back to at least 1, but no more than 5
    const count = limiter.getTokenCount();
    expect(count).toBeGreaterThan(0.9);
    expect(count).toBeLessThanOrEqual(5);
  });

  it('should reject requests when the pending queue is full', async () => {
    const limiter = new TokenBucketRateLimiter(1, 1000); // 1 token, fast refill

    // Acquire the only token and hold it
    await limiter.acquire();

    // Fill the queue (MAX_PENDING_REQUESTS is 100)
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(limiter.acquire());
    }

    // The next one should fail immediately
    await expect(limiter.acquire()).rejects.toThrow('Rate limiter queue full');

    // Cleanup - wait for natural refill (100 tokens at 1000/s = 100ms)
    await Promise.all(promises);
  });

});
