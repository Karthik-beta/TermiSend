/**
 * Audit Logger module for TermiSend
 * Handles logging of all inputs, outputs, and operations to the audit_logs table
 */

import { insertAuditLog } from './db.js';
import type { EventType } from './types.js';

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
  }): Promise<void>;
  logApiVerifierRequest(email: string): Promise<void>;
  logApiVerifierResponse(email: string, response: Record<string, unknown>): Promise<void>;
  logAwsSesRequest(email: string, params: Record<string, unknown>): Promise<void>;
  logAwsSesResponse(email: string, messageId: string): Promise<void>;
  logContactUpdated(email: string, oldStatus: string, newStatus: string): Promise<void>;
  logError(
    context: string,
    error: Error | string,
    additionalData?: Record<string, unknown>
  ): Promise<void>;
}

// ============================================================================
// Audit Logger Implementation
// ============================================================================

class AuditLogger implements Logger {
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
      console.error('Failed to write audit log:', error);
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
   */
  async logExcelImportStart(filePath: string, totalRows: number): Promise<void> {
    await this.logEvent('EXCEL_IMPORT_START', {
      filePath,
      totalRows,
    });
  }

  /**
   * Log successful validation of a single Excel row
   */
  async logExcelImportRowValid(row: number, data: Record<string, unknown>): Promise<void> {
    await this.logEvent('EXCEL_IMPORT_ROW_VALID', {
      row,
      data,
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
    await this.logEvent('EXCEL_IMPORT_ROW_INVALID', {
      row,
      error,
      data,
    });
  }

  /**
   * Log completion of Excel import operation
   */
  async logExcelImportComplete(result: {
    totalRows: number;
    successCount: number;
    failedCount: number;
  }): Promise<void> {
    await this.logEvent('EXCEL_IMPORT_COMPLETE', {
      ...result,
    });
  }

  /**
   * Log MyEmailVerifier API request
   */
  async logApiVerifierRequest(email: string): Promise<void> {
    await this.logEvent('API_VERIFIER_REQ', {
      email,
      api: 'MyEmailVerifier',
    });
  }

  /**
   * Log MyEmailVerifier API response
   */
  async logApiVerifierResponse(email: string, response: Record<string, unknown>): Promise<void> {
    await this.logEvent('API_VERIFIER_RES', {
      email,
      response,
    });
  }

  /**
   * Log AWS SES send request
   */
  async logAwsSesRequest(email: string, params: Record<string, unknown>): Promise<void> {
    await this.logEvent('AWS_SES_REQ', {
      email,
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
   */
  async logAwsSesResponse(email: string, messageId: string): Promise<void> {
    await this.logEvent('AWS_SES_RES', {
      email,
      messageId,
    });
  }

  /**
   * Log contact status update
   */
  async logContactUpdated(email: string, oldStatus: string, newStatus: string): Promise<void> {
    await this.logEvent('CONTACT_UPDATED', {
      email,
      oldStatus,
      newStatus,
    });
  }

  /**
   * Log error with context
   */
  async logError(
    context: string,
    error: Error | string,
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    await this.logEvent('ERROR', {
      context,
      errorMessage,
      errorStack,
      ...additionalData,
    });
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const logger = new AuditLogger();

// ============================================================================
// Convenience export for direct usage
// ============================================================================

export const logEvent = logger.logEvent.bind(logger);
export const logUserInput = logger.logUserInput.bind(logger);
export const logExcelImportStart = logger.logExcelImportStart.bind(logger);
export const logExcelImportRowValid = logger.logExcelImportRowValid.bind(logger);
export const logExcelImportRowInvalid = logger.logExcelImportRowInvalid.bind(logger);
export const logExcelImportComplete = logger.logExcelImportComplete.bind(logger);
export const logApiVerifierRequest = logger.logApiVerifierRequest.bind(logger);
export const logApiVerifierResponse = logger.logApiVerifierResponse.bind(logger);
export const logAwsSesRequest = logger.logAwsSesRequest.bind(logger);
export const logAwsSesResponse = logger.logAwsSesResponse.bind(logger);
export const logContactUpdated = logger.logContactUpdated.bind(logger);
export const logError = logger.logError.bind(logger);
