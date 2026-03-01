/**
 * Email Campaign module for TermiSend (Part B)
 * Handles spintax parsing, markdown rendering, and email template processing
 */

import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { getPendingContacts, updateContactStatus } from './db.js';
import { logger } from './logger.js';
import { validateTemplatePath } from './path-validator.js';
import { sendEmail } from './ses.js';
import { EmailThrottleController, getEmailThrottleController } from './throttle.js';
import type { CampaignResult, Contact, EmailSendParams } from './types.js';
import { getSafeFilename } from './utils/security.js';
import { verifyEmail } from './verifier.js';

// Test-only exports for dependency injection
// Use regular properties (not getters) so Bun's spyOn can mock them
export const __test = {
  getPendingContacts: getPendingContacts,
  updateContactStatus: updateContactStatus,
  sendEmail: sendEmail,
  verifyEmail: verifyEmail,
  emailThrottleController: EmailThrottleController,
  resetThrottleController: () => EmailThrottleController.resetInstance(),
};

// ============================================================================
// Spintax Parser
// ============================================================================

/**
 * Parse spintax syntax and generate a random variation
 * Supports nested spintax: {Hello|Hi {there|friend}}
 *
 * @param text - Text containing spintax
 * @returns Rendered text with random selections
 */
export function parseSpintax(text: string): string {
  // Regex to match spintax groups: {option1|option2|option3}
  const spintaxRegex = /\{([^{}]+)\}/g;

  // Maximum iterations to prevent infinite loops on malformed input
  let iterations = 0;
  const maxIterations = 100;

  let result = text;

  while (spintaxRegex.test(result) && iterations < maxIterations) {
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
 * Run email campaign for all pending contacts
 *
 * @param templatePath - Path to markdown template file
 * @param dryRun - If true, don't actually send emails (for testing)
 * @returns Campaign result summary
 */
export async function runCampaign(
  templatePath: string,
  dryRun: boolean = false
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

  // Get pending contacts
  const contacts = await getPendingContacts();
  result.totalContacts = contacts.length;

  if (contacts.length === 0) {
    return result;
  }

  // Preliminary quota check before starting campaign
  const canStartCampaign = await throttleController.checkQuota();
  if (!canStartCampaign) {
    // Mark all contacts as failed
    for (const contact of contacts) {
      result.failedCount++;
      result.details.push({
        email: contact.email,
        status: 'failed',
        reason: 'SES quota near exhaustion. Campaign aborted.',
      });
      await updateContactStatus(contact.email, 'failed');
    }
    return result;
  }

  try {
    // Read template file
    const templateContent = await readFile(sanitizedTemplatePath, 'utf-8');

    // Process each contact
    for (const contact of contacts) {
      // Wait before processing next email (throttling)
      // This enforces the configured delay between personalizations
      await throttleController.waitBeforeSend();

      try {
        // Process template
        const processedTemplate = processTemplate(templateContent, contact);

        // Extract subject and body
        const { subject, body } = extractSubject(processedTemplate);

        // Verify email
        const verificationResult = await verifyEmail(contact.email);

        // Skip if email is high risk
        if (verificationResult.risk === 'high' || verificationResult.status === 'invalid') {
          result.skippedCount++;
          result.details.push({
            email: contact.email,
            status: 'skipped',
            reason: `Email verification failed: ${verificationResult.status} (${verificationResult.risk} risk)`,
          });
          await updateContactStatus(contact.email, 'invalid');
          await logger.logContactUpdated(contact.email, 'pending', 'invalid');
          continue;
        }

        if (dryRun) {
          // Dry run - just log what would happen
          result.sentCount++;
          result.details.push({
            email: contact.email,
            status: 'sent',
            reason: 'DRY RUN - Email not actually sent',
          });
          continue;
        }

        // Render markdown to HTML
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
          result.sentCount++;
          result.details.push({
            email: contact.email,
            status: 'sent',
            reason: `MessageId: ${sendResult.messageId}`,
          });
          await updateContactStatus(contact.email, 'sent');
          await logger.logContactUpdated(contact.email, 'pending', 'sent');
        } else {
          result.failedCount++;
          result.details.push({
            email: contact.email,
            status: 'failed',
            reason: sendResult.error || 'Unknown error',
          });
          await updateContactStatus(contact.email, 'failed');
          await logger.logContactUpdated(contact.email, 'pending', 'failed');
        }
      } catch (error) {
        result.failedCount++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.details.push({
          email: contact.email,
          status: 'failed',
          reason: errorMsg,
        });
        await logger.logError('Campaign Processing', errorMsg, {
          email: contact.email,
          contact: { companyName: contact.companyName, personName: contact.personName },
        });
        await updateContactStatus(contact.email, 'failed');
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
