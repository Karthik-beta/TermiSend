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

describe('runCampaign Integration', () => {
  const tempDir = resolve(process.cwd(), 'templates');
  const tempTemplate = resolve(tempDir, 'test-campaign-template.md');

  beforeEach(() => {
    // Setup temp template
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
    writeFileSync(tempTemplate, `# Hello {Person Name}\n\nWelcome to {Company Name}!`);

    // Reset mocks
    spyOn(dbModule, 'getPendingContacts').mockClear();
    spyOn(dbModule, 'updateContactStatus').mockClear();
    spyOn(verifierModule, 'verifyEmail').mockClear();
    spyOn(sesModule, 'sendEmail').mockClear();

    spyOn(dbModule, 'getPendingContacts').mockImplementation(() => 
      Promise.resolve([
        { email: 'test1@example.com', personName: 'John', companyName: 'Company A', status: 'pending' },
        { email: 'test2@example.com', personName: 'Jane', companyName: 'Company B', status: 'pending' }
      ])
    );
    spyOn(dbModule, 'updateContactStatus').mockImplementation(() => Promise.resolve());
    spyOn(verifierModule, 'verifyEmail').mockImplementation(() => 
      Promise.resolve({ status: 'valid', risk: 'low' })
    );
    spyOn(sesModule, 'sendEmail').mockImplementation(() => 
      Promise.resolve({ success: true, messageId: 'msg-123' })
    );
    
    EmailThrottleController.resetInstance();
  });

  afterEach(() => {
    // Restore all mocked functions
    mock.restore();
  });

  it('should process all pending contacts and send emails', async () => {
    const throttle = EmailThrottleController.getInstance();
    spyOn(throttle, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    spyOn(throttle, 'waitBeforeSend').mockImplementation(() => Promise.resolve({ 
      baseDelayMs: 0, breakTriggered: false, breakDurationMs: 0, totalDelayMs: 0 
    }));

    const result = await runCampaign(tempTemplate);

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

    const result = await runCampaign(tempTemplate);

    expect(result.sentCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(sesModule.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('should abort if initial quota check fails', async () => {
    const throttle = EmailThrottleController.getInstance();
    spyOn(throttle, 'checkQuota').mockImplementation(() => Promise.resolve(false));

    const result = await runCampaign(tempTemplate);
    
    expect(result.failedCount).toBe(2);
    expect(result.sentCount).toBe(0);
    expect(result.details[0].reason).toContain('quota near exhaustion');
  });
});
