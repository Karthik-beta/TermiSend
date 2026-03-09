/**
 * SES Retry Unit Tests
 * Deterministic verification of retry logic using dependency injection
 */

import { describe, expect, it, spyOn, mock } from 'bun:test';
import { sendEmail } from '../../src/ses.js';
import { EmailThrottleController } from '../../src/throttle.js';
import * as throttleModule from '../../src/throttle.js';
import * as loggerModule from '../../src/logger.js';

describe('SES Retry Logic (Deterministic)', () => {
  it('should retry on throttling and eventually succeed', async () => {
    // 1. Setup mocks
    const throttle = EmailThrottleController.getInstance();
    spyOn(throttle, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    spyOn(throttle, 'acquireSendPermission').mockImplementation(() => Promise.resolve());
    spyOn(throttle, 'releaseSendPermission').mockImplementation(() => {});
    
    // Skip real delays
    spyOn(throttleModule, 'delay').mockImplementation(() => Promise.resolve());
    
    // Silence logger
    spyOn(loggerModule.logger, 'logAwsSesRequest').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logAwsSesResponse').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logError').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'warn').mockImplementation(() => Promise.resolve());

    process.env.SES_FROM_EMAIL = 'test@example.com';

    let calls = 0;
    const mockSesClient = {
      send: mock(async () => {
        calls++;
        if (calls === 1) {
          const error: any = new Error('Throttling');
          error.name = 'Throttling';
          throw error;
        }
        return { MessageId: 'success-id' };
      })
    };

    // 2. Execute
    const result = await sendEmail(
      { to: 'recipient@example.com', subject: 'Test', textBody: 'Hello' },
      throttle,
      mockSesClient
    );

    // 3. Assert
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('success-id');
    expect(calls).toBe(2);
    expect(mockSesClient.send).toHaveBeenCalledTimes(2);
  });

  it('should fail after maximum retries if throttling persists', async () => {
    const throttle = EmailThrottleController.getInstance();
    spyOn(throttle, 'checkQuota').mockImplementation(() => Promise.resolve(true));
    spyOn(throttle, 'acquireSendPermission').mockImplementation(() => Promise.resolve());
    spyOn(throttle, 'releaseSendPermission').mockImplementation(() => {});
    spyOn(throttleModule, 'delay').mockImplementation(() => Promise.resolve());
    
    spyOn(loggerModule.logger, 'logAwsSesRequest').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'logError').mockImplementation(() => Promise.resolve());
    spyOn(loggerModule.logger, 'warn').mockImplementation(() => Promise.resolve());

    let calls = 0;
    const mockSesClient = {
      send: mock(async () => {
        calls++;
        const error: any = new Error('Throttling');
        error.name = 'Throttling';
        throw error;
      })
    };

    const result = await sendEmail(
      { to: 'recipient@example.com', subject: 'Test', textBody: 'Hello' },
      throttle,
      mockSesClient
    );

    expect(result.success).toBe(false);
    expect(calls).toBe(4); // 1 initial + 3 retries
    expect(mockSesClient.send).toHaveBeenCalledTimes(4);
  });
});
