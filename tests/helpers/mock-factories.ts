/**
 * Mock Factories for TermiSend Tests
 * Factory functions for creating test data objects
 */

import type {
  Contact,
  AuditLog,
  EmailVerificationResponse,
  ImportResult,
  CampaignResult,
  ThrottleConfig,
  EmailSendParams,
  EmailSendResult,
} from '../../src/types.js';

// ============================================================================
// Contact Factories
// ============================================================================

/**
 * Factory function for creating a test contact
 * @param overrides - Properties to override defaults
 * @returns Contact object
 */
export function createMockContact(overrides: Partial<Contact> = {}): Contact {
  const timestamp = new Date();
  return {
    id: `contact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    companyName: 'Test Company Inc.',
    personName: 'John Doe',
    email: 'john.doe@testcompany.com',
    status: 'pending',
    createdAt: timestamp,
    ...overrides,
  };
}

/**
 * Factory function for creating multiple test contacts
 * @param count - Number of contacts to create
 * @param overrides - Properties to override defaults
 * @returns Array of Contact objects
 */
export function createMockContacts(count: number, overrides: Partial<Contact> = {}): Contact[] {
  return Array.from({ length: count }, (_, index) =>
    createMockContact({
      email: `contact${index}@example.com`,
      personName: `Person ${index}`,
      companyName: `Company ${index}`,
      ...overrides,
    })
  );
}

/**
 * Factory for pending contacts
 * @param overrides - Properties to override
 * @returns Pending contact
 */
export function createPendingContact(overrides: Partial<Contact> = {}): Contact {
  return createMockContact({ status: 'pending', ...overrides });
}

/**
 * Factory for sent contacts
 * @param overrides - Properties to override
 * @returns Sent contact
 */
export function createSentContact(overrides: Partial<Contact> = {}): Contact {
  return createMockContact({ status: 'sent', ...overrides });
}

/**
 * Factory for invalid contacts
 * @param overrides - Properties to override
 * @returns Invalid contact
 */
export function createInvalidContact(overrides: Partial<Contact> = {}): Contact {
  return createMockContact({ status: 'invalid', ...overrides });
}

/**
 * Factory for failed contacts
 * @param overrides - Properties to override
 * @returns Failed contact
 */
export function createFailedContact(overrides: Partial<Contact> = {}): Contact {
  return createMockContact({ status: 'failed', ...overrides });
}

// ============================================================================
// Audit Log Factories
// ============================================================================

/**
 * Factory function for creating an audit log entry
 * @param overrides - Properties to override defaults
 * @returns AuditLog object
 */
export function createMockAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    eventType: 'USER_INPUT',
    payload: { action: 'test-action', data: {} },
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Factory for Excel import audit logs
 * @param overrides - Properties to override
 * @returns Excel import audit log
 */
export function createExcelImportAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return createMockAuditLog({
    eventType: 'EXCEL_IMPORT_START',
    payload: { filePath: '/test/file.xlsx', totalRows: 10 },
    ...overrides,
  });
}

/**
 * Factory for API verifier audit logs
 * @param overrides - Properties to override
 * @returns API verifier audit log
 */
export function createApiVerifierAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return createMockAuditLog({
    eventType: 'API_VERIFIER_REQ',
    payload: { email: 'test@example.com', api: 'MyEmailVerifier' },
    ...overrides,
  });
}

/**
 * Factory for error audit logs
 * @param overrides - Properties to override
 * @returns Error audit log
 */
export function createErrorAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return createMockAuditLog({
    eventType: 'ERROR',
    payload: { context: 'test-context', errorMessage: 'Test error' },
    ...overrides,
  });
}

// ============================================================================
// Email Verification Response Factories
// ============================================================================

/**
 * Factory function for creating a MyEmailVerifier API response
 * @param overrides - Properties to override defaults
 * @returns EmailVerificationResponse object
 */
export function createMockVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return {
    status: 'valid',
    risk: 'low',
    email: 'test@example.com',
    message: 'Email is valid',
    ...overrides,
  };
}

/**
 * Factory for valid email response
 * @param overrides - Properties to override
 * @returns Valid verification response
 */
export function createValidVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return createMockVerificationResponse({
    status: 'valid',
    risk: 'low',
    ...overrides,
  });
}

/**
 * Factory for invalid email response
 * @param overrides - Properties to override
 * @returns Invalid verification response
 */
export function createInvalidVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return createMockVerificationResponse({
    status: 'invalid',
    risk: 'high',
    ...overrides,
  });
}

/**
 * Factory for catch-all email response
 * @param overrides - Properties to override
 * @returns Catch-all verification response
 */
export function createCatchAllVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return createMockVerificationResponse({
    status: 'catch-all',
    risk: 'medium',
    ...overrides,
  });
}

/**
 * Factory for disposable email response
 * @param overrides - Properties to override
 * @returns Disposable verification response
 */
export function createDisposableVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return createMockVerificationResponse({
    status: 'disposable',
    risk: 'high',
    ...overrides,
  });
}

/**
 * Factory for role-based email response
 * @param overrides - Properties to override
 * @returns Role-based verification response
 */
export function createRoleVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return createMockVerificationResponse({
    status: 'role',
    risk: 'medium',
    ...overrides,
  });
}

/**
 * Factory for unknown email response
 * @param overrides - Properties to override
 * @returns Unknown verification response
 */
export function createUnknownVerificationResponse(
  overrides: Partial<EmailVerificationResponse> = {}
): EmailVerificationResponse {
  return createMockVerificationResponse({
    status: 'unknown',
    risk: 'medium',
    ...overrides,
  });
}

// ============================================================================
// SES Response Factories
// ============================================================================

/**
 * Factory for successful SES send response
 * @param overrides - Properties to override
 * @returns Successful send result
 */
export function createSuccessfulSendResult(
  overrides: Partial<EmailSendResult> = {}
): EmailSendResult {
  return {
    success: true,
    messageId: `message-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    ...overrides,
  };
}

/**
 * Factory for failed SES send response
 * @param overrides - Properties to override
 * @returns Failed send result
 */
export function createFailedSendResult(
  overrides: Partial<EmailSendResult> = {}
): EmailSendResult {
  return {
    success: false,
    error: 'SES API Error: Rate limit exceeded',
    ...overrides,
  };
}

/**
 * Factory for SES quota exceeded response
 * @returns Quota exceeded result
 */
export function createQuotaExceededResult(): EmailSendResult {
  return createFailedSendResult({
    error: 'SES quota near exhaustion. Sending paused.',
  });
}

/**
 * Factory for SES configuration error response
 * @returns Configuration error result
 */
export function createConfigurationErrorResult(): EmailSendResult {
  return createFailedSendResult({
    error: 'AWS credentials are not configured',
  });
}

/**
 * Factory for SES send email parameters
 * @param overrides - Properties to override
 * @returns Email send parameters
 */
export function createEmailSendParams(
  overrides: Partial<EmailSendParams> = {}
): EmailSendParams {
  return {
    to: 'recipient@example.com',
    subject: 'Test Email Subject',
    htmlBody: '<html><body><p>Test HTML content</p></body></html>',
    textBody: 'Test text content',
    ...overrides,
  };
}

// ============================================================================
// AWS SES Account Info Factories
// ============================================================================

/**
 * Factory for SES account info response
 * @param overrides - Properties to override
 * @returns SES account info
 */
export function createMockAccountInfo(
  overrides: Record<string, unknown> = {}
): { success: true; sendQuota: { max24HourSend: number; maxSendRate: number; sentLast24Hours: number } } {
  return {
    success: true,
    sendQuota: {
      max24HourSend: 1000,
      maxSendRate: 14,
      sentLast24Hours: 100,
    },
    ...overrides,
  };
}

/**
 * Factory for healthy quota status
 * @returns Healthy account info
 */
export function createHealthyAccountInfo(): { success: true; sendQuota: { max24HourSend: number; maxSendRate: number; sentLast24Hours: number } } {
  return createMockAccountInfo({
    sendQuota: {
      max24HourSend: 1000,
      maxSendRate: 14,
      sentLast24Hours: 100, // 10% used
    },
  });
}

/**
 * Factory for near-exhausted quota status
 * @returns Near-exhausted account info
 */
export function createNearExhaustedAccountInfo(): { success: true; sendQuota: { max24HourSend: number; maxSendRate: number; sentLast24Hours: number } } {
  return createMockAccountInfo({
    sendQuota: {
      max24HourSend: 1000,
      maxSendRate: 14,
      sentLast24Hours: 950, // 95% used
    },
  });
}

/**
 * Factory for failed account info response
 * @returns Failed account info
 */
export function createFailedAccountInfo(): { success: false; error: string } {
  return {
    success: false,
    error: 'AWS credentials error',
  };
}

// ============================================================================
// Throttle Configuration Factories
// ============================================================================

/**
 * Factory for throttle configuration
 * @param overrides - Properties to override
 * @returns ThrottleConfig object
 */
export function createMockThrottleConfig(overrides: Partial<ThrottleConfig> = {}): ThrottleConfig {
  return {
    minDelayMs: 60000,
    maxDelayMs: 120000,
    breakProbabilityPercent: 5,
    breakMinMinutes: 3,
    breakMaxMinutes: 5,
    ...overrides,
  };
}

/**
 * Factory for aggressive throttling config (short delays, high break probability)
 * @returns Aggressive throttle config
 */
export function createAggressiveThrottleConfig(): ThrottleConfig {
  return createMockThrottleConfig({
    minDelayMs: 1000,
    maxDelayMs: 2000,
    breakProbabilityPercent: 50,
    breakMinMinutes: 1,
    breakMaxMinutes: 2,
  });
}

/**
 * Factory for minimal throttling config (no breaks)
 * @returns Minimal throttle config
 */
export function createMinimalThrottleConfig(): ThrottleConfig {
  return createMockThrottleConfig({
    minDelayMs: 60000,
    maxDelayMs: 120000,
    breakProbabilityPercent: 0,
  });
}

/**
 * Factory for maximum throttling config (always breaks)
 * @returns Maximum throttle config
 */
export function createMaximumThrottleConfig(): ThrottleConfig {
  return createMockThrottleConfig({
    minDelayMs: 120000,
    maxDelayMs: 300000,
    breakProbabilityPercent: 100,
    breakMinMinutes: 5,
    breakMaxMinutes: 10,
  });
}

// ============================================================================
// Import Result Factories
// ============================================================================

/**
 * Factory for import result
 * @param overrides - Properties to override
 * @returns ImportResult object
 */
export function createMockImportResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    totalRows: 10,
    successCount: 8,
    failedCount: 2,
    errors: [
      { row: 3, error: 'Invalid email format' },
      { row: 7, error: 'Missing company name' },
    ],
    ...overrides,
  };
}

/**
 * Factory for successful import result
 * @param count - Number of successful imports
 * @returns Successful import result
 */
export function createSuccessfulImportResult(count: number): ImportResult {
  return createMockImportResult({
    totalRows: count,
    successCount: count,
    failedCount: 0,
    errors: [],
  });
}

/**
 * Factory for failed import result
 * @returns Failed import result
 */
export function createFailedImportResult(): ImportResult {
  return createMockImportResult({
    totalRows: 10,
    successCount: 0,
    failedCount: 10,
    errors: Array.from({ length: 10 }, (_, i) => ({
      row: i + 2,
      error: 'Validation failed',
    })),
  });
}

// ============================================================================
// Campaign Result Factories
// ============================================================================

/**
 * Factory for campaign result
 * @param overrides - Properties to override
 * @returns CampaignResult object
 */
export function createMockCampaignResult(overrides: Partial<CampaignResult> = {}): CampaignResult {
  return {
    totalContacts: 10,
    sentCount: 7,
    failedCount: 2,
    skippedCount: 1,
    details: [
      { email: 'success1@example.com', status: 'sent', reason: 'MessageId: msg-001' },
      { email: 'success2@example.com', status: 'sent', reason: 'MessageId: msg-002' },
      { email: 'failed@example.com', status: 'failed', reason: 'SES API Error' },
      { email: 'invalid@example.com', status: 'skipped', reason: 'Invalid email' },
    ],
    ...overrides,
  };
}

/**
 * Factory for successful campaign result
 * @param count - Number of contacts
 * @returns Successful campaign result
 */
export function createSuccessfulCampaignResult(count: number): CampaignResult {
  return createMockCampaignResult({
    totalContacts: count,
    sentCount: count,
    failedCount: 0,
    skippedCount: 0,
    details: Array.from({ length: count }, (_, i) => ({
      email: `success${i}@example.com`,
      status: 'sent' as const,
      reason: `MessageId: msg-${i}`,
    })),
  });
}

// ============================================================================
// Excel Row Factories
// ============================================================================

/**
 * Factory for Excel row data
 * @param overrides - Properties to override
 * @returns Excel row object
 */
export function createMockExcelRow(
  overrides: Record<string, string | number> = {}
): Record<string, string | number> {
  return {
    'Company Name': 'Test Company',
    'Person Name': 'John Doe',
    Email: 'john@testcompany.com',
    ...overrides,
  };
}

/**
 * Factory for invalid Excel row
 * @returns Invalid Excel row
 */
export function createInvalidExcelRow(): Record<string, string | number> {
  return createMockExcelRow({
    Email: 'invalid-email',
    'Person Name': '',
  });
}

/**
 * Factory for numeric Excel row (testing number to string conversion)
 * @returns Excel row with numeric values
 */
export function createNumericExcelRow(): Record<string, string | number> {
  return createMockExcelRow({
    'Company Name': 12345,
    'Person Name': 67890,
    Email: 'test@example.com',
  });
}

/**
 * Factory for empty Excel row
 * @returns Empty Excel row
 */
export function createEmptyExcelRow(): Record<string, string | number | undefined> {
  return {
    'Company Name': '',
    'Person Name': '',
    Email: '',
  };
}
