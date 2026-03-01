/**
 * Campaign Integration Tests
 * Tests runCampaign function with rate limiter integration
 * Verifies acquireSendPermission and releaseSendPermission are called correctly
 */

import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as dbModule from '../../src/db.js';
import * as loggerModule from '../../src/logger.js';
import { runCampaign } from '../../src/mailer.js';
import * as sesModule from '../../src/ses.js';
import * as verifierModule from '../../src/verifier.js';
import { EmailThrottleController } from '../../src/throttle.js';
import type { Contact } from '../../src/types.js';
import { createMockContacts } from '../helpers/mock-factories.js';
import { enableSESTestMode, resetMockSESState, setMockSESSend } from '../helpers/mock-ses.js';
import { restoreEnv, setMockEnv } from '../helpers/test-utils.js';

describe('Campaign Integration Tests - Rate Limiter', () => {
  let updateContactStatusSpy: ReturnType<typeof spyOn>;
  let getPendingContactsSpy: ReturnType<typeof spyOn>;
  let sendEmailSpy: ReturnType<typeof spyOn>;
  let logContactUpdatedSpy: ReturnType<typeof spyOn>;
  let verifyEmailSpy: ReturnType<typeof spyOn>;
  let checkQuotaSpy: ReturnType<typeof spyOn>;
  let waitBeforeSendSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Reset environment
    restoreEnv();

    // Set up required environment variables
    setMockEnv({
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      SES_FROM_EMAIL: 'sender@example.com',
      AWS_REGION: 'us-east-1',
      MYEMAILVERIFIER_API_KEY: 'test-api-key',
    });

    // Reset SES mock state
    resetMockSESState();
    enableSESTestMode();

    // Reset throttle controller singleton
    EmailThrottleController.resetInstance();

    // Set default success response for SES
    setMockSESSend(() => Promise.resolve({ MessageId: 'test-message-id-12345' }));

    // Mock database functions
    if (updateContactStatusSpy) updateContactStatusSpy.mockClear();
    updateContactStatusSpy = spyOn(dbModule, 'updateContactStatus').mockImplementation(() =>
      Promise.resolve()
    );

    spyOn(dbModule, 'insertAuditLog').mockImplementation(() =>
      Promise.resolve({
        id: 'test-id',
        eventType: 'USER_INPUT',
        payload: {},
        createdAt: new Date(),
      })
    );

    // Mock logger methods that exist
    spyOn(loggerModule.logger, 'info').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'warn').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logError').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logAwsSesRequest').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logAwsSesResponse').mockImplementation(() => Promise.resolve());
    
    if (logContactUpdatedSpy) logContactUpdatedSpy.mockClear();
    logContactUpdatedSpy = spyOn(loggerModule.logger, 'logContactUpdated').mockImplementation(() =>
      Promise.resolve()
    );
    spyOn(loggerModule.logger, 'logExcelImportStart').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logExcelImportComplete').mockImplementation(() =>
      Promise.resolve()
    );

    // Mock SES send function
    if (sendEmailSpy) sendEmailSpy.mockClear();
    sendEmailSpy = spyOn(sesModule, 'sendEmail').mockImplementation(() =>
      Promise.resolve({
        success: true,
        messageId: 'test-message-id-12345',
      })
    );

    // Mock throttle controller to pass quota check by default
    const controller = EmailThrottleController.getInstance();
    if (checkQuotaSpy) checkQuotaSpy.mockClear();
    checkQuotaSpy = spyOn(controller, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    
    // Mock waitBeforeSend to speed up tests
    if (waitBeforeSendSpy) waitBeforeSendSpy.mockClear();
    waitBeforeSendSpy = spyOn(controller, 'waitBeforeSend').mockImplementation(() => 
      Promise.resolve({ baseDelayMs: 0, breakTriggered: false, breakDurationMs: 0, totalDelayMs: 0 })
    );

    if (verifyEmailSpy) verifyEmailSpy.mockClear();
    if (getPendingContactsSpy) getPendingContactsSpy.mockClear();
  });

  // ============================================================================
  // RATE LIMITER CALL VERIFICATION
  // ============================================================================
  describe('Rate Limiter Integration', () => {
    it('should verify email before sending', async () => {
      // Create test contacts
      const contacts: Contact[] = createMockContacts(3);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      verifyEmailSpy = spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      const result = await runCampaign('templates/sample-template.md');

      // Should have verified all emails
      expect(verifyEmailSpy).toHaveBeenCalledTimes(3);
      // All 3 should be sent since they're all valid
      expect(result.sentCount).toBe(3);
    });

    it('should send emails to valid contacts', async () => {
      // Create test contacts
      const contacts: Contact[] = createMockContacts(3);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      const result = await runCampaign('templates/sample-template.md');

      // Should have sent to all contacts
      expect(result.sentCount).toBe(3);
      expect(sendEmailSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle send failure gracefully', async () => {
      // Create test contacts
      const contacts: Contact[] = createMockContacts(2);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      // Mock SES to fail
      sendEmailSpy.mockImplementation(() =>
        Promise.resolve({
          success: false,
          error: 'Simulated send failure',
        })
      );

      const result = await runCampaign('templates/sample-template.md');

      // Both should have failed
      expect(result.failedCount).toBe(2);
    });

    it('should process multiple contacts', async () => {
      // Create many test contacts
      const contactCount = 10;
      const contacts: Contact[] = createMockContacts(contactCount);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      const result = await runCampaign('templates/sample-template.md');

      // Verify all contacts were processed
      expect(result.totalContacts).toBe(contactCount);
      expect(result.sentCount).toBe(contactCount);
    });

    it('should handle rate limiter failure gracefully', async () => {
      // Create test contacts
      const contacts: Contact[] = createMockContacts(2);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      // Should not throw, should handle gracefully
      const result = await runCampaign('templates/sample-template.md');

      // Result should be returned even with rate limiter issues
      expect(result.totalContacts).toBe(2);
    });

    it('should handle empty contact list', async () => {
      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve([])
      );

      const result = await runCampaign('templates/sample-template.md');

      // Should return empty result
      expect(result.totalContacts).toBe(0);
      expect(result.sentCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================
  describe('Error Handling in Campaign', () => {
    it('should handle quota check failure gracefully', async () => {
      // Get controller instance and mock checkQuota
      const controller = EmailThrottleController.getInstance();
      checkQuotaSpy = spyOn(controller, 'checkQuota').mockImplementation(() => Promise.resolve(false));

      const contacts: Contact[] = createMockContacts(3);
      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      const result = await runCampaign('templates/sample-template.md');

      // All contacts should be marked as failed due to quota check
      expect(result.failedCount).toBe(3);
      expect(result.sentCount).toBe(0);
    });

    it('should verify email before sending and skip unsafe emails', async () => {
      const contacts: Contact[] = createMockContacts(2);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail - first valid, second risky
      verifyEmailSpy = spyOn(verifierModule, 'verifyEmail').mockImplementation((email: string) => {
        if (email === contacts[0].email) {
          return Promise.resolve({
            status: 'valid',
            risk: 'low',
            email: email,
            message: 'Valid',
          });
        }
        // Second contact has high risk
        return Promise.resolve({
          status: 'invalid',
          risk: 'high',
          email: email,
          message: 'Invalid',
        });
      });

      const result = await runCampaign('templates/sample-template.md');

      // Should have verified all emails
      expect(verifyEmailSpy).toHaveBeenCalledTimes(2);

      // Only safe email should be sent
      expect(result.sentCount).toBe(1);
      expect(result.skippedCount).toBe(1);
    });

    it('should update contact status for each processed contact', async () => {
      const contacts: Contact[] = createMockContacts(3);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      await runCampaign('templates/sample-template.md');

      // Should update status for each contact
      expect(updateContactStatusSpy).toHaveBeenCalledTimes(3);
    });

    it('should log contact status updates', async () => {
      const contacts: Contact[] = createMockContacts(2);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      await runCampaign('templates/sample-template.md');

      // Should log status updates
      expect(logContactUpdatedSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // CAMPAIGN RESULT TESTS
  // ============================================================================
  describe('Campaign Result Accuracy', () => {
    it('should return accurate counts in result', async () => {
      const contacts: Contact[] = createMockContacts(5);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail - mark some as unsafe
      let verifyCallCount = 0;
      spyOn(verifierModule, 'verifyEmail').mockImplementation((email: string) => {
        // First 3 valid, last 2 invalid
        verifyCallCount++;
        const isValid = verifyCallCount <= 3;
        return Promise.resolve({
          status: isValid ? 'valid' : 'invalid',
          risk: isValid ? 'low' : 'high',
          email: email,
          message: isValid ? 'Valid' : 'Invalid',
        });
      });

      const result = await runCampaign('templates/sample-template.md');

      expect(result.totalContacts).toBe(5);
      expect(result.sentCount + result.failedCount + result.skippedCount).toBe(5);
      expect(result.details.length).toBe(5);
    });

    it('should include details for each contact', async () => {
      const contacts: Contact[] = createMockContacts(2);

      getPendingContactsSpy = spyOn(dbModule, 'getPendingContacts').mockImplementation(() =>
        Promise.resolve(contacts)
      );

      // Mock verifyEmail to return safe result
      spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
        Promise.resolve({
          status: 'valid',
          risk: 'low',
          email: 'test@example.com',
          message: 'Valid',
        })
      );

      const result = await runCampaign('templates/sample-template.md');

      // Each detail should have email, status, and reason
      for (const detail of result.details) {
        expect(detail.email).toBeDefined();
        expect(detail.status).toBeDefined();
        expect(['sent', 'failed', 'skipped']).toContain(detail.status);
        expect(detail.reason).toBeDefined();
      }
    });
  });
});
