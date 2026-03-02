/**
 * Email Campaign module for TermiSend (Part B)
 * Handles spintax parsing, markdown rendering, and email template processing
 */

import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { createSendLog, getEligibleContacts, updateSendLog } from './db.js';
import { logger } from './logger.js';
import { validateTemplatePath } from './path-validator.js';
import { sendEmail } from './ses.js';
import { EmailThrottleController, getEmailThrottleController } from './throttle.js';
import type {
  CampaignResult,
  Contact,
  EmailSendParams,
  EmailVerificationResponse,
  ProgressCallback,
  SendMode,
  SendProgress,
} from './types.js';
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
};

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
  // Replace {Person Name} placeholder
  let processed = template.replace(/\{Person Name\}/g, contact.personName);

  // Replace {Company Name} placeholder
  processed = processed.replace(/\{Company Name\}/g, contact.companyName);

  // Parse spintax
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
 * Render markdown to HTML
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const html = await marked(markdown, {
    gfm: true,
    breaks: true,
  });

  // Wrap in email-friendly HTML
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1, h2, h3 { color: #2c3e50; }
    p { margin-bottom: 1em; }
    a { color: #3498db; }
    ul, ol { margin-bottom: 1em; padding-left: 2em; }
    li { margin-bottom: 0.5em; }
    blockquote { border-left: 4px solid #3498db; padding-left: 1em; margin-left: 0; color: #666; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 1em; overflow-x: auto; border-radius: 4px; }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
}

/**
 * Generate plain text version from markdown
 */
export function generatePlainText(markdown: string): string {
  // Simple conversion - remove markdown syntax
  return markdown
    .replace(/^#+\s+/gm, '') // Remove headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.+?)\*/g, '$1') // Remove italic
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)') // Convert links
    .replace(/`(.+?)`/g, '$1') // Remove inline code
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/^\s*[-*+]\s/gm, '• ') // Convert list bullets
    .replace(/^\s*\d+\.\s/gm, '$&') // Keep numbered list
    .trim();
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
  try {
    const verificationResult = await verifyEmail(contact.email);
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
  sendLogId: string
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
}

/**
 * Handle dry run for a contact
 * Updates send log to reflect dry run completion
 */
async function handleDryRun(
  contact: Contact,
  result: CampaignResult,
  sendLogId: string,
  subject: string
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
}

/**
 * Handle successful email send
 * Updates send log with 'sent' status and message ID
 */
async function handleSuccessfulSend(
  contact: Contact,
  messageId: string,
  result: CampaignResult,
  sendLogId: string,
  subject: string
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
}

/**
 * Handle failed email send
 * Updates send log with 'failed' status and error reason
 */
async function handleFailedSend(
  contact: Contact,
  errorReason: string,
  result: CampaignResult,
  sendLogId: string,
  subject: string
): Promise<void> {
  result.failedCount++;
  result.details.push({
    email: contact.email,
    status: 'failed',
    reason: errorReason,
  });
  // Update send log with failure
  await updateSendLog(sendLogId, {
    status: 'failed',
    errorReason,
  });
  await logger.logSendLogUpdated(sendLogId, 'pending', 'failed', {
    email: contact.email,
    subject,
    error: errorReason,
  });
}

/**
 * Handle contact processing error
 * Updates send log with 'failed' status
 */
async function handleContactError(
  contact: Contact,
  error: unknown,
  result: CampaignResult,
  sendLogId: string
): Promise<void> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  result.failedCount++;
  result.details.push({
    email: contact.email,
    status: 'failed',
    reason: errorMsg,
  });
  await logger.logError('Campaign Processing', errorMsg, {
    email: contact.email,
    contact: { companyName: contact.companyName, personName: contact.personName },
  });
  // Update send log with failure
  await updateSendLog(sendLogId, {
    status: 'failed',
    errorReason: errorMsg,
  });
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
async function processContact(
  contact: Contact,
  templateContent: string,
  throttleController: EmailThrottleController,
  dryRun: boolean,
  result: CampaignResult,
  onProgress?: ProgressCallback,
  currentContactIndex?: number,
  totalContacts?: number
): Promise<void> {
  const current = currentContactIndex ?? 0;
  const total = totalContacts ?? 1;

  // Process template first to get subject for the log
  const processedTemplate = processTemplate(templateContent, contact);
  const { subject, body } = extractSubject(processedTemplate);
  const bodyPreview = body.substring(0, 500);

  // Determine mode based on dryRun flag
  const mode: SendMode = dryRun ? 'dry_run' : 'production';

  // Create send log entry before any processing
  const sendLog = await createSendLog(contact.id, mode, subject, bodyPreview);
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

  // Skip if email is not safe - no waiting for rejected contacts
  if (!isEmailSafe(verificationOutcome.verificationResult)) {
    await handleUnsafeEmail(contact, verificationOutcome.verificationResult, result, sendLogId);
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'skipped',
      message: `Skipped ${contact.email} - unsafe email`,
    });
    return;
  }

  // Only wait for contacts that will actually be sent
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

  if (dryRun) {
    await handleDryRun(contact, result, sendLogId, subject);
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

  const htmlBody = await renderMarkdown(body);
  const textBody = generatePlainText(body);

  // Send email
  const emailParams: EmailSendParams = {
    to: contact.email,
    subject,
    htmlBody,
    textBody,
  };

  const sendResult = await sendEmail(emailParams, throttleController);

  if (sendResult.success) {
    await handleSuccessfulSend(
      contact,
      sendResult.messageId || 'unknown',
      result,
      sendLogId,
      subject
    );
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'completed',
      message: `Sent to ${contact.email}`,
    });
  } else {
    await handleFailedSend(
      contact,
      sendResult.error || 'Unknown error',
      result,
      sendLogId,
      subject
    );
    await reportProgress(onProgress, {
      currentContact: current,
      totalContacts: total,
      email: contact.email,
      status: 'failed',
      message: `Failed to send to ${contact.email}: ${sendResult.error || 'Unknown error'}`,
    });
  }
}

/**
 * Run email campaign for all eligible contacts
 *
 * @param templatePath - Path to markdown template file
 * @param dryRun - If true, don't actually send emails (for testing)
 * @param onProgress - Optional callback for real-time progress updates
 * @returns Campaign result summary
 */
export async function runCampaign(
  templatePath: string,
  dryRun: boolean = false,
  onProgress?: ProgressCallback
): Promise<CampaignResult> {
  const result: CampaignResult = {
    totalContacts: 0,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    details: [],
  };

  // Validate template path for security
  const pathValidation = validateTemplatePath(templatePath);
  if (!pathValidation.valid) {
    throw new Error(`Invalid template path: ${pathValidation.error}`);
  }
  const sanitizedTemplatePath = pathValidation.sanitizedPath;

  // Get shared throttle controller singleton
  const throttleController = getEmailThrottleController();

  // Get eligible contacts (those without a successful send log)
  const contacts = await getEligibleContacts();
  result.totalContacts = contacts.length;

  if (contacts.length === 0) {
    return result;
  }

  // Preliminary quota check before starting campaign
  const canStartCampaign = await throttleController.checkQuota();
  if (!canStartCampaign) {
    // Log quota exhaustion error - no need to mark contacts as failed
    // since we're using send_logs now and they can be retried
    result.failedCount = contacts.length;
    for (const contact of contacts) {
      result.details.push({
        email: contact.email,
        status: 'failed',
        reason: 'SES quota near exhaustion. Campaign aborted.',
      });
    }
    await logger.logError('Campaign Aborted', 'SES quota near exhaustion', {
      attemptedContacts: contacts.length,
    });
    return result;
  }

  try {
    // Read template file
    const templateContent = await readFile(sanitizedTemplatePath, 'utf-8');

    // Process each contact
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      try {
        await processContact(
          contact,
          templateContent,
          throttleController,
          dryRun,
          result,
          onProgress,
          i + 1, // current contact index (1-based for display)
          contacts.length // total contacts
        );
      } catch (error) {
        // Create a send log for the error case since processContact might have failed
        // before creating one (e.g., during template processing)
        const { subject, body } = extractSubject(processTemplate(templateContent, contact));
        const bodyPreview = body.substring(0, 500);
        const mode: SendMode = dryRun ? 'dry_run' : 'production';
        const errorLog = await createSendLog(contact.id, mode, subject, bodyPreview);
        await handleContactError(contact, error, result, errorLog.id);
        // Report the error via progress callback
        await reportProgress(onProgress, {
          currentContact: i + 1,
          totalContacts: contacts.length,
          email: contact.email,
          status: 'failed',
          message: `Error processing ${contact.email}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.logError('Campaign Execution', errorMessage, {
      templateName: getSafeFilename(sanitizedTemplatePath),
    });
    throw error;
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
  templatePath: string,
  sampleContact: Contact
): Promise<{ subject: string; htmlBody: string; textBody: string }> {
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
