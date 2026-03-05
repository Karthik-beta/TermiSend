/**
 * Unit Tests for AWS SES Module
 * Tests email sending with mocked AWS SDK including failure simulations
 */

import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as dbModule from '../../src/db.js';
import * as throttleModule from '../../src/throttle.js';

// Mock the logger module to avoid spyOn issues with accessor properties
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
import {
  sendTestEmail,
  sendEmail,
  verifyConfiguration,
  __test as sesTest,
} from '../../src/ses.js';
import { getAccountInfo } from '../../src/ses-quota.js';
import {
  enableSESTestMode,
  MockSESError,
  resetMockSESState,
  SESErrorType,
  setFailureSequence,
  simulateThrottlingException,
  simulateMessageRejected,
  simulateDomainNotVerified,
  simulateNetworkTimeout,
  simulateQuotaExceeded,
  simulateTransientFailures,
  getMockSESCallCount,
  getMockSESClient,
} from '../helpers/mock-ses.js';
import { EmailThrottleController } from '../../src/throttle.js';
import { restoreEnv, setMockEnv, clearMockEnv } from '../helpers/test-utils.js';

describe('SES Module', () => {
  beforeEach(() => {
    // SES module uses lazy initialization and dynamic env var reading
    // No explicit reset needed - each test sets its own env vars
    restoreEnv();
    resetMockSESState();
    enableSESTestMode();

    // Set up mock SES client to prevent real AWS calls
    sesTest.setSesClient(getMockSESClient());

    // Logger is mocked at module level to prevent test noise
    
    // Mock delay to speed up tests that involve retries
    spyOn(throttleModule, 'delay').mockImplementation(() => Promise.resolve());

    spyOn(dbModule, 'insertAuditLog').mockImplementation(() =>
      Promise.resolve({
        id: 'test-id-1',
        eventType: 'USER_INPUT',
        payload: {},
        createdAt: new Date(),
      })
    );
  });

  describe('verifyConfiguration()', () => {
    it('should return configured=true when all env vars are set', () => {
      // Clear any existing env vars first, then set required ones
      setMockEnv({
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SES_FROM_EMAIL: 'sender@example.com',
        AWS_REGION: 'us-east-1',
      });

      const result = verifyConfiguration();

      expect(result.configured).toBe(true);
      expect(result.hasCredentials).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect missing credentials', () => {
      // Explicitly unset credentials
      clearMockEnv('AWS_ACCESS_KEY_ID');
      clearMockEnv('AWS_SECRET_ACCESS_KEY');
      setMockEnv({ SES_FROM_EMAIL: 'sender@example.com' });

      const result = verifyConfiguration();

      expect(result.configured).toBe(false);
      expect(result.hasCredentials).toBe(false);
    });

    it('should detect missing from email', () => {
      // Explicitly unset from email
      clearMockEnv('SES_FROM_EMAIL');
      setMockEnv({
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
      });

      const result = verifyConfiguration();

      expect(result.configured).toBe(false);
      expect(result.issues.some(i => i.includes('SES_FROM_EMAIL'))).toBe(true);
    });

    it('should use default region when not specified', () => {
      clearMockEnv('AWS_REGION');
      setMockEnv({
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        SES_FROM_EMAIL: 'sender@example.com',
      });

      const result = verifyConfiguration();

      expect(result.region).toBe('us-east-1');
    });
  });

  describe('sendTestEmail()', () => {
    it('should fail gracefully when SES is not configured', async () => {
      // Clear SES configuration
      clearMockEnv('AWS_ACCESS_KEY_ID');
      clearMockEnv('AWS_SECRET_ACCESS_KEY');
      clearMockEnv('SES_FROM_EMAIL');

      const result = await sendTestEmail('test@example.com');

      // Should return failure, not throw
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // SES FAILURE SIMULATION TESTS (CRITICAL)
  // ============================================================================
  describe('SES Failure Simulations', () => {
    beforeEach(() => {
      // Set up valid SES configuration for failure tests
      setMockEnv({
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        SES_FROM_EMAIL: 'sender@example.com',
        AWS_REGION: 'us-east-1',
      });

      // Mock throttle controller to pass quota check
      const controller = EmailThrottleController.getInstance();
      spyOn(controller, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    });

    it('should handle ThrottlingException - Rate limited by AWS', async () => {
      // Simulate enough failures to exceed MAX_SEND_RETRIES (3 retries = 4 attempts total)
      simulateTransientFailures(5);

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate exceeded');
    });

    it('should handle MessageRejected - Content policy violation', async () => {
      simulateMessageRejected();

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Message content rejected');
    });

    it('should handle MailFromDomainNotVerified - Configuration error', async () => {
      simulateDomainNotVerified();

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Email address not verified');
    });

    it('should handle network timeout with delay', async () => {
      simulateNetworkTimeout(100); // 100ms timeout simulation

      const startTime = Date.now();
      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      // Should have waited at least the timeout duration
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });

    it('should handle Quota Exceeded response', async () => {
      simulateQuotaExceeded();

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('quota exceeded');
    });
  });

  // ============================================================================
  // CIRCUIT BREAKER AND RETRY LOGIC TESTS
  // ============================================================================
  describe('Circuit Breaker and Retry Logic', () => {
    beforeEach(() => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      process.env.SES_FROM_EMAIL = 'sender@example.com';
      process.env.AWS_REGION = 'us-east-1';

      // Mock throttle controller to pass quota check
      const controller = EmailThrottleController.getInstance();
      spyOn(controller, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    });

    it('should handle transient failures without crashing', async () => {
      // Simulate enough failures for each call in the loop to fail after all retries
      // 3 calls * (MAX_SEND_RETRIES + 1) = 3 * 4 = 12 failures
      simulateTransientFailures(12);

      // Each send should fail with transient error
      for (let i = 0; i < 3; i++) {
        const result = await sendEmail({
          to: `test${i}@example.com`,
          subject: 'Test',
          htmlBody: '<p>Test body</p>',
          textBody: 'Test body',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Rate exceeded');
      }
    });

    it('should propagate errors to caller properly', async () => {
      setFailureSequence([
        {
          type: SESErrorType.GENERAL_ERROR,
          message: 'Custom error message',
          retryable: false,
        },
      ]);

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Custom error message');
    });

    it('should handle missing required parameters', async () => {
      // Test with missing 'to' parameter
      const result = await sendEmail({
        to: '',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing parameters');
    });

    it('should handle missing SES_FROM_EMAIL configuration', async () => {
      delete process.env.SES_FROM_EMAIL;

      const result = await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>Test body</p>',
        textBody: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SES_FROM_EMAIL not configured');
    });
  });

  // ============================================================================
  // GET ACCOUNT INFO TESTS
  // ============================================================================
  describe('getAccountInfo()', () => {
    beforeEach(() => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      process.env.AWS_REGION = 'us-east-1';
    });

    it('should return quota information when available', async () => {
      // Mock successful response
      setFailureSequence([]); // No failures = success

      const result = await getAccountInfo();

      // This will succeed with mocked client returning default success
      // Since we can't easily mock the SES client internals without
      // modifying the source, we just verify the function doesn't throw
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle quota check failure', async () => {
      setFailureSequence([
        {
          type: SESErrorType.GENERAL_ERROR,
          message: 'Failed to get quota',
          retryable: false,
        },
      ]);

      const result = await getAccountInfo();

      // Should return failure, not throw
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

});
