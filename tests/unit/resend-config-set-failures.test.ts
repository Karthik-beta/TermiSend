import { beforeEach, describe, expect, it } from 'bun:test';
import type { Contact, SendLog } from '../../src/types.js';
import {
  buildIstWindow,
  ensureProductionEnvironment,
  isMatchingConfigSetFailure,
  runResendOperation,
  selectDistinctCandidates,
  type FailedSendAttemptRow,
  type ResendScriptDependencies,
} from '../../scripts/resend-config-set-failures.ts';

function createFailedRow(overrides: Partial<FailedSendAttemptRow> = {}): FailedSendAttemptRow {
  return {
    failedLogId: 'failed-log-1',
    contactId: 'contact-1',
    campaignId: 'campaign-1',
    email: 'raghu@example.com',
    personName: 'Raghu',
    companyName: 'Yellow Messenger',
    createdAt: new Date('2026-03-10T03:38:49.656Z'),
    errorReason: 'Configuration set <termisend-config> does not exist.',
    status: 'failed',
    ...overrides,
  };
}

function createSendLog(id: string): SendLog {
  return {
    id,
    contactId: 'contact-1',
    campaignId: 'campaign-1',
    status: 'pending',
    mode: 'production',
    subject: 'Subject',
    bodyPreview: 'Hello',
    retryCount: 0,
    createdAt: new Date('2026-03-10T03:40:00.000Z'),
  };
}

describe('resend-config-set-failures script helpers', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
  });

  it('builds the correct IST window for the affected day', () => {
    const window = buildIstWindow('2026-03-10');

    expect(window.start.toISOString()).toBe('2026-03-09T18:30:00.000Z');
    expect(window.end.toISOString()).toBe('2026-03-10T18:30:00.000Z');
  });

  it('matches only the target config-set failures inside the IST window', () => {
    const window = buildIstWindow('2026-03-10');

    expect(isMatchingConfigSetFailure(createFailedRow(), window)).toBe(true);
    expect(
      isMatchingConfigSetFailure(
        createFailedRow({ errorReason: 'Some other SES error', failedLogId: 'failed-log-2' }),
        window
      )
    ).toBe(false);
    expect(
      isMatchingConfigSetFailure(
        createFailedRow({ createdAt: new Date('2026-03-10T18:30:00.000Z'), failedLogId: 'late' }),
        window
      )
    ).toBe(false);
  });

  it('deduplicates repeated failures for the same email', () => {
    const candidates = selectDistinctCandidates([
      createFailedRow({
        failedLogId: 'failed-log-1',
        createdAt: new Date('2026-03-10T03:38:49.656Z'),
      }),
      createFailedRow({
        failedLogId: 'failed-log-2',
        createdAt: new Date('2026-03-10T04:10:00.000Z'),
      }),
      createFailedRow({
        failedLogId: 'failed-log-3',
        contactId: 'contact-2',
        email: 'other@example.com',
        personName: 'Other',
      }),
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.failedLogId).sort()).toEqual([
      'failed-log-1',
      'failed-log-3',
    ]);
    expect(candidates.map((candidate) => candidate.contact.email).sort()).toEqual([
      'other@example.com',
      'raghu@example.com',
    ]);
  });

  it('rejects non-production environments before any resend work begins', () => {
    expect(() =>
      ensureProductionEnvironment(
        {
          NODE_ENV: undefined,
          DB_HOST: 'localhost',
          DB_NAME: 'termisend_dev',
        },
        {
          NODE_ENV: 'production',
          DB_HOST: 'prod-db.internal',
          DB_NAME: 'termisend_prod',
        }
      )
    ).toThrow('This script only runs against the production configuration.');
  });
});

describe('runResendOperation()', () => {
  function createDependencies(
    overrides: Partial<ResendScriptDependencies> = {}
  ): ResendScriptDependencies {
    const messages: string[] = [];

    return {
      queryMatchingFailures: () => Promise.resolve([]),
      getTemplatePath: () => 'templates/sample-template.md',
      readTemplate: () => Promise.resolve('Hello {{personName}}'),
      generateSubject: (contact: Contact) => Promise.resolve(`Hi ${contact.personName}`),
      processTemplate: (template: string, contact: Contact) =>
        template.replace('{{personName}}', contact.personName),
      renderMarkdown: (markdown: string) => Promise.resolve(`<p>${markdown}</p>`),
      generatePlainText: (markdown: string) => markdown,
      createSendLog: () => Promise.resolve(createSendLog('resend-log-1')),
      sendEmail: () => Promise.resolve({ success: true, messageId: 'msg-1' }),
      updateSendLog: () => Promise.resolve(createSendLog('resend-log-1')),
      closeConnection: () => Promise.resolve(),
      console: {
        log: (message: string) => {
          messages.push(message);
        },
        error: (message: string) => {
          messages.push(message);
        },
      },
      ...overrides,
    };
  }

  it('exits safely when no matching failures are found', async () => {
    let sendCalled = false;
    const dependencies = createDependencies({
      sendEmail: () => {
        sendCalled = true;
        return Promise.resolve({ success: true, messageId: 'msg-1' });
      },
    });

    const summary = await runResendOperation({ istDate: '2026-03-10' }, dependencies);

    expect(summary).toEqual({
      istWindow: buildIstWindow('2026-03-10'),
      matchedCount: 0,
      sentCount: 0,
      failedCount: 0,
    });
    expect(sendCalled).toBe(false);
  });

  it('creates a new resend log and marks it sent on success', async () => {
    const updateCalls: Array<{ logId: string; status: string; messageId?: string }> = [];
    const createSendLogCalls: Array<{ contactId: string; mode: string; campaignId?: string }> = [];

    const dependencies = createDependencies({
      queryMatchingFailures: () => Promise.resolve([createFailedRow()]),
      createSendLog: (contactId, mode, _subject, _bodyPreview, campaignId) => {
        createSendLogCalls.push({ contactId, mode, campaignId });
        return Promise.resolve(createSendLog('resend-log-success'));
      },
      updateSendLog: (logId, updates) => {
        updateCalls.push({ logId, status: updates.status, messageId: updates.messageId });
        return Promise.resolve(createSendLog(logId));
      },
    });

    const summary = await runResendOperation({ istDate: '2026-03-10' }, dependencies);

    expect(summary.sentCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(createSendLogCalls).toEqual([
      { contactId: 'contact-1', mode: 'production', campaignId: 'campaign-1' },
    ]);
    expect(updateCalls).toEqual([
      { logId: 'resend-log-success', status: 'sent', messageId: 'msg-1' },
    ]);
  });

  it('creates a new resend log and marks it failed when sending fails', async () => {
    const updateCalls: Array<{ logId: string; status: string; errorReason?: string }> = [];

    const dependencies = createDependencies({
      queryMatchingFailures: () => Promise.resolve([createFailedRow()]),
      createSendLog: () => Promise.resolve(createSendLog('resend-log-failed')),
      sendEmail: () => Promise.resolve({ success: false, error: 'SES still misconfigured' }),
      updateSendLog: (logId, updates) => {
        updateCalls.push({ logId, status: updates.status, errorReason: updates.errorReason });
        return Promise.resolve(createSendLog(logId));
      },
    });

    const summary = await runResendOperation({ istDate: '2026-03-10' }, dependencies);

    expect(summary.sentCount).toBe(0);
    expect(summary.failedCount).toBe(1);
    expect(updateCalls).toEqual([
      {
        logId: 'resend-log-failed',
        status: 'failed',
        errorReason: 'SES still misconfigured',
      },
    ]);
  });
});
