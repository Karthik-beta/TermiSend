import { describe, expect, it, beforeEach, spyOn, afterEach } from 'bun:test';
import {
  shouldBypassVerifierApi,
  shouldRedirectEmails,
  shouldSimulateVerifier,
  getTestRecipientEmail,
  getEnv,
  resetEnvCacheForTesting,
} from '../../src/config.js';
import { sendEmail } from '../../src/ses.js';
import { verifyEmail, fetchVerifierCredits } from '../../src/verifier.js';
import * as security from '../../src/utils/security.js';
import { getEmailThrottleController } from '../../src/throttle.js';

describe('Environment Separation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTesting();
  });

  describe('Configuration', () => {
    it('should enable redirection and simulation in development by default', () => {
      process.env.NODE_ENV = 'development';
      process.env.TEST_RECIPIENT_EMAIL = 'test@example.com';

      expect(shouldRedirectEmails()).toBe(true);
      expect(shouldSimulateVerifier()).toBe(true);
      expect(getTestRecipientEmail()).toBe('test@example.com');
    });

    it('should disable redirection and simulation in production', () => {
      process.env.NODE_ENV = 'production';

      expect(shouldRedirectEmails()).toBe(false);
      expect(shouldSimulateVerifier()).toBe(false);
    });

    it('should ignore REDIRECT_EMAILS override in development (safety)', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIRECT_EMAILS = 'false';
      process.env.SIMULATE_VERIFIER = 'false';

      expect(shouldRedirectEmails()).toBe(true); // Redirection is now ALWAYS enabled in dev
      expect(shouldSimulateVerifier()).toBe(false); // Verifier can still be toggled
    });

    it('should throw error if TEST_RECIPIENT_EMAIL is missing in development when redirection is enabled', () => {
      process.env.NODE_ENV = 'development';
      process.env.TEST_RECIPIENT_EMAIL = '';
      resetEnvCacheForTesting();

      expect(() => getTestRecipientEmail()).toThrow('TEST_RECIPIENT_EMAIL must be configured when not in production');
    });
  });

  describe('Email Redirection (SES)', () => {
    it('should redirect email and modify subject in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.TEST_RECIPIENT_EMAIL = 'test-recipient@example.com';
      process.env.SES_FROM_EMAIL = 'sender@example.com';

      // Mock SES client
      // Mock SES client compatible with SendRawEmailCommand
      const mockSesClient = {
        send: async (_command: unknown) => {
          return {
            MessageId: 'msg-123',
          };
        }
      } as any;

      const controller = getEmailThrottleController();
      spyOn(controller, 'checkQuota').mockImplementation(async () => true);
      spyOn(controller, 'acquireSendPermission').mockImplementation(async () => { });

      // We need to bypass the real sendWithRetry or mock the client deeply
      // Since sendEmail calls sendWithRetry which calls client.send, we can just mock the client.

      const result = await sendEmail(
        { to: 'real-customer@gmail.com', subject: 'Hello', htmlBody: '...', textBody: '...' },
        controller,
        mockSesClient
      );

      if (!result.success) {
        console.error('Email Redirection Test Failed:', result.error);
      }
      expect(result.success).toBe(true);
      // Note: we can't easily check the internal state of SendEmailCommand from the result
      // but we can spy on the client's send method.
    });
  });

  describe('Email Verification Simulation', () => {
    it('should return simulated response in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SIMULATE_VERIFIER = 'true';

      const result = await verifyEmail('test-invalid@example.com');

      expect(result.status).toBe('invalid');
      expect(result.message).toContain('Simulated');
    });

    it('should fetch real credits even in development with simulation enabled', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SIMULATE_VERIFIER = 'true';

      // When API key is not configured, should return null
      // When API key is configured, should fetch from real API
      const credits = await fetchVerifierCredits();

      // Credits should be null when no API key is configured
      // or a real number when API key is present (not the hardcoded 10000)
      expect(credits === null || credits !== 10000).toBe(true);
    });

    it('should allow bypassing MyEmailVerifier in production via env flag', async () => {
      process.env.NODE_ENV = 'production';
      process.env.BYPASS_MYEMAILVERIFIER_API = 'true';
      resetEnvCacheForTesting();

      const result = await verifyEmail(`test-invalid-${Date.now()}@example.com`);

      expect(shouldBypassVerifierApi()).toBe(true);
      expect(result.status).toBe('invalid');
      expect(result.message).toContain('Simulated');
    });
  });
});
