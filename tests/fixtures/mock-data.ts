/**
 * Mock Data for TermiSend Tests
 * Static test data for consistent testing
 */

import type {
  Contact,
  EmailVerificationResponse,
  EmailSendResult,
  ThrottleConfig,
  ImportResult,
  CampaignResult,
} from '../../src/types.js';

// ============================================================================
// Test Contacts
// ============================================================================

/** Single valid test contact */
export const VALID_CONTACT: Contact = {
  id: 'contact-001',
  companyName: 'Acme Corporation',
  personName: 'John Smith',
  email: 'john.smith@acme.com',
  status: 'pending',
  createdAt: new Date('2024-01-15T10:00:00Z'),
};

/** Single valid test contact with different data */
export const VALID_CONTACT_2: Contact = {
  id: 'contact-002',
  companyName: 'Tech Innovations LLC',
  personName: 'Sarah Johnson',
  email: 'sarah.j@techinnovations.com',
  status: 'pending',
  createdAt: new Date('2024-01-15T11:30:00Z'),
};

/** Array of valid test contacts */
export const VALID_CONTACTS: Contact[] = [
  VALID_CONTACT,
  VALID_CONTACT_2,
  {
    id: 'contact-003',
    companyName: 'Global Solutions Inc',
    personName: 'Michael Chen',
    email: 'm.chen@globalsolutions.com',
    status: 'pending',
    createdAt: new Date('2024-01-15T12:00:00Z'),
  },
  {
    id: 'contact-004',
    companyName: 'Digital Dynamics',
    personName: 'Emily Brown',
    email: 'emily.brown@digitaldynamics.io',
    status: 'sent',
    createdAt: new Date('2024-01-14T09:15:00Z'),
  },
  {
    id: 'contact-005',
    companyName: 'Future Forward',
    personName: 'David Wilson',
    email: 'd.wilson@futureforward.net',
    status: 'failed',
    createdAt: new Date('2024-01-14T08:30:00Z'),
  },
];

/** Contact with special characters in name */
export const CONTACT_WITH_SPECIAL_CHARS: Contact = {
  id: 'contact-special',
  companyName: 'O\'Reilly & Associates LLC',
  personName: 'Jean-Pierre François',
  email: 'jp.francois@oreilly.com',
  status: 'pending',
  createdAt: new Date('2024-01-15T13:00:00Z'),
};

/** Contact with long name */
export const CONTACT_WITH_LONG_NAME: Contact = {
  id: 'contact-long',
  companyName: 'Very Long Company Name That Exceeds Normal Limits Incorporated Limited',
  personName: 'Alexander Christopher Bartholomew The Third',
  email: 'alexander.christopher.bartholomew.the.third@verylongcompanyname.com',
  status: 'pending',
  createdAt: new Date('2024-01-15T14:00:00Z'),
};

/** Contact with international email */
export const CONTACT_WITH_INTL_EMAIL: Contact = {
  id: 'contact-intl',
  companyName: '株式会社サンプル',
  personName: '山田太郎',
  email: 'yamada.taro@example.co.jp',
  status: 'pending',
  createdAt: new Date('2024-01-15T15:00:00Z'),
};

// ============================================================================
// Email Verification Responses
// ============================================================================

/** Valid email verification response */
export const VERIFICATION_VALID: EmailVerificationResponse = {
  status: 'valid',
  risk: 'low',
  email: 'test@example.com',
  message: 'Email is valid',
};

/** Invalid email verification response */
export const VERIFICATION_INVALID: EmailVerificationResponse = {
  status: 'invalid',
  risk: 'high',
  email: 'invalid@example.com',
  message: 'Email does not exist',
};

/** Catch-all email verification response */
export const VERIFICATION_CATCH_ALL: EmailVerificationResponse = {
  status: 'catch-all',
  risk: 'medium',
  email: 'test@catchall-domain.com',
  message: 'Domain accepts all emails',
};

/** Disposable email verification response */
export const VERIFICATION_DISPOSABLE: EmailVerificationResponse = {
  status: 'disposable',
  risk: 'high',
  email: 'temp@tempmail.com',
  message: 'Disposable email detected',
};

/** Role-based email verification response */
export const VERIFICATION_ROLE: EmailVerificationResponse = {
  status: 'role',
  risk: 'medium',
  email: 'admin@example.com',
  message: 'Role-based email detected',
};

/** Unknown email verification response */
export const VERIFICATION_UNKNOWN: EmailVerificationResponse = {
  status: 'unknown',
  risk: 'medium',
  email: 'unknown@example.com',
  message: 'Unable to verify email',
};

/** All verification responses for testing */
export const ALL_VERIFICATION_RESPONSES: EmailVerificationResponse[] = [
  VERIFICATION_VALID,
  VERIFICATION_INVALID,
  VERIFICATION_CATCH_ALL,
  VERIFICATION_DISPOSABLE,
  VERIFICATION_ROLE,
  VERIFICATION_UNKNOWN,
];

// ============================================================================
// SES Send Results
// ============================================================================

/** Successful SES send result */
export const SEND_SUCCESS: EmailSendResult = {
  success: true,
  messageId: 'message-12345-67890',
};

/** Failed SES send result */
export const SEND_FAILED: EmailSendResult = {
  success: false,
  error: 'SES API Error: Rate limit exceeded',
};

/** SES quota exceeded result */
export const SEND_QUOTA_EXCEEDED: EmailSendResult = {
  success: false,
  error: 'SES quota near exhaustion. Sending paused.',
};

/** SES configuration error result */
export const SEND_CONFIG_ERROR: EmailSendResult = {
  success: false,
  error: 'SES_FROM_EMAIL is not configured',
};

/** SES credentials error result */
export const SEND_CREDENTIALS_ERROR: EmailSendResult = {
  success: false,
  error: 'AWS credentials are not configured',
};

// ============================================================================
// Throttle Configurations
// ============================================================================

/** Default throttle configuration */
export const THROTTLE_DEFAULT: ThrottleConfig = {
  minDelayMs: 60000,
  maxDelayMs: 120000,
  breakProbabilityPercent: 5,
  breakMinMinutes: 3,
  breakMaxMinutes: 5,
};

/** Aggressive throttle configuration */
export const THROTTLE_AGGRESSIVE: ThrottleConfig = {
  minDelayMs: 1000,
  maxDelayMs: 2000,
  breakProbabilityPercent: 50,
  breakMinMinutes: 1,
  breakMaxMinutes: 2,
};

/** Minimal throttle configuration (no breaks) */
export const THROTTLE_MINIMAL: ThrottleConfig = {
  minDelayMs: 60000,
  maxDelayMs: 120000,
  breakProbabilityPercent: 0,
  breakMinMinutes: 3,
  breakMaxMinutes: 5,
};

/** Maximum throttle configuration (always breaks) */
export const THROTTLE_MAXIMUM: ThrottleConfig = {
  minDelayMs: 120000,
  maxDelayMs: 300000,
  breakProbabilityPercent: 100,
  breakMinMinutes: 5,
  breakMaxMinutes: 10,
};

/** Invalid throttle configuration (for edge case testing) */
export const THROTTLE_INVALID: Partial<ThrottleConfig> = {
  minDelayMs: -1000,
  maxDelayMs: -500,
  breakProbabilityPercent: 150,
};

// ============================================================================
// Import Results
// ============================================================================

/** Successful import result */
export const IMPORT_SUCCESS: ImportResult = {
  totalRows: 10,
  successCount: 10,
  failedCount: 0,
  insertedCount: 10,
  skippedCount: 0,
  existingCount: 0,
  blockedCount: 0,
  errors: [],
};

/** Partial import result */
export const IMPORT_PARTIAL: ImportResult = {
  totalRows: 10,
  successCount: 7,
  failedCount: 3,
  insertedCount: 5,
  skippedCount: 1,
  existingCount: 2,
  blockedCount: 1,
  errors: [
    { row: 3, error: 'Invalid email format' },
    { row: 6, error: 'Missing company name' },
    { row: 9, error: 'Email already exists' },
  ],
};

/** Failed import result */
export const IMPORT_FAILED: ImportResult = {
  totalRows: 5,
  successCount: 0,
  failedCount: 5,
  insertedCount: 0,
  skippedCount: 0,
  existingCount: 0,
  blockedCount: 0,
  errors: [
    { row: 2, error: 'Invalid email format' },
    { row: 3, error: 'Missing person name' },
    { row: 4, error: 'Invalid email format' },
    { row: 5, error: 'Missing company name' },
    { row: 6, error: 'Invalid email format' },
  ],
};

/** Empty import result */
export const IMPORT_EMPTY: ImportResult = {
  totalRows: 0,
  successCount: 0,
  failedCount: 0,
  insertedCount: 0,
  skippedCount: 0,
  existingCount: 0,
  blockedCount: 0,
  errors: [],
};

// ============================================================================
// Campaign Results
// ============================================================================

/** Successful campaign result */
export const CAMPAIGN_SUCCESS: CampaignResult = {
  totalContacts: 10,
  sentCount: 10,
  failedCount: 0,
  skippedCount: 0,
  details: Array.from({ length: 10 }, (_, i) => ({
    email: `success${i}@example.com`,
    status: 'sent' as const,
    reason: `MessageId: msg-${i}`,
  })),
};

/** Campaign with failures */
export const CAMPAIGN_WITH_FAILURES: CampaignResult = {
  totalContacts: 10,
  sentCount: 6,
  failedCount: 2,
  skippedCount: 2,
  details: [
    { email: 'sent1@example.com', status: 'sent', reason: 'MessageId: msg-1' },
    { email: 'sent2@example.com', status: 'sent', reason: 'MessageId: msg-2' },
    { email: 'sent3@example.com', status: 'sent', reason: 'MessageId: msg-3' },
    { email: 'sent4@example.com', status: 'sent', reason: 'MessageId: msg-4' },
    { email: 'sent5@example.com', status: 'sent', reason: 'MessageId: msg-5' },
    { email: 'sent6@example.com', status: 'sent', reason: 'MessageId: msg-6' },
    { email: 'failed1@example.com', status: 'failed', reason: 'SES API Error' },
    { email: 'failed2@example.com', status: 'failed', reason: 'Network timeout' },
    { email: 'skipped1@example.com', status: 'skipped', reason: 'Invalid email' },
    { email: 'skipped2@example.com', status: 'skipped', reason: 'High risk' },
  ],
};

/** Empty campaign result */
export const CAMPAIGN_EMPTY: CampaignResult = {
  totalContacts: 0,
  sentCount: 0,
  failedCount: 0,
  skippedCount: 0,
  details: [],
};

// ============================================================================
// Excel Data
// ============================================================================

/** Valid Excel row */
export const EXCEL_ROW_VALID = {
  'Company Name': 'Acme Corp',
  'Person Name': 'John Doe',
  Email: 'john@acme.com',
};

/** Excel row with missing company name */
export const EXCEL_ROW_MISSING_COMPANY = {
  'Company Name': '',
  'Person Name': 'Jane Doe',
  Email: 'jane@example.com',
};

/** Excel row with missing person name */
export const EXCEL_ROW_MISSING_PERSON = {
  'Company Name': 'Test Corp',
  'Person Name': '',
  Email: 'test@example.com',
};

/** Excel row with invalid email */
export const EXCEL_ROW_INVALID_EMAIL = {
  'Company Name': 'Test Corp',
  'Person Name': 'Test Person',
  Email: 'not-an-email',
};

/** Excel row with numeric values (testing type conversion) */
export const EXCEL_ROW_NUMERIC = {
  'Company Name': 12345,
  'Person Name': 67890,
  Email: 'numeric@example.com',
};

/** Excel row with null/undefined values */
export const EXCEL_ROW_NULL = {
  'Company Name': null,
  'Person Name': undefined,
  Email: 'null@example.com',
};

/** All Excel test rows */
export const EXCEL_ROWS_ALL = [
  EXCEL_ROW_VALID,
  EXCEL_ROW_MISSING_COMPANY,
  EXCEL_ROW_MISSING_PERSON,
  EXCEL_ROW_INVALID_EMAIL,
  EXCEL_ROW_NUMERIC,
];

// ============================================================================
// Template Data
// ============================================================================

/** Simple template without spintax */
export const TEMPLATE_SIMPLE = `# Welcome

Hi {Person Name},

Welcome to our service at {Company Name}.

Best regards,
The Team`;

/** Template with spintax */
export const TEMPLATE_WITH_SPINTAX = `{Hello|Hi|Hey} {Person Name},

{Thanks for joining|Welcome to|We're excited to have} {Company Name}!

{Best|Regards|Cheers},
The Team`;

/** Template with nested spintax */
export const TEMPLATE_NESTED_SPINTAX = `{Hello {there|friend}|Hi {buddy|pal}},

Welcome to {Company Name}!

Best regards,
The Team`;

/** Template without H1 heading */
export const TEMPLATE_NO_HEADING = `Subject Line

Hi {Person Name},

This email has no H1 heading.

Best regards`;

/** Template with only H1 */
export const TEMPLATE_ONLY_HEADING = `# Subject Only`;

/** Empty template */
export const TEMPLATE_EMPTY = '';

/** Template with only placeholders */
export const TEMPLATE_ONLY_PLACEHOLDERS = `{Person Name} {Company Name}`;

// ============================================================================
// Environment Variables
// ============================================================================

/** Complete valid environment configuration */
export const ENV_VALID = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'testuser',
  DB_PASS: 'testpass',
  DB_NAME: 'testdb',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  SES_FROM_EMAIL: 'sender@example.com',
  MYEMAILVERIFIER_API_KEY: 'test-api-key-12345',
  THROTTLE_MIN_DELAY_MS: '60000',
  THROTTLE_MAX_DELAY_MS: '120000',
  THROTTLE_BREAK_PROBABILITY_PERCENT: '5',
  THROTTLE_BREAK_MIN_MINUTES: '3',
  THROTTLE_BREAK_MAX_MINUTES: '5',
  SES_RATE_LIMIT_PER_SECOND: '14',
  SES_QUOTA_BUFFER_PERCENT: '10',
};

/** Environment with missing optional values */
export const ENV_MINIMAL = {
  DB_HOST: 'localhost',
  DB_USER: 'testuser',
  DB_PASS: 'testpass',
};

/** Empty environment */
export const ENV_EMPTY: Record<string, string> = {};

// ============================================================================
// Error Scenarios
// ============================================================================

/** Network error */
export const ERROR_NETWORK = new Error('Network request failed');

/** Timeout error */
export const ERROR_TIMEOUT = new Error('Request timeout after 30000ms');

/** Database error */
export const ERROR_DATABASE = new Error('Connection refused: postgres://localhost:5432');

/** AWS credentials error */
export const ERROR_AWS_CREDENTIALS = new Error('Invalid AWS credentials');

/** API key missing error */
export const ERROR_API_KEY_MISSING = new Error('MYEMAILVERIFIER_API_KEY is not configured');

/** File not found error */
export const ERROR_FILE_NOT_FOUND = new Error('File not found: /path/to/file.xlsx');

/** Permission denied error */
export const ERROR_PERMISSION_DENIED = new Error('EACCES: permission denied');

// ============================================================================
// Test Constants
// ============================================================================

/** Test timeout values */
export const TIMEOUTS = {
  SHORT: 100,
  MEDIUM: 1000,
  LONG: 5000,
  VERY_LONG: 30000,
};

/** Rate limit values */
export const RATE_LIMITS = {
  SES_SANDBOX: 14,
  SES_PRODUCTION: 100,
  CUSTOM: 25,
};

/** Buffer percentages */
export const BUFFER_PERCENTAGES = {
  NONE: 0,
  LOW: 5,
  DEFAULT: 10,
  HIGH: 20,
  MAXIMUM: 50,
};

/** Delay values in milliseconds */
export const DELAYS = {
  INSTANT: 0,
  VERY_SHORT: 10,
  SHORT: 100,
  MEDIUM: 1000,
  LONG: 60000,
  VERY_LONG: 120000,
};
