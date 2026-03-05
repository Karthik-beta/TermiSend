/**
 * Email Campaign module for TermiSend (Part B)
 * Handles spintax parsing, markdown rendering, and email template processing
 */

// Node built-ins
import crypto from 'node:crypto';
import fs, { readFile } from 'node:fs/promises';

// External libraries
import { marked } from 'marked';
import { getEmailTemplatePath, getSubjectTemplatePath } from './config.js';
// Local modules (alphabetical)
import {
  createSendLog,
  getEligibleContactCount,
  getEligibleContacts,
  incrementRetryCount,
  updateSendLog,
} from './db.js';
import { emitAnalyticsEvent } from './events/bus.js';
import {
  type CampaignCompletedPayload,
  type CampaignStartedPayload,
  type ContactDeemedUnsafePayload,
  type ContactInvalidPayload,
  type ContactVerifiedPayload,
  createEvent,
  DomainEventType,
  domainEvents,
  type EmailFailedPayload,
  type EmailSendRequestedPayload,
  type EmailSentPayload,
  type EmailSkippedPayload,
} from './events/index.js';
import { logger } from './logger.js';
import { validateTemplatePath } from './path-validator.js';
import { sendEmail } from './ses.js';
import { analyticsEvents } from './ses-analytics.js';
import { isShuttingDown, throwIfShuttingDown } from './shutdown.js';
import { EmailThrottleController, getEmailThrottleController } from './throttle.js';
// Type imports
import type {
  CampaignResult,
  Contact,
  EmailSendParams,
  EmailVerificationResponse,
  FailureClassification,
  FailureType,
  ProgressCallback,
  SendMode,
  SendProgress,
} from './types.js';
import { MAX_RETRIES, RETRY_DELAYS } from './types.js';
import { getSafeFilename } from './utils/security.js';
import { isEmailSafe, verifyEmail } from './verifier.js';

// Test-only exports for dependency injection
// Use regular properties (not getters) so Bun's spyOn can mock them
export const __test = {
  getEligibleContacts: getEligibleContacts,
  createSendLog: createSendLog,
  updateSendLog: updateSendLog,
  sendEmail: sendEmail,
  verifyEmail: verifyEmail,
  emailThrottleController: EmailThrottleController,
  resetThrottleController: () => EmailThrottleController.resetInstance(),
  classifyError: classifyError,
  validateCriticalConfig: validateCriticalConfig,
  validateTemplateFiles: validateTemplateFiles,
};

// ============================================================================
// Error Classification and Campaign Control
// ============================================================================

/** Campaign stop flag for critical errors */
let campaignStopped = false;
let campaignStopReason: string | null = null;

/**
 * Check if the campaign has been stopped due to a critical error
 */
export function isCampaignStopped(): boolean {
  return campaignStopped;
}

/**
 * Get the reason the campaign was stopped
 */
export function getCampaignStopReason(): string | null {
  return campaignStopReason;
}

/**
 * Stop the campaign due to a critical error
 * This is irreversible for the current campaign run
 */
function stopCampaign(reason: string): void {
  campaignStopped = true;
  campaignStopReason = reason;
  logger.logError('Campaign', `Campaign stopped: ${reason}`).catch(() => {
    // Ignore logging errors
  });
}

/**
 * Reset the campaign stop state (for testing or new campaign)
 */
export function resetCampaignState(): void {
  campaignStopped = false;
  campaignStopReason = null;
}

/**
 * Validate critical configuration before starting campaign
 * Returns error message if critical config is missing, null if OK
 */
function validateCriticalConfig(): string | null {
  const templatePath = getEmailTemplatePath();
  const subjectPath = getSubjectTemplatePath();

  if (!templatePath) {
    return 'EMAIL_TEMPLATE_PATH is not configured';
  }
  if (!subjectPath) {
    return 'SUBJECT_TEMPLATE_PATH is not configured';
  }
  return null;
}

/**
 * Check if template files are readable
 * Returns error message if files cannot be read, null if OK
 */
async function validateTemplateFiles(): Promise<string | null> {
  const templatePath = getEmailTemplatePath();
  const subjectPath = getSubjectTemplatePath();

  try {
    await fs.access(templatePath);
  } catch {
    return `Email template file not found or not readable: ${templatePath}`;
  }

  try {
    await fs.access(subjectPath);
  } catch {
    return `Subject template file not found or not readable: ${subjectPath}`;
  }

  return null;
}

/**
 * Classify an error to determine retry behavior
 * @param error - The error to classify
 * @returns Classification with retry behavior
 */
function classifyError(error: unknown): FailureClassification {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();
  const errorName = error instanceof Error ? error.name : '';

  // Critical configuration errors - stop campaign immediately
  if (
    lowerMessage.includes('email_template_path') ||
    lowerMessage.includes('subject_template_path') ||
    lowerMessage.includes('template file not found') ||
    lowerMessage.includes('template file not readable') ||
    lowerMessage.includes('invalid template path')
  ) {
    return {
      type: 'permanent',
      retryable: false,
      stopCampaign: true,
    };
  }

  // Permanent failures - never retry
  if (
    lowerMessage.includes('template missing') ||
    lowerMessage.includes('subject template missing') ||
    lowerMessage.includes('invalid email') ||
    lowerMessage.includes('email status: invalid') ||
    lowerMessage.includes('verification failed') ||
    lowerMessage.includes('markdown parsing error') ||
    lowerMessage.includes('spintax') ||
    lowerMessage.includes('invalid configuration') ||
    lowerMessage.includes('message rejected') ||
    lowerMessage.includes('unverified') ||
    errorName === 'MessageRejected' ||
    errorName === 'MailFromDomainNotVerifiedException' ||
    errorName === 'ConfigurationSetDoesNotExistException'
  ) {
    return {
      type: 'permanent',
      retryable: false,
      stopCampaign: false,
    };
  }

  // Transient failures - retry with delays
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('throttling') ||
    lowerMessage.includes('temporary') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('internal server error') ||
    lowerMessage.includes('ses api error') ||
    lowerMessage.includes('connection') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('socket hang up')
  ) {
    return {
      type: 'transient',
      retryable: true,
      stopCampaign: false,
    };
  }

  // Default to transient for unknown errors (safer to retry)
  return {
    type: 'transient',
    retryable: true,
    stopCampaign: false,
  };
}

// ============================================================================
// Spintax Parser
// ============================================================================

/** Maximum input length for spintax parsing (100KB) */
const MAX_SPINTAX_INPUT_LENGTH = 100_000;

/** Maximum nesting depth for spintax groups */
const MAX_SPINTAX_DEPTH = 50;

/** Maximum iterations to prevent infinite loops */
const MAX_SPINTAX_ITERATIONS = 100;

/**
 * Parse spintax syntax and generate a random variation
 * Supports nested spintax: {Hello|Hi {there|friend}}
 *
 * @param text - Text containing spintax
 * @returns Rendered text with random selections
 * @throws Error if input exceeds limits or nesting is too deep
 */
export function parseSpintax(text: string): string {
  // Validate input length to prevent memory issues
  if (text.length > MAX_SPINTAX_INPUT_LENGTH) {
    throw new Error(
      `Spintax input too long: ${text.length} characters (max: ${MAX_SPINTAX_INPUT_LENGTH})`
    );
  }

  // Check maximum nesting depth before processing
  const depth = calculateNestingDepth(text);
  if (depth > MAX_SPINTAX_DEPTH) {
    throw new Error(`Spintax nesting too deep: ${depth} levels (max: ${MAX_SPINTAX_DEPTH})`);
  }

  // Regex to match spintax groups: {option1|option2|option3}
  const spintaxRegex = /\{([^{}]+)\}/g;

  // Maximum iterations to prevent infinite loops on malformed input
  let iterations = 0;

  let result = text;

  while (spintaxRegex.test(result) && iterations < MAX_SPINTAX_ITERATIONS) {
    result = result.replace(spintaxRegex, (_match, content: string) => {
      // Split by pipe character, but handle nested braces
      const options = splitOptions(content);
      // Randomly select one option
      const selected = options[Math.floor(Math.random() * options.length)];
      return selected.trim();
    });
    iterations++;
  }

  return result;
}

/**
 * Calculate the maximum nesting depth of spintax braces
 * This prevents stack overflow from deeply nested patterns like {{{{{...}}}}}
 */
function calculateNestingDepth(text: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of text) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth--;
    }
  }

  return maxDepth;
}

/**
 * Split spintax options handling nested braces
 */
function splitOptions(content: string): string[] {
  const options: string[] = [];
  let currentOption = '';
  let depth = 0;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '{') {
      depth++;
      currentOption += char;
    } else if (char === '}') {
      depth--;
      currentOption += char;
    } else if (char === '|' && depth === 0) {
      options.push(currentOption);
      currentOption = '';
    } else {
      currentOption += char;
    }
  }

  // Add the last option
  if (currentOption) {
    options.push(currentOption);
  }

  return options.length > 0 ? options : [content];
}

// ============================================================================
// Placeholder Replacement
// ============================================================================

/**
 * Replace placeholders with contact data and fallbacks
 *
 * @param template - Template string with placeholders
 * @param contact - Contact to personalize for
 * @returns Template with placeholders replaced
 */
function replacePlaceholders(template: string, contact: Contact): string {
  const name = contact.personName?.trim() || 'Sir/Madam';
  const company = contact.companyName?.trim() || 'Company';

  return template.replaceAll('[Name]', name).replaceAll('[Company-Name]', company);
}

/**
 * Load and process the subject spintax file
 *
 * @returns Subject template content
 * @throws Error if subject template cannot be loaded
 */
async function loadSubjectTemplate(): Promise<string> {
  const subjectPath = getSubjectTemplatePath();
  try {
    const content = await fs.readFile(subjectPath, 'utf-8');
    return content.trim();
  } catch (error) {
    throw new Error(`Failed to load subject template: ${(error as Error).message}`);
  }
}

/**
 * Generate the final subject line for a contact
 *
 * @param contact - Contact to generate subject for
 * @returns Final subject line with placeholders replaced and spintax parsed
 */
export async function generateSubject(contact: Contact): Promise<string> {
  const template = await loadSubjectTemplate();
  const withPlaceholders = replacePlaceholders(template, contact);
  return parseSpintax(withPlaceholders);
}

// ============================================================================
// Template Processing
// ============================================================================

/**
 * Process email template by replacing placeholders and parsing spintax
 *
 * @param template - Email template with spintax and placeholders
 * @param contact - Contact to personalize for
 * @returns Processed template
 */
export function processTemplate(template: string, contact: Contact): string {
  // First replace placeholders with contact data
  let processed = replacePlaceholders(template, contact);

  // Then parse spintax
  processed = parseSpintax(processed);

  return processed;
}

/**
 * Extract subject from markdown template (first H1 or first line)
 */
export function extractSubject(template: string): { subject: string; body: string } {
  // Try to extract H1 heading as subject
  const h1Match = template.match(/^#\s+(.+)$/m);

  if (h1Match) {
    const subject = h1Match[1].trim();
    // Remove the H1 from the body
    const body = template.replace(/^#\s+.+$/m, '').trim();
    return { subject, body };
  }

  // Fallback: use first line as subject
  const lines = template.split('\n');
  const subject = lines[0].replace(/^#\s*/, '').trim();
  const body = lines.slice(1).join('\n').trim();

  return { subject, body };
}

/**
 * Unsubscribe footer for SES compliance
 * Kept minimal to avoid promotional email signals
 */
const UNSUBSCRIBE_FOOTER = `
<br><br>
<span style="font-size: 11px; color: #888;">If this isn't relevant, just reply and let me know - happy to remove you.</span>
`;

/**
 * Render markdown to HTML
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const html = await marked(markdown, {
    gfm: true,
    breaks: true,
  });

  // Minimal HTML wrapper — avoids newsletter-style formatting
  // that triggers Gmail Promotions tab classification.
  // No <style> block, no branded colors, no max-width container.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: sans-serif; line-height: 1.5; color: #222;">
  ${html}
  ${UNSUBSCRIBE_FOOTER}
</body>
</html>`;
}

/**
 * Plain-text unsubscribe line for compliance
 */
const PLAIN_TEXT_UNSUBSCRIBE =
  "\n\n---\nIf this isn't relevant, just reply and let me know - happy to remove you.";

/**
 * Generate plain text version from markdown
 */
export function generatePlainText(markdown: string): string {
  // Simple conversion - remove markdown syntax
  const body = markdown
    .replace(/^#+\s+/gm, '') // Remove headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.+?)\*/g, '$1') // Remove italic
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)') // Convert links
    .replace(/`(.+?)`/g, '$1') // Remove inline code
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/^\s*[-*+]\s/gm, '• ') // Convert list bullets
    .replace(/^\s*\d+\.\s/gm, '$&') // Keep numbered list
    .trim();

  return body + PLAIN_TEXT_UNSUBSCRIBE;
}

// ============================================================================
// Email Campaign
// ============================================================================

/**
 * Result of email verification for a contact
 */
interface VerificationOutcome {
  shouldContinue: boolean;
  verificationResult?: EmailVerificationResponse;
}

/**
 * Verify a contact's email and handle verification errors
 * Creates a failed send log entry on verification failure
 */
async function verifyContactEmail(
  contact: Contact,
  result: CampaignResult,
  sendLogId: string
): Promise<VerificationOutcome> {
  // Check for shutdown before starting verification
  throwIfShuttingDown();

  try {
    const verificationResult = await verifyEmail(contact.email);

    // Check for shutdown after verification completes
    throwIfShuttingDown();

    // Emit verification events for analytics
    if (verificationResult.status === 'invalid') {
      try {
        const event = createEvent<ContactInvalidPayload>(DomainEventType.CONTACT_INVALID, {
          contactId: contact.id,
          email: contact.email,
          reason: verificationResult.message || 'Email status: invalid',
        });
        domainEvents.emit(event);
      } catch {
        /* ignore */
      }
      // Emit analytics event for real-time dashboard
      try {
        emitAnalyticsEvent({
          type: 'contact:verified',
          id: contact.id,
          isValid: false,
        });
      } catch {
        // Silently ignore event emission errors
      }
    } else if (isEmailSafe(verificationResult)) {
      try {
        const event = createEvent<ContactVerifiedPayload>(DomainEventType.CONTACT_VERIFIED, {
          contactId: contact.id,
          email: contact.email,
          result: 'valid',
        });
        domainEvents.emit(event);
      } catch {
        /* ignore */
      }
      // Emit analytics event for real-time dashboard
      try {
        emitAnalyticsEvent({
          type: 'contact:verified',
          id: contact.id,
          isValid: true,
        });
      } catch {
        // Silently ignore event emission errors
      }
    } else {
      try {
        const event = createEvent<ContactDeemedUnsafePayload>(
          DomainEventType.CONTACT_DEEMED_UNSAFE,
          {
            contactId: contact.id,
            email: contact.email,
            reason: `Unsafe email: ${verificationResult.status} (${verificationResult.risk} risk)`,
          }
        );
        domainEvents.emit(event);
      } catch {
        /* ignore */
      }
      // Emit analytics event for real-time dashboard (invalid since not safe)
      try {
        emitAnalyticsEvent({
          type: 'contact:verified',
          id: contact.id,
          isValid: false,
        });
      } catch {
        // Silently ignore event emission errors
      }
    }

    return { shouldContinue: true, verificationResult };
  } catch (verifyError) {
    const errorMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);
    result.failedCount++;
    result.details.push({
      email: contact.email,
      status: 'failed',
      reason: `Email verification failed: ${errorMsg}`,
    });
    // Update send log with failure
    await updateSendLog(sendLogId, {
      status: 'failed',
      errorReason: `Email verification failed: ${errorMsg}`,
    });
    await logger.logError('Email Verification', errorMsg, { email: contact.email });
    return { shouldContinue: false };
  }
}

/**
 * Handle unsafe email - mark as skipped
 * Updates send log with 'skipped' status
 */
async function handleUnsafeEmail(
  contact: Contact,
  verificationResult: EmailVerificationResponse,
  result: CampaignResult,
  sendLogId: string,
  campaignId?: string
): Promise<void> {
  result.skippedCount++;
  result.details.push({
    email: contact.email,
    status: 'skipped',
    reason: `Email verification failed: ${verificationResult.status} (${verificationResult.risk} risk)`,
  });
  // Update send log with skipped status
  await updateSendLog(sendLogId, {
    status: 'skipped',
    errorReason: `Email verification failed: ${verificationResult.status} (${verificationResult.risk} risk)`,
  });
  await logger.logSendLogUpdated(sendLogId, 'pending', 'skipped', {
    email: contact.email,
    reason: `Email verification failed: ${verificationResult.status}`,
  });
  // Emit EMAIL_SKIPPED event (fire-and-forget)
  try {
    const event = createEvent<EmailSkippedPayload>(DomainEventType.EMAIL_SKIPPED, {
      contactId: contact.id,
      sendLogId,
      campaignId,
      reason: `Email verification failed: ${verificationResult.status} (${verificationResult.risk} risk)`,
      skipCategory: 'unsafe_email',
    });
    domainEvents.emit(event);
  } catch {
    // Silently ignore event emission errors
  }

  // Emit analytics event for real-time dashboard
  try {
    emitAnalyticsEvent({
      type: 'email:skipped',
      contactId: contact.id,
      email: contact.email,
      reason: `Email verification failed: ${verificationResult.status} (${verificationResult.risk} risk)`,
    });
  } catch {
    // Silently ignore event emission errors
  }
}

/**
 * Handle dry run for a contact
 * Updates send log to reflect dry run completion
 */
async function handleDryRun(
  contact: Contact,
  result: CampaignResult,
  sendLogId: string,
  subject: string,
  campaignId?: string
): Promise<void> {
  result.sentCount++;
  result.details.push({
    email: contact.email,
    status: 'sent',
    reason: 'DRY RUN - Email not actually sent',
  });
  // Update send log with dry run status (marked as sent for tracking)
  await updateSendLog(sendLogId, {
    status: 'sent',
  });
  await logger.logSendLogUpdated(sendLogId, 'pending', 'sent', {
    email: contact.email,
    subject,
    mode: 'dry_run',
  });
  // Emit EMAIL_SENT event (fire-and-forget) for dry run analytics
  try {
    const event = createEvent<EmailSentPayload>(DomainEventType.EMAIL_SENT, {
      contactId: contact.id,
      sendLogId,
      campaignId,
      messageId: 'dry_run',
      subject,
      mode: 'dry_run',
    });
    domainEvents.emit(event);
  } catch {
    // Silently ignore event emission errors
  }
}

/**
 * Handle successful email send
 * Updates send log with 'sent' status and message ID
 * Emits analytics event for tracking
 */
async function handleSuccessfulSend(
  contact: Contact,
  messageId: string,
  result: CampaignResult,
  sendLogId: string,
  subject: string,
  mode: SendMode,
  campaignId?: string
): Promise<void> {
  result.sentCount++;
  result.details.push({
    email: contact.email,
    status: 'sent',
    reason: `MessageId: ${messageId}`,
  });
  // Update send log with success
  await updateSendLog(sendLogId, {
    status: 'sent',
    messageId,
    sentAt: new Date(),
  });
  await logger.logSendLogUpdated(sendLogId, 'pending', 'sent', {
    email: contact.email,
    subject,
    messageId,
  });
  // Emit analytics event
  analyticsEvents.emit('SEND', {
    messageId,
    contactId: contact.id,
    sendLogId,
    timestamp: new Date(),
    details: { subject, email: contact.email },
  });
  // Emit EMAIL_SENT domain event (fire-and-forget)
  try {
    const event = createEvent<EmailSentPayload>(DomainEventType.EMAIL_SENT, {
      contactId: contact.id,
      sendLogId,
      campaignId,
      messageId,
      subject,
      mode,
    });
    domainEvents.emit(event);
  } catch {
    // Silently ignore event emission errors
  }

  // Emit analytics event for real-time dashboard
  try {
    emitAnalyticsEvent({ type: 'email:sent', contactId: contact.id, email: contact.email });
  } catch {
    // Silently ignore event emission errors
  }
}

/**
 * Handle failed email send with retry support
 * Updates send log with 'failed' status and error reason
 * Emits analytics event for tracking
 */
async function handleFailedSend(
  contact: Contact,
  errorReason: string,
  result: CampaignResult,
  sendLogId: string,
  subject: string,
  campaignId?: string,
  retryAttempt: number = 0,
  failureType: FailureType = 'transient'
): Promise<void> {
  result.failedCount++;
  result.details.push({
    email: contact.email,
    status: 'failed',
    reason: errorReason,
  });
  // Update send log with failure - set retry_count to MAX_RETRIES for permanent failures
  // This prevents them from being selected again
  const finalRetryCount = failureType === 'permanent' ? MAX_RETRIES : retryAttempt;
  await updateSendLog(sendLogId, {
    status: 'failed',
    errorReason,
    retryCount: finalRetryCount,
  });
  await logger.logSendLogUpdated(sendLogId, 'pending', 'failed', {
    email: contact.email,
    subject,
    error: errorReason,
    retryAttempt,
    failureType,
  });
  // Emit analytics event
  analyticsEvents.emit('FAILURE', {
    contactId: contact.id,
    sendLogId,
    timestamp: new Date(),
    details: { subject, email: contact.email, error: errorReason, retryAttempt, failureType },
  });
  // Emit EMAIL_FAILED domain event (fire-and-forget)
  try {
    const event = createEvent<EmailFailedPayload>(DomainEventType.EMAIL_FAILED, {
      contactId: contact.id,
      sendLogId,
      campaignId,
      errorReason,
      errorCategory: 'ses_error',
      retryAttempt,
      failureType,
    });
    domainEvents.emit(event);
  } catch {
    // Silently ignore event emission errors
  }

  // Emit analytics event for real-time dashboard
  try {
    emitAnalyticsEvent({
      type: 'email:failed',
      contactId: contact.id,
      email: contact.email,
      error: errorReason,
    });
  } catch {
    // Silently ignore event emission errors
  }
}

/**
 * Handle contact processing error with retry support
 * Updates send log with 'failed' status and classifies error
 */
async function handleContactError(
  contact: Contact,
  error: unknown,
  result: CampaignResult,
  sendLogId: string,
  campaignId?: string,
  retryAttempt: number = 0
): Promise<FailureClassification> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const classification = classifyError(error);

  result.failedCount++;
  result.details.push({
    email: contact.email,
    status: 'failed',
    reason: errorMsg,
  });
  await logger.logError('Campaign Processing', errorMsg, {
    email: contact.email,
    contact: { companyName: contact.companyName, personName: contact.personName },
    failureType: classification.type,
    retryable: classification.retryable,
  });

  // Update send log with failure - set retry_count to MAX_RETRIES for permanent failures
  const finalRetryCount = classification.type === 'permanent' ? MAX_RETRIES : retryAttempt;
  await updateSendLog(sendLogId, {
    status: 'failed',
    errorReason: errorMsg,
    retryCount: finalRetryCount,
  });

  // Emit EMAIL_FAILED domain event (fire-and-forget)
  try {
    const event = createEvent<EmailFailedPayload>(DomainEventType.EMAIL_FAILED, {
      contactId: contact.id,
      sendLogId,
      campaignId,
      errorReason: errorMsg,
      errorCategory: 'other',
      retryAttempt,
      failureType: classification.type,
      stopCampaign: classification.stopCampaign,
    });
    domainEvents.emit(event);
  } catch {
    // Silently ignore event emission errors
  }

  return classification;
}

/**
 * Helper to safely call progress callback
 */
async function reportProgress(
  onProgress: ProgressCallback | undefined,
  progress: SendProgress
): Promise<void> {
  if (onProgress) {
    try {
      await onProgress(progress);
    } catch {
      // Silently ignore progress callback errors to not disrupt sending
    }
  }
}

/**
 * Process a single contact - send email after verification
 * Creates send log entry before processing and updates it based on outcome
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Legacy function - needs refactoring separately
async function processContact(
  contact: Contact,
  templateContent: string,
  throttleController: EmailThrottleController,
  dryRun: boolean,
  result: CampaignResult,
  campaignId?: string,
  onProgress?: ProgressCallback,
  currentContactIndex?: number,
  totalContacts?: number
): Promise<void> {
  const current = currentContactIndex ?? 0;
  const total = totalContacts ?? 1;

  // Process template and generate subject
  const processedTemplate = processTemplate(templateContent, contact);
  const subject = await generateSubject(contact);
  const bodyPreview = processedTemplate.substring(0, 500);

  // Determine mode based on dryRun flag
  const mode: SendMode = dryRun ? 'dry_run' : 'production';

  // Create send log entry before any processing
  const sendLog = await createSendLog(contact.id, mode, subject, bodyPreview, campaignId);
  const sendLogId = sendLog.id;

  // Verify email FIRST - before any waiting or processing
  await reportProgress(onProgress, {
    currentContact: current,
    totalContacts: total,
    email: contact.email,
    status: 'verifying',
    message: `Verifying ${contact.email}...`,
  });

  const verificationOutcome = await verifyContactEmail(contact, result, sendLogId);
  if (!verificationOutcome.shouldContinue || !verificationOutcome.verificationResult) {
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'failed',
      message: `Verification failed for ${contact.email}`,
    });
    return;
  }

  // Skip if email is not safe
  if (!isEmailSafe(verificationOutcome.verificationResult)) {
    await handleUnsafeEmail(
      contact,
      verificationOutcome.verificationResult,
      result,
      sendLogId,
      campaignId
    );
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'skipped',
      message: `Skipped ${contact.email} - unsafe email`,
    });
    return;
  }

  if (dryRun) {
    await handleDryRun(contact, result, sendLogId, subject, campaignId);
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'completed',
      message: `Dry run: ${contact.email} (would send)`,
    });
    return;
  }

  // Render markdown to HTML
  await reportProgress(onProgress, {
    currentContact: current,
    totalContacts: total,
    email: contact.email,
    status: 'sending',
    message: `Sending to ${contact.email}...`,
  });

  const htmlBody = await renderMarkdown(processedTemplate);
  const textBody = generatePlainText(processedTemplate);

  // Send email
  const emailParams: EmailSendParams = {
    to: contact.email,
    subject,
    htmlBody,
    textBody,
  };

  // Emit EMAIL_SEND_REQUESTED event (fire-and-forget)
  try {
    const event = createEvent<EmailSendRequestedPayload>(DomainEventType.EMAIL_SEND_REQUESTED, {
      contactId: contact.id,
      sendLogId,
      campaignId,
      subject,
      mode,
    });
    domainEvents.emit(event);
  } catch {
    // Silently ignore event emission errors
  }

  // Send email with retry logic for transient failures
  let sendResult = await sendEmail(emailParams, throttleController);
  let retryAttempt = 0;

  // CRITICAL FIX: Check shutdown before updating database
  if (isShuttingDown()) {
    throw new Error('Shutdown requested after send but before log update');
  }

  // Handle send failure with retry logic
  if (!sendResult.success) {
    const error = new Error(sendResult.error || 'Unknown error');
    const classification = classifyError(error);

    // For transient errors, retry up to MAX_RETRIES with delays
    if (classification.retryable && classification.type === 'transient') {
      while (retryAttempt < MAX_RETRIES && !sendResult.success && !isShuttingDown()) {
        retryAttempt++;
        const delayMs = RETRY_DELAYS[retryAttempt as keyof typeof RETRY_DELAYS] || 5000;

        // Log retry attempt
        await logger.info(
          `Retry ${retryAttempt}/${MAX_RETRIES} for ${contact.email} after ${delayMs}ms: ${sendResult.error}`
        );

        // Report retry progress
        await reportProgress(onProgress, {
          currentContact: current,
          totalContacts: total,
          email: contact.email,
          status: 'waiting',
          message: `Retry ${retryAttempt}/${MAX_RETRIES} for ${contact.email}...`,
        });

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Check shutdown after wait
        if (isShuttingDown()) {
          throw new Error('Shutdown requested during retry wait');
        }

        // Update retry count in database
        await incrementRetryCount(sendLogId);

        // Retry send
        sendResult = await sendEmail(emailParams, throttleController);
      }
    }

    // For permanent errors or after max retries, handle as failure
    if (!sendResult.success) {
      await handleFailedSend(
        contact,
        sendResult.error || 'Unknown error',
        result,
        sendLogId,
        subject,
        campaignId,
        retryAttempt,
        classification.type
      );
      await reportProgress(onProgress, {
        currentContact: current,
        totalContacts: total,
        email: contact.email,
        status: 'failed',
        message: `Failed to send to ${contact.email}: ${sendResult.error || 'Unknown error'}${retryAttempt > 0 ? ` (after ${retryAttempt} retries)` : ''}`,
      });

      // CRITICAL FIX: Apply throttle AFTER failed send to control rate to NEXT email
      await reportProgress(onProgress, {
        currentContact: current,
        totalContacts: total,
        email: contact.email,
        status: 'waiting',
        message: 'Waiting before next send...',
      });

      await throttleController.waitBeforeSend((remainingMs, totalMs) => {
        reportProgress(onProgress, {
          currentContact: current,
          totalContacts: total,
          email: contact.email,
          status: 'waiting',
          waitTimeRemainingMs: remainingMs,
          totalWaitTimeMs: totalMs,
          message: `Waiting ${Math.ceil(remainingMs / 1000)}s before next send...`,
        }).catch(() => {
          // Silently ignore progress callback errors
        });
      });
      return;
    }
  }

  // Handle successful send (either first attempt or after retries)
  if (sendResult.success) {
    await handleSuccessfulSend(
      contact,
      sendResult.messageId || 'unknown',
      result,
      sendLogId,
      subject,
      mode,
      campaignId
    );
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'completed',
      message:
        retryAttempt > 0
          ? `Sent to ${contact.email} (after ${retryAttempt} retries)`
          : `Sent to ${contact.email}`,
    });
  }

  // CRITICAL FIX: Apply throttle AFTER send to control rate to NEXT email
  await reportProgress(onProgress, {
    currentContact: current,
    totalContacts: total,
    email: contact.email,
    status: 'waiting',
    message: 'Waiting before next send...',
  });

  await throttleController.waitBeforeSend((remainingMs, totalMs) => {
    // Update progress during wait with countdown
    reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'waiting',
      waitTimeRemainingMs: remainingMs,
      totalWaitTimeMs: totalMs,
      message: `Waiting ${Math.ceil(remainingMs / 1000)}s before next send...`,
    }).catch(() => {
      // Silently ignore progress callback errors
    });
  });
}

/**
 * Run email campaign for all eligible contacts
 *
 * @param dryRun - If true, don't actually send emails (for testing)
 * @param onProgress - Optional callback for real-time progress updates
 * @param campaignId - Optional campaign ID to filter by
 * @param continuous - If true, keep polling for new contacts after finishing initial batch
 * @returns Campaign result summary
 */
export async function runCampaign(
  dryRun: boolean = false,
  onProgress?: ProgressCallback,
  campaignId?: string,
  continuous: boolean = false
): Promise<CampaignResult> {
  // Reset campaign state at the start of each campaign
  resetCampaignState();

  const templatePath = getEmailTemplatePath();

  const result: CampaignResult = {
    totalContacts: 0,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    details: [],
  };

  // CRITICAL: Validate configuration before doing anything else
  const configError = validateCriticalConfig();
  if (configError) {
    const error = new Error(`Critical configuration error: ${configError}`);
    await logger.logError('Campaign Startup', configError, {});
    throw error;
  }

  // Validate template files are readable
  const fileError = await validateTemplateFiles();
  if (fileError) {
    const error = new Error(`Critical configuration error: ${fileError}`);
    await logger.logError('Campaign Startup', fileError, {});
    throw error;
  }

  // Validate template path
  const pathValidation = validateTemplatePath(templatePath);
  if (!pathValidation.valid) {
    throw new Error(`Invalid template path: ${pathValidation.error}`);
  }
  const sanitizedTemplatePath = pathValidation.sanitizedPath;
  const actualCampaignId = campaignId || crypto.randomUUID();

  try {
    const templateContent = await readFile(sanitizedTemplatePath, 'utf-8');
    const throttleController = getEmailThrottleController();
    const mode: SendMode = dryRun ? 'dry_run' : 'production';

    await emitCampaignStarted(actualCampaignId, mode, sanitizedTemplatePath);

    return await executeCampaignLoop(
      actualCampaignId,
      templateContent,
      throttleController,
      dryRun,
      continuous,
      result,
      onProgress
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError('Campaign Execution', errorMessage, {
      templateName: getSafeFilename(sanitizedTemplatePath),
      campaignId: actualCampaignId,
    });
    throw error;
  }
}

async function executeCampaignLoop(
  campaignId: string,
  templateContent: string,
  throttleController: EmailThrottleController,
  dryRun: boolean,
  continuous: boolean,
  result: CampaignResult,
  onProgress?: ProgressCallback
): Promise<CampaignResult> {
  const campaignStartTime = Date.now();
  let isPolling = true;

  while (isPolling) {
    // Check for shutdown before each iteration
    if (isShuttingDown()) {
      isPolling = false;
      break;
    }

    // Check if campaign was stopped due to critical error
    if (isCampaignStopped()) {
      isPolling = false;
      break;
    }

    const contacts = await getEligibleContacts();

    if (contacts.length === 0) {
      if (!continuous) {
        isPolling = false;
        break;
      }
      await waitForLeads(result, onProgress);
      continue;
    }

    await updateResultTotal(result);
    await processBatch(
      contacts,
      templateContent,
      throttleController,
      dryRun,
      campaignId,
      result,
      onProgress
    );

    if (!continuous) {
      isPolling = false;
    }
  }

  emitCampaignCompleted(campaignId, result, Date.now() - campaignStartTime);
  return result;
}

async function emitCampaignStarted(campaignId: string, mode: SendMode, templatePath: string) {
  const initialContacts = await getEligibleContacts();
  if (initialContacts.length > 0) {
    try {
      const event = createEvent<CampaignStartedPayload>(DomainEventType.CAMPAIGN_STARTED, {
        campaignId,
        totalContacts: initialContacts.length,
        mode,
        templatePath,
      });
      domainEvents.emit(event);
    } catch {
      /* ignore */
    }
  }
}

async function waitForLeads(result: CampaignResult, onProgress?: ProgressCallback) {
  await reportProgress(onProgress, {
    currentContact: result.sentCount + result.failedCount + result.skippedCount,
    totalContacts: result.totalContacts,
    email: '',
    status: 'waiting',
    message: 'Waiting for new leads to be appended...',
  });

  // Use short intervals to allow checking shutdown state
  const totalWaitMs = 30000;
  const checkIntervalMs = 100;
  const iterations = totalWaitMs / checkIntervalMs;

  for (let i = 0; i < iterations; i++) {
    if (isShuttingDown()) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }
}

async function updateResultTotal(result: CampaignResult) {
  const currentEligibleCount = await getEligibleContactCount();
  result.totalContacts =
    result.sentCount + result.failedCount + result.skippedCount + currentEligibleCount;
}

async function processBatch(
  contacts: Contact[],
  templateContent: string,
  throttleController: EmailThrottleController,
  dryRun: boolean,
  campaignId: string,
  result: CampaignResult,
  onProgress?: ProgressCallback
) {
  const mode: SendMode = dryRun ? 'dry_run' : 'production';
  for (const contact of contacts) {
    // Check for shutdown before processing each contact
    if (isShuttingDown()) {
      break;
    }

    try {
      await processContact(
        contact,
        templateContent,
        throttleController,
        dryRun,
        result,
        campaignId,
        onProgress,
        result.sentCount + result.failedCount + result.skippedCount + 1,
        result.totalContacts
      );
    } catch (error) {
      // Don't treat shutdown errors as failures
      if (error instanceof Error && error.message === 'Shutdown requested') {
        break;
      }

      // Check for critical errors that should stop the campaign
      const classification = classifyError(error);
      if (classification.stopCampaign) {
        stopCampaign(
          `Critical error for ${contact.email}: ${error instanceof Error ? error.message : String(error)}`
        );
        await handleBatchError(
          contact,
          error,
          result,
          campaignId,
          mode,
          templateContent,
          onProgress
        );
        break;
      }

      await handleBatchError(contact, error, result, campaignId, mode, templateContent, onProgress);
    }
  }
}

async function handleBatchError(
  contact: Contact,
  error: unknown,
  result: CampaignResult,
  campaignId: string,
  mode: SendMode,
  templateContent: string,
  onProgress?: ProgressCallback
) {
  const { subject, body } = extractSubject(processTemplate(templateContent, contact));
  const bodyPreview = body.substring(0, 500);
  const errorLog = await createSendLog(contact.id, mode, subject, bodyPreview, campaignId);
  await handleContactError(contact, error, result, errorLog.id, campaignId);

  await reportProgress(onProgress, {
    currentContact: result.sentCount + result.failedCount + result.skippedCount,
    totalContacts: result.totalContacts,
    email: contact.email,
    status: 'failed',
    message: `Error processing ${contact.email}: ${error instanceof Error ? error.message : String(error)}`,
  });
}

function emitCampaignCompleted(campaignId: string, result: CampaignResult, durationMs: number) {
  try {
    const event = createEvent<CampaignCompletedPayload>(DomainEventType.CAMPAIGN_COMPLETED, {
      campaignId,
      totalContacts: result.totalContacts,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      durationMs,
    });
    domainEvents.emit(event);
  } catch {
    /* ignore */
  }
}

// ============================================================================
// Preview Function
// ============================================================================

/**
 * Generate a preview of the email for a sample contact
 * Useful for testing templates before sending
 */
export async function generatePreview(
  sampleContact: Contact
): Promise<{ subject: string; htmlBody: string; textBody: string }> {
  const templatePath = getEmailTemplatePath();

  // Validate template path for security
  const pathValidation = validateTemplatePath(templatePath);
  if (!pathValidation.valid) {
    throw new Error(`Invalid template path: ${pathValidation.error}`);
  }
  const sanitizedTemplatePath = pathValidation.sanitizedPath;

  const templateContent = await readFile(sanitizedTemplatePath, 'utf-8');
  const processedTemplate = processTemplate(templateContent, sampleContact);
  const { subject, body } = extractSubject(processedTemplate);
  const htmlBody = await renderMarkdown(body);
  const textBody = generatePlainText(body);

  return { subject, htmlBody, textBody };
}
