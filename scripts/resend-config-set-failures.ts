#!/usr/bin/env bun
/**
 * Resend the production email attempts that failed because the SES
 * configuration set was missing for the affected IST day.
 */

import { readFile } from 'node:fs/promises';
import { loadDatabaseEnvironment } from '../src/db-admin.js';
import type { Contact, SendLog, SendMode } from '../src/types.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_TIME_ZONE = 'Asia/Kolkata';
const PRODUCTION_GUIDANCE =
  'Use `bun --env-file=.env.production run scripts/resend-config-set-failures.ts` or set `NODE_ENV=production`.';
const PRODUCTION_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASS',
  'DB_NAME',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'SES_FROM_EMAIL',
  'SES_CONFIGURATION_SET',
  'EMAIL_TEMPLATE_PATH',
  'SUBJECT_TEMPLATE_PATH',
] as const;

export const CONFIG_SET_FAILURE_SUBSTRING = 'Configuration set <termisend-config> does not exist';

export interface IstWindow {
  istDate: string;
  start: Date;
  end: Date;
}

export interface FailedSendAttemptRow {
  failedLogId: string;
  contactId: string;
  campaignId: string | null;
  email: string;
  personName: string;
  companyName: string;
  createdAt: Date;
  errorReason: string | null;
  status: string;
}

export interface ResendCandidate {
  failedLogId: string;
  campaignId: string | null;
  originalErrorReason: string | null;
  failedAt: Date;
  contact: Contact;
}

export interface ResendSummary {
  istWindow: IstWindow;
  matchedCount: number;
  sentCount: number;
  failedCount: number;
}

interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendLogUpdates {
  status: 'sent' | 'failed';
  messageId?: string;
  errorReason?: string;
  sentAt?: Date;
  retryCount?: number;
}

export interface ResendScriptDependencies {
  queryMatchingFailures: (window: IstWindow) => Promise<FailedSendAttemptRow[]>;
  getTemplatePath: () => string;
  readTemplate: (path: string) => Promise<string>;
  generateSubject: (contact: Contact) => Promise<string>;
  processTemplate: (template: string, contact: Contact) => string;
  renderMarkdown: (markdown: string) => Promise<string>;
  generatePlainText: (markdown: string) => string;
  createSendLog: (
    contactId: string,
    mode: SendMode,
    subject: string,
    bodyPreview: string,
    campaignId?: string
  ) => Promise<SendLog>;
  sendEmail: (params: {
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
  }) => Promise<EmailSendResult>;
  updateSendLog: (logId: string, updates: SendLogUpdates) => Promise<SendLog>;
  closeConnection: () => Promise<void>;
  console: Pick<typeof console, 'log' | 'error'>;
}

function isValidIstDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function getCurrentIstDate(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TARGET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

export function buildIstWindow(istDate: string): IstWindow {
  if (!isValidIstDate(istDate)) {
    throw new Error(`Invalid IST date "${istDate}". Use YYYY-MM-DD.`);
  }

  const [yearText, monthText, dayText] = istDate.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const startUtcMs = Date.UTC(year, month - 1, day) - IST_OFFSET_MS;

  return {
    istDate,
    start: new Date(startUtcMs),
    end: new Date(startUtcMs + DAY_MS),
  };
}

export function isMatchingConfigSetFailure(
  row: FailedSendAttemptRow,
  window: IstWindow,
  errorSubstring: string = CONFIG_SET_FAILURE_SUBSTRING
): boolean {
  const createdAtMs = row.createdAt.getTime();

  return (
    row.status === 'failed' &&
    typeof row.errorReason === 'string' &&
    row.errorReason.includes(errorSubstring) &&
    createdAtMs >= window.start.getTime() &&
    createdAtMs < window.end.getTime()
  );
}

export function selectDistinctCandidates(rows: FailedSendAttemptRow[]): ResendCandidate[] {
  const sortedRows = [...rows].sort((left, right) => {
    const timeDifference = left.createdAt.getTime() - right.createdAt.getTime();
    if (timeDifference !== 0) {
      return timeDifference;
    }
    return left.email.localeCompare(right.email);
  });

  const selected = new Map<string, ResendCandidate>();

  for (const row of sortedRows) {
    const key = row.email.trim().toLowerCase();
    if (selected.has(key)) {
      continue;
    }

    selected.set(key, {
      failedLogId: row.failedLogId,
      campaignId: row.campaignId,
      originalErrorReason: row.errorReason,
      failedAt: row.createdAt,
      contact: {
        id: row.contactId,
        email: row.email,
        personName: row.personName,
        companyName: row.companyName,
        createdAt: row.createdAt,
      },
    });
  }

  return [...selected.values()];
}

export function isExplicitProductionContext(
  currentEnv: Record<string, string | undefined>,
  productionEnv: Record<string, string | undefined>
): boolean {
  if (currentEnv.NODE_ENV === 'production') {
    return true;
  }

  return PRODUCTION_KEYS.every((key) => {
    const productionValue = productionEnv[key];
    if (productionValue === undefined) {
      return true;
    }
    return currentEnv[key] === productionValue;
  });
}

export function ensureProductionEnvironment(
  currentEnv: Record<string, string | undefined> = process.env,
  productionEnv: Record<string, string | undefined> = loadDatabaseEnvironment('production')
): Record<string, string | undefined> {
  if (!isExplicitProductionContext(currentEnv, productionEnv)) {
    throw new Error(
      `This script only runs against the production configuration. ${PRODUCTION_GUIDANCE}`
    );
  }

  return productionEnv;
}

export function applyEnvironment(environment: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

export function parseCliArgs(argv: string[]): { istDate: string } {
  let istDate: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument.startsWith('--date=')) {
      istDate = argument.slice('--date='.length);
      continue;
    }

    if (argument === '--date') {
      istDate = argv[index + 1];
      index++;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { istDate: istDate || getCurrentIstDate() };
}

export async function runResendOperation(
  options: { istDate: string },
  dependencies: ResendScriptDependencies
): Promise<ResendSummary> {
  const istWindow = buildIstWindow(options.istDate);
  const output = dependencies.console;

  output.log('🔁 Resending production failures caused by missing SES configuration set...\n');
  output.log(
    `🕘 IST window (${istWindow.istDate}): ${istWindow.start.toISOString()} → ${istWindow.end.toISOString()} (UTC equivalent)`
  );

  const matchedRows = (await dependencies.queryMatchingFailures(istWindow)).filter((row) =>
    isMatchingConfigSetFailure(row, istWindow)
  );
  const candidates = selectDistinctCandidates(matchedRows);

  if (candidates.length === 0) {
    output.log('ℹ️  No matching production send failures found for that IST day.');
    return { istWindow, matchedCount: 0, sentCount: 0, failedCount: 0 };
  }

  output.log(`🧾 Found ${candidates.length} affected contact(s). Resending with fresh send logs...\n`);

  const templatePath = dependencies.getTemplatePath();
  const templateContent = await dependencies.readTemplate(templatePath);

  let sentCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    const { contact } = candidate;
    const subject = await dependencies.generateSubject(contact);
    const processedTemplate = dependencies.processTemplate(templateContent, contact);
    const bodyPreview = processedTemplate.substring(0, 500);
    const htmlBody = await dependencies.renderMarkdown(processedTemplate);
    const textBody = dependencies.generatePlainText(processedTemplate);
    const resendLog = await dependencies.createSendLog(
      contact.id,
      'production',
      subject,
      bodyPreview,
      candidate.campaignId ?? undefined
    );

    const result = await dependencies.sendEmail({
      to: contact.email,
      subject,
      htmlBody,
      textBody,
    });

    if (result.success && result.messageId) {
      await dependencies.updateSendLog(resendLog.id, {
        status: 'sent',
        messageId: result.messageId,
        sentAt: new Date(),
      });
      sentCount++;
      output.log(`• SENT   ${contact.email} (${resendLog.id}) -> ${result.messageId}`);
      continue;
    }

    const errorReason = result.error || 'Unknown send error';
    await dependencies.updateSendLog(resendLog.id, {
      status: 'failed',
      errorReason,
      retryCount: 0,
    });
    failedCount++;
    output.log(`• FAILED ${contact.email} (${resendLog.id}) -> ${errorReason}`);
  }

  output.log(
    `\n✅ Resend complete. Sent: ${sentCount}, Failed: ${failedCount}, Matched: ${candidates.length}`
  );

  return {
    istWindow,
    matchedCount: candidates.length,
    sentCount,
    failedCount,
  };
}

export async function createRuntimeDependencies(): Promise<ResendScriptDependencies> {
  const [dbModule, configModule, mailerModule, sesModule] = await Promise.all([
    import('../src/db.js'),
    import('../src/config.js'),
    import('../src/mailer.js'),
    import('../src/ses.js'),
  ]);

  return {
    queryMatchingFailures: async (window: IstWindow) =>
      (await dbModule.sql`
        SELECT
          sl.id AS "failedLogId",
          sl.contact_id AS "contactId",
          sl.campaign_id AS "campaignId",
          c.email,
          c.person_name AS "personName",
          c.company_name AS "companyName",
          sl.created_at AS "createdAt",
          sl.error_reason AS "errorReason",
          sl.status
        FROM send_logs sl
        JOIN contacts c ON c.id = sl.contact_id
        WHERE sl.status = 'failed'
          AND sl.error_reason LIKE ${`%${CONFIG_SET_FAILURE_SUBSTRING}%`}
          AND sl.created_at >= ${window.start}
          AND sl.created_at < ${window.end}
        ORDER BY sl.created_at ASC, c.email ASC
      `) as FailedSendAttemptRow[],
    getTemplatePath: configModule.getEmailTemplatePath,
    readTemplate: (path: string) => readFile(path, 'utf-8'),
    generateSubject: mailerModule.generateSubject,
    processTemplate: mailerModule.processTemplate,
    renderMarkdown: mailerModule.renderMarkdown,
    generatePlainText: mailerModule.generatePlainText,
    createSendLog: dbModule.createSendLog,
    sendEmail: sesModule.sendEmail,
    updateSendLog: dbModule.updateSendLog,
    closeConnection: dbModule.closeConnection,
    console,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<ResendSummary> {
  const cliOptions = parseCliArgs(argv);
  const productionEnvironment = ensureProductionEnvironment();
  applyEnvironment(productionEnvironment);

  const dependencies = await createRuntimeDependencies();

  try {
    return await runResendOperation(cliOptions, dependencies);
  } finally {
    await dependencies.closeConnection();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `❌ Failed to resend config-set failures: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
