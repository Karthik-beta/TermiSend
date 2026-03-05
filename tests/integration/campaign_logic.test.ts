/**
 * Campaign Logic Integration Test
 * Verifies that runCampaign orchestrates throttle, verification, and SES correctly
 */

import { describe, expect, it, spyOn, beforeEach, afterEach, mock } from 'bun:test';
import { runCampaign } from '../../src/mailer.js';
import * as sesModule from '../../src/ses.js';
import * as dbModule from '../../src/db.js';
import * as verifierModule from '../../src/verifier.js';
import { EmailThrottleController } from '../../src/throttle.js';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { restoreEnv, setMockEnv } from '../helpers/test-utils.js';
import * as loggerModule from '../../src/logger.js';
import { resetCampaignState } from '../../src/mailer.js';

describe('runCampaign Integration', () => {
  const tempDir = resolve(process.cwd(), 'templates');
  const tempTemplate = resolve(tempDir, 'test-campaign-template.md');

  beforeEach(() => {
    // Setup temp template
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
    writeFileSync(tempTemplate, `# Hello {Person Name}\n\nWelcome to {Company Name}!`);

    restoreEnv();
    setMockEnv({
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      SES_FROM_EMAIL: 'sender@example.com',
      AWS_REGION: 'us-east-1',
      MYEMAILVERIFIER_API_KEY: 'test-api-key',
      EMAIL_TEMPLATE_PATH: tempTemplate,
      SUBJECT_TEMPLATE_PATH: tempTemplate,
    });
    // Reset mocks
    spyOn(dbModule, 'getEligibleContacts').mockClear();
    spyOn(dbModule, 'getEligibleContactCount').mockClear();
    spyOn(dbModule, 'createSendLog').mockClear();
    spyOn(dbModule, 'updateSendLog').mockClear();
    spyOn(dbModule, 'insertAuditLog').mockClear();
    spyOn(dbModule, 'createMessageEvent').mockClear();
    spyOn(verifierModule, 'verifyEmail').mockClear();
    spyOn(sesModule, 'sendEmail').mockClear();

    spyOn(loggerModule.logger, 'info').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'warn').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logError').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logAwsSesRequest').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logAwsSesResponse').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logSendLogUpdated').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logExcelImportStart').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logExcelImportComplete').mockImplementation(() => Promise.resolve());

    spyOn(dbModule, 'getEligibleContactCount').mockImplementation(() => Promise.resolve(0));
    spyOn(dbModule, 'createSendLog').mockImplementation(() => Promise.resolve('log-123' as any));
    spyOn(dbModule, 'updateSendLog').mockImplementation(() => Promise.resolve({} as any));
    spyOn(dbModule, 'insertAuditLog').mockImplementation(() => Promise.resolve({} as any));
    spyOn(dbModule, 'createMessageEvent').mockImplementation(() => Promise.resolve({} as any));

    spyOn(dbModule, 'getEligibleContacts').mockImplementation(() =>
      Promise.resolve([
        { id: '11111111-1111-1111-1111-111111111111', email: 'test1@example.com', personName: 'John', companyName: 'Company A', status: 'pending', createdAt: new Date() },
        { id: '22222222-2222-2222-2222-222222222222', email: 'test2@example.com', personName: 'Jane', companyName: 'Company B', status: 'pending', createdAt: new Date() }
      ])
    );
    spyOn(verifierModule, 'verifyEmail').mockImplementation(() =>
      Promise.resolve({ status: 'valid', risk: 'low' })
    );
    spyOn(sesModule, 'sendEmail').mockImplementation(() =>
      Promise.resolve({ success: true, messageId: 'msg-123' })
    );

    EmailThrottleController.resetInstance();

    spyOn(EmailThrottleController.getInstance(), 'waitBeforeSend').mockImplementation(() => Promise.resolve({
      baseDelayMs: 0, breakTriggered: false, breakDurationMs: 0, totalDelayMs: 0
    }));
    resetCampaignState();
  });

  afterEach(() => {
    // Restore all mocked functions
    mock.restore();
  });

  it('should process all pending contacts and send emails', async () => {
    const throttle = EmailThrottleController.getInstance();
    spyOn(throttle, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    spyOn(dbModule, 'getEligibleContactCount').mockImplementation(() => Promise.resolve(2));

    const result = await runCampaign(false);

    expect(result.sentCount).toBe(2);
    expect(result.totalContacts).toBe(2);
    expect(sesModule.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('should skip high risk emails', async () => {
    const throttle = EmailThrottleController.getInstance();
    spyOn(throttle, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    spyOn(throttle, 'waitBeforeSend').mockImplementation(() => Promise.resolve({
      baseDelayMs: 0, breakTriggered: false, breakDurationMs: 0, totalDelayMs: 0
    }));

    spyOn(verifierModule, 'verifyEmail').mockImplementation((email) =>
      Promise.resolve(email === 'test1@example.com'
        ? { status: 'valid', risk: 'high' }
        : { status: 'valid', risk: 'low' })
    );

    const result = await runCampaign(false);

    expect(result.sentCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(sesModule.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('should abort if initial quota check fails', async () => {
    spyOn(sesModule, 'sendEmail').mockImplementation(() =>
      Promise.resolve({ success: false, error: 'SES quota exhaustion' })
    );

    const result = await runCampaign(false);

    // Both contacts in the batch fail before the loop halts
    expect(result.failedCount).toBe(2);
    expect(result.sentCount).toBe(0);
  });
});
