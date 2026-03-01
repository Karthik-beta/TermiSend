/**
 * Type definitions for TermiSend
 * Central type definitions for database entities, API responses, and function parameters
 */

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * Represents a contact in the database
 */
export interface Contact {
  id: string;
  company_name: string;
  person_name: string;
  email: string;
  status: 'pending' | 'sent' | 'verified' | 'failed' | 'invalid';
  created_at: Date;
}

/**
 * Represents an audit log entry in the database
 */
export interface AuditLog {
  id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  created_at: Date;
}

// ============================================================================
// Event Types for Audit Logging
// ============================================================================

export type EventType =
  | 'USER_INPUT'
  | 'EXCEL_IMPORT_START'
  | 'EXCEL_IMPORT_ROW_VALID'
  | 'EXCEL_IMPORT_ROW_INVALID'
  | 'EXCEL_IMPORT_COMPLETE'
  | 'API_VERIFIER_REQ'
  | 'API_VERIFIER_RES'
  | 'AWS_SES_REQ'
  | 'AWS_SES_RES'
  | 'CONTACT_UPDATED'
  | 'ERROR';

// ============================================================================
// Excel Import Types
// ============================================================================

/**
 * Raw row data from Excel file
 */
export interface ExcelRow {
  'Company Name': string;
  'Person Name': string;
  Email: string;
}

/**
 * Validated contact data
 */
export interface ContactInput {
  companyName: string;
  personName: string;
  email: string;
  [key: string]: string;
}

/**
 * Result of Excel import operation
 */
export interface ImportResult {
  totalRows: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }>;
}

// ============================================================================
// Email Verification Types
// ============================================================================

/**
 * Response from MyEmailVerifier API
 */
export interface EmailVerificationResponse {
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'role' | 'disposable';
  risk: 'low' | 'medium' | 'high';
  email?: string;
  message?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// AWS SES Types
// ============================================================================

/**
 * Email sending parameters
 */
export interface EmailSendParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Result of email sending operation
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ============================================================================
// Campaign Types
// ============================================================================

/**
 * Result of email campaign
 */
export interface CampaignResult {
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  details: Array<{
    email: string;
    status: 'sent' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

// ============================================================================
// UI State Types
// ============================================================================

export type AppView = 'MENU' | 'IMPORT' | 'CAMPAIGN' | 'RESULTS';

export interface UIState {
  currentView: AppView;
  message: string;
  error: string | null;
  isLoading: boolean;
}

// ============================================================================
// JSON Value Types for Database
// ============================================================================

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
