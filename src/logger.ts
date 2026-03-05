/**
 * Audit Logger module for TermiSend
 * Handles logging of all inputs, outputs, and operations to the audit_logs table
 */

import { insertAuditLog } from './db.js';
import type { EventType } from './types.js';
import { getSafeFilename, redactEmail } from './utils/security.js';

// ============================================================================
// Logger Interface
// ============================================================================

export interface Logger {
  logEvent(eventType: EventType, payload: Record<string, unknown>): Promise<void>;
  logUserInput(action: string, data: Record<string, unknown>): Promise<void>;
  logExcelImportStart(filePath: string, totalRows: number): Promise<void>;
  logExcelImportRowValid(row: number, data: Record<string, unknown>): Promise<void>;
  logExcelImportRowInvalid(
    row: number,
    error: string,
    data: Record<string, unknown>
  ): Promise<void>;
  logExcelImportComplete(result: {
    totalRows: number;
    successCount: number;
    failedCount: number;
    insertedCount: number;
    skippedCount: number;
    existingCount: number;
  }): Promise<void>;
  logApiVerifierRequest(email: string): Promise<void>;
  logApiVerifierResponse(email: string, response: Record<string, unknown>): Promise<void>;
  logAwsSesRequest(email: string, params: Record<string, unknown>): Promise<void>;
  logAwsSesResponse(email: string, messageId: string): Promise<void>;
  logSendLogUpdated(
    logId: string,
    oldStatus: string,
    newStatus: string,
    additionalData?: Record<string, unknown>
  ): Promise<void>;
  logError(
    context: string,
    error: Error | string,
    additionalData?: Record<string, unknown>
  ): Promise<void>;
  /** Log informational message */
  info(message: string, data?: Record<string, unknown>): Promise<void>;
  /** Log warning message */
  warn(message: string, data?: Record<string, unknown>): Promise<void>;
}

// ============================================================================
// Audit Logger Implementation
// ============================================================================

export class AuditLogger implements Logger {
  /**
   * Generic event logging method
   */
  async logEvent(eventType: EventType, payload: Record<string, unknown>): Promise<void> {
    try {
      await insertAuditLog(eventType, {
        ...payload,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Fallback to console only if database logging fails
      // This should not happen in normal operation
      console.error('❌ Failed to write audit log');
      console.error(`   Operation: ${eventType}`);
      console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      console.error('   Check database connection');
    }
  }

  /**
   * Log user input actions
   */
  async logUserInput(action: string, data: Record<string, unknown>): Promise<void> {
    await this.logEvent('USER_INPUT', {
      action,
      data,
    });
  }

  /**
   * Log start of Excel import operation
   * Only logs filename, not full path (security)
   */
  async logExcelImportStart(filePath: string, totalRows: number): Promise<void> {
    const safeFilename = getSafeFilename(filePath);
    await this.logEvent('EXCEL_IMPORT_START', {
      fileName: safeFilename,
      totalRows,
    });
  }

  /**
   * Log successful validation of a single Excel row
   */
  async logExcelImportRowValid(row: number, data: Record<string, unknown>): Promise<void> {
    const safeData = { ...data };
    if (typeof safeData.email === 'string') {
      safeData.email = redactEmail(safeData.email);
    }
    await this.logEvent('EXCEL_IMPORT_ROW_VALID', {
      row,
      data: safeData,
    });
  }

  /**
   * Log failed validation of a single Excel row
   */
  async logExcelImportRowInvalid(
    row: number,
    error: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const safeData = { ...data };
    if (typeof safeData.email === 'string') {
      safeData.email = redactEmail(safeData.email);
    }
    await this.logEvent('EXCEL_IMPORT_ROW_INVALID', {
      row,
      error,
      data: safeData,
    });
  }

  /**
   * Log completion of Excel import operation
   */
  async logExcelImportComplete(result: {
    totalRows: number;
    successCount: number;
    failedCount: number;
    insertedCount: number;
    skippedCount: number;
    existingCount: number;
  }): Promise<void> {
    await this.logEvent('EXCEL_IMPORT_COMPLETE', {
      ...result,
    });
  }

  /**
   * Log MyEmailVerifier API request
   * Email is redacted for privacy
   */
  async logApiVerifierRequest(email: string): Promise<void> {
    await this.logEvent('API_VERIFIER_REQ', {
      email: redactEmail(email),
      api: 'MyEmailVerifier',
    });
  }

  /**
   * Log MyEmailVerifier API response
   * Email is redacted for privacy
   */
  async logApiVerifierResponse(email: string, response: Record<string, unknown>): Promise<void> {
    await this.logEvent('API_VERIFIER_RES', {
      email: redactEmail(email),
      response,
    });
  }

  /**
   * Log AWS SES send request
   * Email is redacted for privacy
   */
  async logAwsSesRequest(email: string, params: Record<string, unknown>): Promise<void> {
    await this.logEvent('AWS_SES_REQ', {
      email: redactEmail(email),
      params: {
        ...params,
        // Exclude sensitive data if any
        htmlBody: params.htmlBody ? '[HTML_CONTENT]' : undefined,
        textBody: params.textBody ? '[TEXT_CONTENT]' : undefined,
      },
    });
  }

  /**
   * Log AWS SES send response
   * Email is redacted for privacy
   */
  async logAwsSesResponse(email: string, messageId: string): Promise<void> {
    await this.logEvent('AWS_SES_RES', {
      email: redactEmail(email),
      messageId,
    });
  }

  /**
   * Log send log status update
   * Tracks changes to send_log entries for audit purposes
   */
  async logSendLogUpdated(
    logId: string,
    oldStatus: string,
    newStatus: string,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    const safeData = additionalData ? { ...additionalData } : {};
    if (typeof safeData.email === 'string') {
      safeData.email = redactEmail(safeData.email);
    }
    await this.logEvent('SEND_LOG_UPDATED', {
      logId,
      oldStatus,
      newStatus,
      ...safeData,
    });
  }

  /**
   * Log error with context
   * Stack traces are NOT stored in persistent logs (security)
   * Only error message and type are logged to database
   * Stack traces are only output to console.error in development mode
   */
  async logError(
    context: string,
    error: Error | string,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorType = error instanceof Error ? error.name : 'Error';

    // Log to database WITHOUT stack trace (security best practice)
    await this.logEvent('ERROR', {
      context,
      errorMessage,
      errorType,
      ...additionalData,
    });
  }

  /**
   * Log informational message
   */
  async info(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.logEvent('USER_INPUT', {
      level: 'info',
      message,
      ...data,
    });
  }

  /**
   * Log warning message
   */
  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    await this.logEvent('ERROR', {
      level: 'warn',
      message,
      ...data,
    });
  }
}

// ============================================================================
// Export Singleton Instance - wrapped for test mockability
// Bun's spyOn cannot mock direct const exports, so we wrap in a container object
// ============================================================================

const _loggerInstance = new AuditLogger();

/**
 * Logger instance container - exported as object for spyOn compatibility
 * Tests can use: spyOn(loggerModule.logger, 'logEvent')
 */
export const logger = {
  logEvent: _loggerInstance.logEvent.bind(_loggerInstance),
  logUserInput: _loggerInstance.logUserInput.bind(_loggerInstance),
  logExcelImportStart: _loggerInstance.logExcelImportStart.bind(_loggerInstance),
  logExcelImportRowValid: _loggerInstance.logExcelImportRowValid.bind(_loggerInstance),
  logExcelImportRowInvalid: _loggerInstance.logExcelImportRowInvalid.bind(_loggerInstance),
  logExcelImportComplete: _loggerInstance.logExcelImportComplete.bind(_loggerInstance),
  logApiVerifierRequest: _loggerInstance.logApiVerifierRequest.bind(_loggerInstance),
  logApiVerifierResponse: _loggerInstance.logApiVerifierResponse.bind(_loggerInstance),
  logAwsSesRequest: _loggerInstance.logAwsSesRequest.bind(_loggerInstance),
  logAwsSesResponse: _loggerInstance.logAwsSesResponse.bind(_loggerInstance),
  logSendLogUpdated: _loggerInstance.logSendLogUpdated.bind(_loggerInstance),
  logError: _loggerInstance.logError.bind(_loggerInstance),
  info: _loggerInstance.info.bind(_loggerInstance),
  warn: _loggerInstance.warn.bind(_loggerInstance),
} satisfies Logger;

// ============================================================================
// Convenience export for direct usage
// ============================================================================

export const logEvent = logger.logEvent;
export const logUserInput = logger.logUserInput;
export const logExcelImportStart = logger.logExcelImportStart;
export const logExcelImportRowValid = logger.logExcelImportRowValid;
export const logExcelImportRowInvalid = logger.logExcelImportRowInvalid;
export const logExcelImportComplete = logger.logExcelImportComplete;
export const logApiVerifierRequest = logger.logApiVerifierRequest;
export const logApiVerifierResponse = logger.logApiVerifierResponse;
export const logAwsSesRequest = logger.logAwsSesRequest;
export const logAwsSesResponse = logger.logAwsSesResponse;
export const logSendLogUpdated = logger.logSendLogUpdated;
export const logError = logger.logError;
