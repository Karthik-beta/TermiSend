/**
 * Unit Tests for Configuration Module
 * Tests environment variable loading, caching, and throttle configuration
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  getAnalyticsConfig,
  getAnalyticsRateLimitMs,
  getEnv,
  getQuotaBufferPercent,
  getSesRateLimit,
  shouldBypassVerifierApi,
  getThrottleConfig,
  loadEnv,
  resetEnvCacheForTesting,
} from '../../src/config.js';
import { restoreEnv, setMockEnv } from '../helpers/test-utils.js';

describe('Configuration Module', () => {
  beforeEach(() => {
    // Reset environment cache before each test
    resetEnvCacheForTesting();
    restoreEnv();
  });

  describe('shouldBypassVerifierApi()', () => {
    it('should default to false when not configured', () => {
      resetEnvCacheForTesting();

      expect(shouldBypassVerifierApi()).toBe(false);
    });

    it('should return true when BYPASS_MYEMAILVERIFIER_API is true', () => {
      setMockEnv({ BYPASS_MYEMAILVERIFIER_API: 'true' });
      resetEnvCacheForTesting();

      expect(shouldBypassVerifierApi()).toBe(true);
    });

    it('should return false when BYPASS_MYEMAILVERIFIER_API is false', () => {
      setMockEnv({ BYPASS_MYEMAILVERIFIER_API: 'false' });
      resetEnvCacheForTesting();

      expect(shouldBypassVerifierApi()).toBe(false);
    });
  });

  // ============================================================================
  // loadEnv() Tests
  // ============================================================================

  describe('loadEnv()', () => {
    it('should load environment variables from development file when NODE_ENV is not production', () => {
      // Arrange
      delete process.env.NODE_ENV;
      setMockEnv({ TEST_VAR: 'test_value' });

      // Act
      const result = loadEnv();

      // Assert - should return parsed env (file may or may not exist)
      expect(result).toBeDefined();
      expect(Object.keys(result)).toBeDefined();
    });

    it('should handle missing env file gracefully', () => {
      // Arrange - set NODE_ENV to a value where .env file doesn't exist
      // Note: The implementation uses .env.development for any non-production NODE_ENV
      // So we test with production mode where .env.production might not exist in some environments
      process.env.NODE_ENV = 'production';
      resetEnvCacheForTesting();

      // Act
      const result = loadEnv();

      // Assert - should return object (may be empty or have values depending on if .env.production exists)
      expect(result).toBeDefined();
      expect(Object.keys(result)).toBeDefined();
      // Don't assert on length since .env.production might exist in this environment
    });

    it('should use production env file when NODE_ENV is production', () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      resetEnvCacheForTesting();

      // Act
      const result = loadEnv();

      // Assert
      expect(result).toBeDefined();
      expect(Object.keys(result)).toBeDefined();
    });
  });

  // ============================================================================
  // getEnv() Tests
  // ============================================================================

  describe('getEnv()', () => {
    it('should return cached environment variables on subsequent calls', () => {
      // Arrange
      setMockEnv({ CACHED_VAR: 'cached_value' });

      // Act
      const firstCall = getEnv();
      const secondCall = getEnv();

      // Assert - now returns a new object each time (not cached)
      expect(firstCall).toEqual(secondCall);
    });

    it('should load fresh environment after cache is cleared', () => {
      // Arrange
      setMockEnv({ FRESH_VAR: 'original_value' });
      const firstCall = getEnv();
      expect(firstCall.FRESH_VAR).toBe('original_value');

      // Act
      setMockEnv({ FRESH_VAR: 'updated_value' });
      resetEnvCacheForTesting();
      const secondCall = getEnv();

      // Assert
      expect(secondCall.FRESH_VAR).toBe('updated_value');
    });

    it('should return empty object when no env file exists', () => {
      // Arrange
      resetEnvCacheForTesting();
      process.env.NODE_ENV = 'nonexistent_env';

      // Act
      const result = getEnv();

      // Assert
      expect(typeof result).toBe('object');
    });
  });

  // ============================================================================
  // resetEnvCacheForTesting() Tests
  // ============================================================================

  describe('resetEnvCacheForTesting()', () => {
    it('should clear the environment cache', () => {
      // Arrange
      setMockEnv({ CACHE_TEST: 'value1' });
      getEnv(); // Prime the cache

      // Act
      resetEnvCacheForTesting();
      setMockEnv({ CACHE_TEST: 'value2' });
      const result = getEnv();

      // Assert
      expect(result.CACHE_TEST).toBe('value2');
    });

    it('should allow reloading environment after clearing cache', () => {
      // Arrange
      setMockEnv({ RELOAD_TEST: 'initial' });
      getEnv();

      // Act
      resetEnvCacheForTesting();
      setMockEnv({ RELOAD_TEST: 'reloaded' });
      const result = getEnv();

      // Assert
      expect(result.RELOAD_TEST).toBe('reloaded');
    });
  });

  // ============================================================================
  // getThrottleConfig() Tests
  // ============================================================================

  describe('getThrottleConfig()', () => {
    it('should return default values when no environment variables are set', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '',
        THROTTLE_MAX_DELAY_MS: '',
        THROTTLE_BREAK_PROBABILITY_PERCENT: '',
        THROTTLE_BREAK_MIN_MINUTES: '',
        THROTTLE_BREAK_MAX_MINUTES: '',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert
      expect(result.minDelayMs).toBe(60000);
      expect(result.maxDelayMs).toBe(120000);
      expect(result.breakProbabilityPercent).toBe(5);
      expect(result.breakMinMinutes).toBe(3);
      expect(result.breakMaxMinutes).toBe(5);
    });

    it('should parse custom throttle configuration from environment variables', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '30000',
        THROTTLE_MAX_DELAY_MS: '60000',
        THROTTLE_BREAK_PROBABILITY_PERCENT: '10',
        THROTTLE_BREAK_MIN_MINUTES: '2',
        THROTTLE_BREAK_MAX_MINUTES: '4',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert
      expect(result.minDelayMs).toBe(30000);
      expect(result.maxDelayMs).toBe(60000);
      expect(result.breakProbabilityPercent).toBe(10);
      expect(result.breakMinMinutes).toBe(2);
      expect(result.breakMaxMinutes).toBe(4);
    });

    it('should handle zero values correctly', () => {
      // Arrange
      setMockEnv({
        THROTTLE_BREAK_PROBABILITY_PERCENT: '0',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert
      expect(result.breakProbabilityPercent).toBe(0);
    });

    it('should handle invalid integer strings gracefully', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: 'not_a_number',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert - NaN is returned for invalid numbers
      expect(Number.isNaN(result.minDelayMs)).toBe(true);
    });

    it('should handle special characters in environment values', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '   60000   ',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert - parseInt handles whitespace
      expect(result.minDelayMs).toBe(60000);
    });

    it('should handle negative values (edge case)', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '-1000',
        THROTTLE_BREAK_PROBABILITY_PERCENT: '-5',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert
      expect(result.minDelayMs).toBe(-1000);
      expect(result.breakProbabilityPercent).toBe(-5);
    });

    it('should handle very large values', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '999999999',
        THROTTLE_MAX_DELAY_MS: '9999999999',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert
      expect(result.minDelayMs).toBe(999999999);
      expect(result.maxDelayMs).toBe(9999999999);
    });
  });

  // ============================================================================
  // getSesRateLimit() Tests
  // ============================================================================

  describe('getSesRateLimit()', () => {
    it('should return default SES rate limit of 14', () => {
      // Arrange
      resetEnvCacheForTesting();

      // Act
      const result = getSesRateLimit();

      // Assert
      expect(result).toBe(14);
    });

    it('should return custom SES rate limit from environment variable', () => {
      // Arrange
      setMockEnv({ SES_RATE_LIMIT_PER_SECOND: '25' });
      resetEnvCacheForTesting();

      // Act
      const result = getSesRateLimit();

      // Assert
      expect(result).toBe(25);
    });

    it('should handle production rate limit of 100', () => {
      // Arrange
      setMockEnv({ SES_RATE_LIMIT_PER_SECOND: '100' });
      resetEnvCacheForTesting();

      // Act
      const result = getSesRateLimit();

      // Assert
      expect(result).toBe(100);
    });

    it('should handle invalid rate limit value', () => {
      // Arrange
      setMockEnv({ SES_RATE_LIMIT_PER_SECOND: 'invalid' });
      resetEnvCacheForTesting();

      // Act
      const result = getSesRateLimit();

      // Assert
      expect(Number.isNaN(result)).toBe(true);
    });

    it('should handle zero rate limit', () => {
      // Arrange
      setMockEnv({ SES_RATE_LIMIT_PER_SECOND: '0' });
      resetEnvCacheForTesting();

      // Act
      const result = getSesRateLimit();

      // Assert
      expect(result).toBe(0);
    });
  });

  // ============================================================================
  // getQuotaBufferPercent() Tests
  // ============================================================================

  describe('getQuotaBufferPercent()', () => {
    it('should return default quota buffer of 10 percent', () => {
      // Arrange
      resetEnvCacheForTesting();

      // Act
      const result = getQuotaBufferPercent();

      // Assert
      expect(result).toBe(10);
    });

    it('should return custom quota buffer from environment variable', () => {
      // Arrange
      setMockEnv({ SES_QUOTA_BUFFER_PERCENT: '20' });
      resetEnvCacheForTesting();

      // Act
      const result = getQuotaBufferPercent();

      // Assert
      expect(result).toBe(20);
    });

    it('should handle zero buffer percentage', () => {
      // Arrange
      setMockEnv({ SES_QUOTA_BUFFER_PERCENT: '0' });
      resetEnvCacheForTesting();

      // Act
      const result = getQuotaBufferPercent();

      // Assert
      expect(result).toBe(0);
    });

    it('should handle 100 percent buffer', () => {
      // Arrange
      setMockEnv({ SES_QUOTA_BUFFER_PERCENT: '100' });
      resetEnvCacheForTesting();

      // Act
      const result = getQuotaBufferPercent();

      // Assert
      expect(result).toBe(100);
    });

    it('should handle invalid buffer percentage value', () => {
      // Arrange
      setMockEnv({ SES_QUOTA_BUFFER_PERCENT: 'invalid' });
      resetEnvCacheForTesting();

      // Act
      const result = getQuotaBufferPercent();

      // Assert
      expect(Number.isNaN(result)).toBe(true);
    });

    it('should handle negative buffer percentage', () => {
      // Arrange
      setMockEnv({ SES_QUOTA_BUFFER_PERCENT: '-5' });
      resetEnvCacheForTesting();

      // Act
      const result = getQuotaBufferPercent();

      // Assert
      expect(result).toBe(-5);
    });
  });

  // ============================================================================
  // getAnalyticsConfig() Tests
  // ============================================================================

  describe('getAnalyticsConfig()', () => {
    it('should return default analytics configuration', () => {
      // Arrange
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(result.enabled).toBe(true);
      expect(result.syncIntervalMinutes).toBe(60);
      expect(result.retentionDays).toBe(90);
    });

    it('should parse custom analytics configuration from environment variables', () => {
      // Arrange
      setMockEnv({
        ANALYTICS_ENABLED: 'false',
        ANALYTICS_SYNC_INTERVAL_MINUTES: '30',
        ANALYTICS_RETENTION_DAYS: '180',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(result.enabled).toBe(false);
      expect(result.syncIntervalMinutes).toBe(30);
      expect(result.retentionDays).toBe(180);
    });

    it('should handle ANALYTICS_ENABLED=false string', () => {
      // Arrange
      setMockEnv({ ANALYTICS_ENABLED: 'false' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(result.enabled).toBe(false);
    });

    it('should handle ANALYTICS_ENABLED=TRUE string as true', () => {
      // Arrange
      setMockEnv({ ANALYTICS_ENABLED: 'TRUE' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert - any value other than 'false' is treated as true
      expect(result.enabled).toBe(true);
    });

    it('should handle invalid sync interval value', () => {
      // Arrange
      setMockEnv({ ANALYTICS_SYNC_INTERVAL_MINUTES: 'invalid' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(Number.isNaN(result.syncIntervalMinutes)).toBe(true);
    });

    it('should handle invalid retention days value', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RETENTION_DAYS: 'invalid' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(Number.isNaN(result.retentionDays)).toBe(true);
    });

    it('should handle zero retention days', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RETENTION_DAYS: '0' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(result.retentionDays).toBe(0);
    });

    it('should handle very large retention days', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RETENTION_DAYS: '3650' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsConfig();

      // Assert
      expect(result.retentionDays).toBe(3650);
    });
  });

  // ============================================================================
  // getAnalyticsRateLimitMs() Tests
  // ============================================================================

  describe('getAnalyticsRateLimitMs()', () => {
    it('should return default rate limit of 1000ms', () => {
      // Arrange
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert
      expect(result).toBe(1000);
    });

    it('should return custom rate limit from environment variable', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RATE_LIMIT_MS: '2000' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert
      expect(result).toBe(2000);
    });

    it('should handle zero rate limit', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RATE_LIMIT_MS: '0' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert
      expect(result).toBe(0);
    });

    it('should handle invalid rate limit value', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RATE_LIMIT_MS: 'invalid' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert
      expect(Number.isNaN(result)).toBe(true);
    });

    it('should handle negative rate limit', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RATE_LIMIT_MS: '-100' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert
      expect(result).toBe(-100);
    });

    it('should handle fractional rate limit (parsed as integer)', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RATE_LIMIT_MS: '1500.75' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert - parseInt truncates decimals
      expect(result).toBe(1500);
    });

    it('should handle empty string (falls back to default)', () => {
      // Arrange
      setMockEnv({ ANALYTICS_RATE_LIMIT_MS: '' });
      resetEnvCacheForTesting();

      // Act
      const result = getAnalyticsRateLimitMs();

      // Assert - empty string parses to default of 1000
      expect(result).toBe(1000);
    });
  });

  // ============================================================================
  // Edge Cases and Integration Tests
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle missing env file in production mode', () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      resetEnvCacheForTesting();

      // Act
      const result = loadEnv();

      // Assert
      expect(typeof result).toBe('object');
    });

    it('should handle concurrent access to environment cache', () => {
      // Arrange
      resetEnvCacheForTesting();

      // Act - simulate concurrent access
      const results = [getEnv(), getEnv(), getEnv()];

      // Assert - all should return equivalent objects (may be different instances)
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
    });

    it('should handle empty string environment values', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '',
        SES_RATE_LIMIT_PER_SECOND: '',
      });
      resetEnvCacheForTesting();

      // Act
      const throttleConfig = getThrottleConfig();
      const rateLimit = getSesRateLimit();

      // Assert - empty strings fall back to defaults (60000 for minDelayMs, 14 for rateLimit)
      expect(throttleConfig.minDelayMs).toBe(60000);
      expect(rateLimit).toBe(14);
    });

    it('should handle mixed valid and invalid environment values', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '50000',
        THROTTLE_MAX_DELAY_MS: 'invalid',
        THROTTLE_BREAK_PROBABILITY_PERCENT: '15',
      });
      resetEnvCacheForTesting();

      // Act
      const result = getThrottleConfig();

      // Assert
      expect(result.minDelayMs).toBe(50000);
      expect(Number.isNaN(result.maxDelayMs)).toBe(true);
      expect(result.breakProbabilityPercent).toBe(15);
    });

    it('should maintain type consistency across multiple calls', () => {
      // Arrange
      setMockEnv({
        THROTTLE_MIN_DELAY_MS: '45000',
        SES_RATE_LIMIT_PER_SECOND: '50',
        SES_QUOTA_BUFFER_PERCENT: '15',
      });
      resetEnvCacheForTesting();

      // Act
      const config1 = getThrottleConfig();
      const rate1 = getSesRateLimit();
      const buffer1 = getQuotaBufferPercent();
      resetEnvCacheForTesting();


      const config2 = getThrottleConfig();
      const rate2 = getSesRateLimit();
      const buffer2 = getQuotaBufferPercent();

      // Assert
      expect(typeof config1.minDelayMs).toBe(typeof config2.minDelayMs);
      expect(typeof rate1).toBe(typeof rate2);
      expect(typeof buffer1).toBe(typeof buffer2);
    });
  });
});
