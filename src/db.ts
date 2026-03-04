/**
 * Database module for TermiSend
 * Handles PostgreSQL connection, schema initialization, and query execution
 *
 * Uses lazy initialization to avoid module-level side effects.
 * Database connection is only established when first used.
 */

import postgres from 'postgres';
import { getEnv } from './config.js';
import { logger } from './logger.js';
import type {
  AnalyticsEventType,
  AuditLog,
  Contact,
  EmailVerifierCredits,
  IdentityStatus,
  JSONValue,
  LogStatus,
  MessageEvent,
  QuotaSnapshot,
  SendLog,
  SendMode,
  SendStatistics,
  SendStats,
} from './types.js';
import { isProduction } from './utils/security.js';

// Fixed singleton ID for the email_verifier_credits table (singleton pattern)
const EMAIL_VERIFIER_CREDITS_SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================================
// Lazy PostgreSQL Client Setup
// ============================================================================

let sqlClient: ReturnType<typeof postgres> | null = null;

/**
 * Get database configuration from environment
 * Validates configuration lazily on first access
 */
function getDbConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const env = getEnv();

  // Merge with process.env
  const host = process.env.DB_HOST || env.DB_HOST;
  const port = Number.parseInt(process.env.DB_PORT || env.DB_PORT || '5432', 10);
  const user = process.env.DB_USER || env.DB_USER;
  const password = process.env.DB_PASS || env.DB_PASS;
  const database = process.env.DB_NAME || env.DB_NAME || 'termisend';

  // Validate required configuration lazily
  if (!host) {
    throw new Error('DB_HOST is required. Set it in environment variables or .env file.');
  }
  if (!user) {
    throw new Error('DB_USER is required. Set it in environment variables or .env file.');
  }
  if (!password) {
    throw new Error('DB_PASS is required. Set it in environment variables or .env file.');
  }

  return { host, port, user, password, database };
}

/**
 * Reset the SQL client (for testing purposes only)
 * @internal
 */
export function resetSqlClient(): void {
  sqlClient = null;
}

/**
 * Get or create the PostgreSQL client with lazy initialization
 * Connection is only established when this function is first called
 */
function getSqlClient(): ReturnType<typeof postgres> {
  if (!sqlClient) {
    const config = getDbConfig();

    // Use connection object format to properly handle special characters in credentials
    sqlClient = postgres({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // Suppress PostgreSQL NOTICE messages (e.g., "truncate cascades to table...")
      // These are internal implementation details that confuse users
      // biome-ignore lint/suspicious/noEmptyBlockStatements: Intentional empty handler to suppress notices
      onnotice: () => {},
      transform: {
        column: { to: postgres.fromCamel, from: postgres.toCamel },
      },
    });
  }
  return sqlClient;
}

/**
 * Exported SQL client with lazy initialization
 * Uses a wrapper function that delegates to the actual postgres client
 */
const sqlWrapper = (...args: unknown[]): unknown => {
  const client = getSqlClient();
  // Call the postgres client with the template literal arguments
  return (client as unknown as (...args: unknown[]) => unknown)(...args);
};

/**
 * SQL client with lazy initialization
 * Database connection is only established when first query is executed
 */
export const sql: ReturnType<typeof postgres> = new Proxy(
  sqlWrapper as unknown as ReturnType<typeof postgres>,
  {
    get(_target, prop: string | symbol) {
      const client = getSqlClient();
      // Handle string properties normally
      if (typeof prop === 'string') {
        return (client as unknown as Record<string, unknown>)[prop];
      }
      // Handle symbols (like Symbol.iterator, etc.)
      return (client as unknown as Record<symbol, unknown>)[prop];
    },
    apply(_target, _thisArg, args: unknown[]) {
      const client = getSqlClient();
      return (client as unknown as (...args: unknown[]) => unknown)(...args);
    },
  }
) as ReturnType<typeof postgres>;

// ============================================================================
// Schema Initialization
// ============================================================================

/**
 * Initialize database schema - creates tables if they don't exist
 */
export async function initializeSchema(): Promise<void> {
  try {
    // Create contacts table (identity only, no status)
    await sql`
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name VARCHAR(255) NOT NULL,
        person_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index on email for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)
    `;

    // Create campaigns table first (referenced by send_logs and analytics_events)
    await sql`
      CREATE TABLE IF NOT EXISTS campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        subject_template VARCHAR(500) NOT NULL,
        body_template TEXT NOT NULL,
        from_email VARCHAR(255) NOT NULL,
        from_name VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        scheduled_at TIMESTAMP WITH TIME ZONE,
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for campaigns
    await sql`
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at)
    `;

    // Create send_logs table for tracking email send attempts
    await sql`
      CREATE TABLE IF NOT EXISTS send_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        mode VARCHAR(50) NOT NULL DEFAULT 'production',
        subject VARCHAR(500) NOT NULL,
        body_preview VARCHAR(500) NOT NULL,
        error_reason TEXT,
        message_id VARCHAR(255),
        retry_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        first_opened_at TIMESTAMP WITH TIME ZONE,
        first_clicked_at TIMESTAMP WITH TIME ZONE,
        delivery_confirmed_at TIMESTAMP WITH TIME ZONE,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes on send_logs for efficient queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_logs_contact_id ON send_logs(contact_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_logs_created_at ON send_logs(created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_logs_campaign_id ON send_logs(campaign_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_logs_retry_count ON send_logs(retry_count)
    `;

    // Create audit_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index on event_type for faster queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type)
    `;

    // Create index on created_at for time-based queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)
    `;

    // Create email_verifier_credits table for tracking MyEmailVerifier credits
    await sql`
      CREATE TABLE IF NOT EXISTS email_verifier_credits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credits INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // ============================================================================
    // SES Analytics Tables
    // ============================================================================

    // Create ses_quota_snapshots table for periodic quota tracking
    await sql`
      CREATE TABLE IF NOT EXISTS ses_quota_snapshots (
        id SERIAL PRIMARY KEY,
        max_24_hour_send DOUBLE PRECISION NOT NULL,
        sent_last_24_hours DOUBLE PRECISION NOT NULL,
        max_send_rate DOUBLE PRECISION NOT NULL,
        recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL DEFAULT 'api'
      )
    `;

    // Create index on recorded_at for efficient time-based queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_quota_snapshots_recorded_at ON ses_quota_snapshots(recorded_at)
    `;

    // Create ses_send_statistics table for historical 15-minute data points
    await sql`
      CREATE TABLE IF NOT EXISTS ses_send_statistics (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL UNIQUE,
        delivery_attempts BIGINT NOT NULL DEFAULT 0,
        bounces BIGINT NOT NULL DEFAULT 0,
        complaints BIGINT NOT NULL DEFAULT 0,
        rejects BIGINT NOT NULL DEFAULT 0,
        fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index on timestamp for efficient queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_send_statistics_timestamp ON ses_send_statistics(timestamp)
    `;

    // Create ses_identity_status table for identity verification tracking
    await sql`
      CREATE TABLE IF NOT EXISTS ses_identity_status (
        id SERIAL PRIMARY KEY,
        identity TEXT NOT NULL UNIQUE,
        verification_status TEXT NOT NULL DEFAULT 'NotStarted',
        dkim_enabled BOOLEAN DEFAULT FALSE,
        dkim_verification_status TEXT,
        checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index on identity for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_identity_status_identity ON ses_identity_status(identity)
    `;

    // Create ses_message_events table for internal event tracking
    await sql`
      CREATE TABLE IF NOT EXISTS ses_message_events (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        message_id TEXT,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        send_log_id UUID REFERENCES send_logs(id) ON DELETE SET NULL,
        event_data JSONB DEFAULT '{}',
        occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // ============================================================================
    // SES Event Tracking Tables (SQS Consumer)
    // ============================================================================

    // Create ses_event_tracking table for detailed SES event log
    await sql`
      CREATE TABLE IF NOT EXISTS ses_event_tracking (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(50) NOT NULL,
        sns_message_id VARCHAR(100) NOT NULL UNIQUE,
        ses_message_id VARCHAR(255) NOT NULL,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        send_log_id UUID REFERENCES send_logs(id) ON DELETE SET NULL,
        recipient_email VARCHAR(255),
        source_email VARCHAR(255),
        event_data JSONB NOT NULL DEFAULT '{}',
        occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
        processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Indexes for ses_event_tracking
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_event_tracking_event_type ON ses_event_tracking(event_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_event_tracking_ses_message_id ON ses_event_tracking(ses_message_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_event_tracking_contact_id ON ses_event_tracking(contact_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_event_tracking_occurred_at ON ses_event_tracking(occurred_at)
    `;

    // Create contact_suppressions table for bounce/complaint tracking
    await sql`
      CREATE TABLE IF NOT EXISTS contact_suppressions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        suppression_type VARCHAR(50) NOT NULL,
        suppression_reason VARCHAR(255) NOT NULL,
        ses_message_id VARCHAR(255),
        original_event_data JSONB DEFAULT '{}',
        suppressed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(contact_id, suppression_type)
      )
    `;

    // Indexes for contact_suppressions
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contact_suppressions_contact_id ON contact_suppressions(contact_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contact_suppressions_type ON contact_suppressions(suppression_type)
    `;

    // Create indexes on message_events for common query patterns
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_message_events_event_type ON ses_message_events(event_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_message_events_contact_id ON ses_message_events(contact_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_message_events_occurred_at ON ses_message_events(occurred_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_message_events_message_id ON ses_message_events(message_id)
    `;

    // ============================================================================
    // Analytics Tables (Event Tracking and Metrics)
    // ============================================================================

    // Create analytics_events table (general event store)
    await sql`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(100) NOT NULL,
        event_id VARCHAR(100) NOT NULL UNIQUE,
        correlation_id VARCHAR(100),
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        send_log_id UUID REFERENCES send_logs(id) ON DELETE SET NULL,
        campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for analytics_events
    await sql`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events(event_type)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_contact_id ON analytics_events(contact_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at ON analytics_events(occurred_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_correlation_id ON analytics_events(correlation_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_campaign_id ON analytics_events(campaign_id)
    `;

    // Create verification_metrics table
    await sql`
      CREATE TABLE IF NOT EXISTS verification_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        total_verified INTEGER NOT NULL DEFAULT 0,
        valid_emails INTEGER NOT NULL DEFAULT 0,
        invalid_emails INTEGER NOT NULL DEFAULT 0,
        unknown_emails INTEGER NOT NULL DEFAULT 0,
        average_response_time_ms DECIMAL(10,2),
        api_calls INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_verification_metrics_date ON verification_metrics(date)
    `;

    // Create send_outcome_metrics table
    await sql`
      CREATE TABLE IF NOT EXISTS send_outcome_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
        total_requested INTEGER NOT NULL DEFAULT 0,
        successfully_sent INTEGER NOT NULL DEFAULT 0,
        failed_sends INTEGER NOT NULL DEFAULT 0,
        skipped_sends INTEGER NOT NULL DEFAULT 0,
        average_send_time_ms DECIMAL(10,2),
        ses_api_calls INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, campaign_id)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_outcome_metrics_date ON send_outcome_metrics(date)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_send_outcome_metrics_campaign_id ON send_outcome_metrics(campaign_id)
    `;

    // Create ses_api_metrics table
    await sql`
      CREATE TABLE IF NOT EXISTS ses_api_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        api_endpoint VARCHAR(50) NOT NULL,
        total_calls INTEGER NOT NULL DEFAULT 0,
        successful_calls INTEGER NOT NULL DEFAULT 0,
        failed_calls INTEGER NOT NULL DEFAULT 0,
        average_response_time_ms DECIMAL(10,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, api_endpoint)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_api_metrics_date ON ses_api_metrics(date)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ses_api_metrics_endpoint ON ses_api_metrics(api_endpoint)
    `;

    // Create throttling_metrics table
    await sql`
      CREATE TABLE IF NOT EXISTS throttling_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        total_delays INTEGER NOT NULL DEFAULT 0,
        total_delay_time_ms BIGINT NOT NULL DEFAULT 0,
        average_delay_ms DECIMAL(10,2) DEFAULT 0,
        quota_checks_passed INTEGER NOT NULL DEFAULT 0,
        quota_checks_failed INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_throttling_metrics_date ON throttling_metrics(date)
    `;

    // Success message for CLI usage
    if (require.main === module || process.argv[1]?.includes('db.ts')) {
      const dbConfig = getDbConfig();
      logger.info('✅ Database initialized successfully!');
      logger.info(`   Database: ${dbConfig.database}`);
      logger.info(
        '   Tables: contacts, send_logs, audit_logs, email_verifier_credits, ses_quota_snapshots, ses_send_statistics, ses_identity_status, ses_message_events, analytics_events, verification_metrics, send_outcome_metrics, ses_api_metrics, throttling_metrics'
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to initialize database schema: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// Contact Operations
// ============================================================================

/**
 * Insert a new contact into the database
 */
export async function insertContact(
  companyName: string,
  personName: string,
  email: string
): Promise<Contact> {
  const [contact] = await sql<Contact[]>`
    INSERT INTO contacts (company_name, person_name, email)
    VALUES (${companyName}, ${personName}, ${email})
    ON CONFLICT (email) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      person_name = EXCLUDED.person_name
    RETURNING *
  `;
  return contact;
}

/**
 * Insert a new contact into the database, skipping if email already exists
 * @returns The inserted contact if successful, null if skipped due to duplicate
 */
export async function insertContactSkipDuplicate(
  companyName: string,
  personName: string,
  email: string
): Promise<Contact | null> {
  const result = await sql<Contact[]>`
    INSERT INTO contacts (company_name, person_name, email)
    VALUES (${companyName}, ${personName}, ${email})
    ON CONFLICT (email) DO NOTHING
    RETURNING *
  `;
  return result.length > 0 ? result[0] : null;
}

/**
 * Get all contacts
 */
export async function getContacts(): Promise<Contact[]> {
  return await sql<Contact[]>`
    SELECT * FROM contacts
    ORDER BY created_at DESC
  `;
}

/**
 * Get contacts that are eligible for sending
 * A contact is eligible if:
 * 1. It has no successful 'sent' log entry for the specified campaign (or any if campaignId is null)
 * 2. It has no 'CONTACT_INVALID' or 'CONTACT_DEEMED_UNSAFE' events in analytics
 * 3. It has no failed log entry with retry_count >= 2 (max retries reached)
 * 4. Failed entries with retry_count < 2 ARE eligible for retry
 *
 * @param campaignId - Optional campaign ID to filter by
 * @param limit - Maximum number of contacts to return (default: 1000)
 * @returns Array of eligible contacts
 */
export async function getEligibleContacts(
  campaignId: string | null = null,
  limit: number = 1000
): Promise<Contact[]> {
  return await sql<Contact[]>`
    SELECT c.* FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM analytics_events ae
      WHERE ae.contact_id = c.id
      AND ae.event_type IN ('CONTACT_INVALID', 'CONTACT_DEEMED_UNSAFE')
    )
    AND NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'sent'
      AND (${campaignId}::UUID IS NULL OR sl.campaign_id = ${campaignId}::UUID)
    )
    AND NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'failed'
      AND sl.retry_count >= 2
      AND (${campaignId}::UUID IS NULL OR sl.campaign_id = ${campaignId}::UUID)
    )
    ORDER BY c.created_at ASC
    LIMIT ${limit}
  `;
}

/**
 * Get count of eligible contacts for sending
 * A contact is eligible if:
 * 1. It has no successful 'sent' log entry for the specified campaign
 * 2. It has no 'CONTACT_INVALID' or 'CONTACT_DEEMED_UNSAFE' events in analytics
 * 3. It has no failed log entry with retry_count >= 2 (max retries reached)
 * @param campaignId - Optional campaign ID to filter by
 */
export async function getEligibleContactCount(campaignId: string | null = null): Promise<number> {
  const [result] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM analytics_events ae
      WHERE ae.contact_id = c.id
      AND ae.event_type IN ('CONTACT_INVALID', 'CONTACT_DEEMED_UNSAFE')
    )
    AND NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'sent'
      AND (${campaignId}::UUID IS NULL OR sl.campaign_id = ${campaignId}::UUID)
    )
    AND NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'failed'
      AND sl.retry_count >= 2
      AND (${campaignId}::UUID IS NULL OR sl.campaign_id = ${campaignId}::UUID)
    )
  `;
  return Number.parseInt(result.count || '0', 10);
}

/**
 * Check if contact exists by email
 */
export async function contactExists(email: string): Promise<boolean> {
  const [result] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM contacts WHERE email = ${email})
  `;
  return result?.exists ?? false;
}

// ============================================================================
// Send Log Operations
// ============================================================================

/**
 * Create a new send log entry with pending status
 */
export async function createSendLog(
  contactId: string,
  mode: SendMode,
  subject: string,
  bodyPreview: string,
  campaignId?: string,
  retryCount: number = 0
): Promise<SendLog> {
  const [log] = await sql<SendLog[]>`
    INSERT INTO send_logs (contact_id, campaign_id, status, mode, subject, body_preview, retry_count)
    VALUES (${contactId}, ${campaignId ?? null}, 'pending', ${mode}, ${subject}, ${bodyPreview}, ${retryCount})
    RETURNING *
  `;
  return log;
}

/**
 * Update a send log entry with result information
 */
export async function updateSendLog(
  logId: string,
  updates: {
    status: LogStatus;
    messageId?: string;
    errorReason?: string;
    sentAt?: Date;
    retryCount?: number;
  }
): Promise<SendLog> {
  const [log] = await sql<SendLog[]>`
    UPDATE send_logs
    SET 
      status = ${updates.status},
      message_id = ${updates.messageId ?? null},
      error_reason = ${updates.errorReason ?? null},
      sent_at = ${updates.sentAt ?? null},
      retry_count = ${updates.retryCount ?? null}
    WHERE id = ${logId}
    RETURNING *
  `;
  return log;
}

/**
 * Increment the retry count for a send log
 * Used when retrying a failed send attempt
 * @param logId - The send log ID to update
 * @returns The updated send log
 */
export async function incrementRetryCount(logId: string): Promise<SendLog> {
  const [log] = await sql<SendLog[]>`
    UPDATE send_logs
    SET retry_count = COALESCE(retry_count, 0) + 1
    WHERE id = ${logId}
    RETURNING *
  `;
  return log;
}

/**
 * Get send logs for a specific contact
 */
export async function getContactSendLogs(contactId: string): Promise<SendLog[]> {
  return await sql<SendLog[]>`
    SELECT * FROM send_logs
    WHERE contact_id = ${contactId}
    ORDER BY created_at DESC
  `;
}

/**
 * Get pending send logs (for recovery/resume scenarios)
 */
export async function getPendingSendLogs(mode?: SendMode): Promise<SendLog[]> {
  if (mode) {
    return await sql<SendLog[]>`
      SELECT * FROM send_logs
      WHERE status = 'pending'
      AND mode = ${mode}
      ORDER BY created_at ASC
    `;
  }
  return await sql<SendLog[]>`
    SELECT * FROM send_logs
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `;
}

/**
 * Get aggregate send statistics for UI display
 */
export async function getSendStats(): Promise<SendStats> {
  const [totalResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count FROM contacts
  `;

  const [eligibleResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'sent'
    )
  `;

  const [pendingResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM send_logs
    WHERE status = 'pending'
  `;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [sent24hResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM send_logs
    WHERE status = 'sent'
    AND sent_at >= ${twentyFourHoursAgo}
  `;

  const [failed24hResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM send_logs
    WHERE status = 'failed'
    AND created_at >= ${twentyFourHoursAgo}
  `;

  return {
    totalContacts: totalResult?.count ?? 0,
    eligibleForSending: eligibleResult?.count ?? 0,
    pendingSends: pendingResult?.count ?? 0,
    sentLast24Hours: sent24hResult?.count ?? 0,
    failedLast24Hours: failed24hResult?.count ?? 0,
  };
}

/**
 * Get analytics counts for real-time dashboard
 * Returns aggregate counts for contacts by status
n */
export async function getAnalyticsCounts(): Promise<{
  total: number;
  pending: number;
  verified: number;
  sent: number;
  failed: number;
  invalid: number;
}> {
  const result = await sql<
    {
      total: number;
      pending: number;
      verified: number;
      sent: number;
      failed: number;
      invalid: number;
    }[]
  >`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid
    FROM contacts
  `;
  return {
    total: Number(result[0]?.total ?? 0),
    pending: Number(result[0]?.pending ?? 0),
    verified: Number(result[0]?.verified ?? 0),
    sent: Number(result[0]?.sent ?? 0),
    failed: Number(result[0]?.failed ?? 0),
    invalid: Number(result[0]?.invalid ?? 0),
  };
}

// ============================================================================
// Audit Log Operations
// ============================================================================

/**
 * Serialize payload to JSON-compatible format
 * Handles Date objects and ensures JSON compatibility
 */
function serializePayload(payload: Record<string, unknown>): JSONValue {
  // JSON.parse always returns a JSON-compatible value
  return JSON.parse(JSON.stringify(payload)) as JSONValue;
}

/**
 * Insert an audit log entry
 */
export async function insertAuditLog(
  eventType: string,
  payload: Record<string, unknown>
): Promise<AuditLog> {
  const jsonPayload = serializePayload(payload);
  const [log] = await sql<AuditLog[]>`
    INSERT INTO audit_logs (event_type, payload)
    VALUES (${eventType}, ${sql.json(jsonPayload)})
    RETURNING *
  `;
  return log;
}

/**
 * Get audit logs with optional event type filter
 */
export async function getAuditLogs(eventType?: string, limit: number = 100): Promise<AuditLog[]> {
  if (eventType) {
    return await sql<AuditLog[]>`
      SELECT * FROM audit_logs
      WHERE event_type = ${eventType}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  return await sql<AuditLog[]>`
    SELECT * FROM audit_logs
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

// ============================================================================
// Email Verifier Credits Operations
// ============================================================================

/**
 * Get the current MyEmailVerifier credits
 * Returns the most recent credits record, or null if none exists
 */
export async function getEmailVerifierCredits(): Promise<EmailVerifierCredits | null> {
  const [credits] = await sql<EmailVerifierCredits[]>`
    SELECT * FROM email_verifier_credits
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return credits || null;
}

/**
 * Update MyEmailVerifier credits in the database
 * Uses atomic UPSERT pattern with singleton row (fixed ID) to prevent race conditions
 */
export async function updateEmailVerifierCredits(credits: number): Promise<EmailVerifierCredits> {
  // Validate input: credits must be a non-negative integer
  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error(`Invalid credits value: ${credits}. Credits must be a non-negative integer.`);
  }

  // Use fixed singleton ID for the credits record
  const SingletonId = EMAIL_VERIFIER_CREDITS_SINGLETON_ID;

  // Atomic UPSERT: INSERT ... ON CONFLICT ... DO UPDATE
  const [result] = await sql<EmailVerifierCredits[]>`
    INSERT INTO email_verifier_credits (id, credits, updated_at)
    VALUES (${SingletonId}, ${credits}, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE
    SET credits = ${credits}, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  return result;
}

// ============================================================================
// Database Reset (Development Only)
// ============================================================================

/**
 * Validate that reset can proceed safely
 * @throws Error if any guardrail check fails
 */
function validateResetGuardrails(): {
  isAllowed: boolean;
  reason?: string;
} {
  // Guardrail 1: Check NODE_ENV
  if (isProduction()) {
    return {
      isAllowed: false,
      reason: 'Cannot reset database in production environment. NODE_ENV=production detected.',
    };
  }

  // Guardrail 2: Check database name for production indicators
  const env = getEnv();
  const dbName = (process.env.DB_NAME || env.DB_NAME || 'termisend').toLowerCase();
  const productionPatterns = [
    '_prod',
    'prod_',
    '-prod',
    '_production',
    'production_',
    '-production',
  ];
  const isProductionDbName =
    dbName === 'production' ||
    dbName === 'prod' ||
    productionPatterns.some((pattern) => dbName.endsWith(pattern));
  if (isProductionDbName) {
    return {
      isAllowed: false,
      reason: `Cannot reset database with name '${dbName}'. Detected production database name.`,
    };
  }

  return { isAllowed: true };
}

/**
 * Check if reset confirmation is provided
 * Either via --confirm-reset CLI flag or ALLOW_DEV_RESET env var
 */
function hasResetConfirmation(): boolean {
  // Check CLI flag (process.argv)
  const hasCliFlag = process.argv.includes('--confirm-reset') || process.argv.includes('-y');

  // Check environment variable
  const hasEnvVar = process.env.ALLOW_DEV_RESET === 'true';

  return hasCliFlag || hasEnvVar;
}

/**
 * Reset database to fresh state (DELETE ALL DATA)
 * ONLY works in development environment with explicit confirmation
 *
 * @returns Result object with success status and message
 * @throws Error if in production or confirmation not provided
 *
 * @example
 * // Usage: bun run db:reset --confirm-reset
 * // Or: ALLOW_DEV_RESET=true bun run db:reset
 */
export async function resetDatabase(): Promise<{ success: boolean; message: string }> {
  // Guardrail 1 & 2: Environment and DB name validation
  const guardrailCheck = validateResetGuardrails();
  if (!guardrailCheck.isAllowed) {
    throw new Error(guardrailCheck.reason);
  }

  // Guardrail 3: Explicit confirmation required
  if (!hasResetConfirmation()) {
    throw new Error(
      'Confirmation required. Use --confirm-reset flag or set ALLOW_DEV_RESET=true environment variable.\n' +
        'Example: bun run db:reset --confirm-reset\n' +
        '   Or: ALLOW_DEV_RESET=true bun run db:reset'
    );
  }

  // Guardrail 4: Log warning
  const env = getEnv();
  const dbName = process.env.DB_NAME || env.DB_NAME || 'termisend';
  console.warn('⚠️  WARNING: Database reset will DELETE ALL DATA!');
  console.warn(`⚠️  Database: ${dbName}`);
  console.warn(`⚠️  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.warn('⚠️  This action cannot be undone!\n');

  try {
    // List of all tables that should be reset
    // IMPORTANT: When new tables are added to the database schema, they must be
    // added to this list to ensure complete database resets.
    const expectedTables = [
      'contacts',
      'send_logs',
      'audit_logs',
      'email_verifier_credits',
      'ses_quota_snapshots',
      'ses_send_statistics',
      'ses_identity_status',
      'ses_message_events',
      'ses_event_tracking',
      'contact_suppressions',
      'analytics_events',
      'verification_metrics',
      'send_outcome_metrics',
      'ses_api_metrics',
      'throttling_metrics',
    ];

    // Query which tables actually exist in the database
    const existingTables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ${sql(expectedTables)}
    `;

    const existingTableNames = existingTables
      .map((t) => t.table_name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);

    if (existingTableNames.length === 0) {
      // No tables exist yet - schema needs to be initialized
      return {
        success: true,
        message: `Database '${dbName}' has no tables to reset. Run initializeSchema() first if needed.`,
      };
    }

    // Execute truncate with CASCADE to handle any foreign key references
    // RESTART IDENTITY resets auto-increment sequences
    // Only truncate tables that actually exist
    // Properly quote table names to handle reserved keywords and special characters
    const quotedTables = existingTableNames.map((name) => `"${name}"`).join(', ');
    await sql.unsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);

    return {
      success: true,
      message: `Database '${dbName}' reset successfully. ${existingTableNames.length} table(s) cleared: ${existingTableNames.join(', ')}`,
    };
  } catch (error) {
    throw new Error(
      `Database reset failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Close database connection
 * Call this during application shutdown for proper cleanup
 */
export async function closeConnection(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end();
    sqlClient = null;
  }
}

/**
 * Alias for closeConnection for consistent naming with closeSesClient
 * Call this during application shutdown for proper cleanup
 */
export const closeDatabase = closeConnection;

// ============================================================================
// SES Analytics Database Operations
// ============================================================================

/**
 * Create a new quota snapshot record
 * Tracks periodic measurements of SES sending limits
 * @param quota - Quota snapshot data from GetSendQuota API
 * @returns The created snapshot record
 */
export async function createQuotaSnapshot(quota: QuotaSnapshot): Promise<{
  id: number;
  max24HourSend: number;
  sentLast24Hours: number;
  maxSendRate: number;
  recordedAt: Date;
  source: string;
}> {
  const [record] = await sql<
    {
      id: number;
      max24HourSend: number;
      sentLast24Hours: number;
      maxSendRate: number;
      recordedAt: Date;
      source: string;
    }[]
  >`
    INSERT INTO ses_quota_snapshots (max_24_hour_send, sent_last_24_hours, max_send_rate, source)
    VALUES (${quota.max24HourSend}, ${quota.sentLast24Hours}, ${quota.maxSendRate}, ${quota.source})
    RETURNING id, max_24_hour_send as "max24HourSend", sent_last_24_hours as "sentLast24Hours", 
             max_send_rate as "maxSendRate", recorded_at as "recordedAt", source
  `;
  return record;
}

/**
 * Get the most recent quota snapshot
 * @returns The latest quota snapshot or null if none exists
 */
export async function getLatestQuotaSnapshot(): Promise<{
  id: number;
  max24HourSend: number;
  sentLast24Hours: number;
  maxSendRate: number;
  recordedAt: Date;
  source: string;
} | null> {
  const [record] = await sql<
    {
      id: number;
      max24HourSend: number;
      sentLast24Hours: number;
      maxSendRate: number;
      recordedAt: Date;
      source: string;
    }[]
  >`
    SELECT id, max_24_hour_send as "max24HourSend", sent_last_24_hours as "sentLast24Hours",
           max_send_rate as "maxSendRate", recorded_at as "recordedAt", source
    FROM ses_quota_snapshots
    ORDER BY recorded_at DESC
    LIMIT 1
  `;
  return record || null;
}

/**
 * Create send statistics records
 * Stores historical 15-minute data points from GetSendStatistics API
 * Uses INSERT ... ON CONFLICT to prevent duplicates
 * @param stats - Array of send statistics data points
 * @returns Number of records inserted
 */
export async function createSendStatistics(stats: SendStatistics[]): Promise<number> {
  let inserted = 0;
  for (const stat of stats) {
    const result = await sql<{ id: number }[]>`
      INSERT INTO ses_send_statistics (timestamp, delivery_attempts, bounces, complaints, rejects)
      VALUES (${stat.timestamp}, ${stat.deliveryAttempts}, ${stat.bounces}, ${stat.complaints}, ${stat.rejects})
      ON CONFLICT (timestamp) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * Get send statistics for a date range
 * @param startDate - Start of date range (inclusive)
 * @param endDate - End of date range (inclusive)
 * @returns Array of send statistics data points
 */
export async function getSendStatistics(
  startDate: Date,
  endDate: Date
): Promise<
  {
    id: number;
    timestamp: Date;
    deliveryAttempts: number;
    bounces: number;
    complaints: number;
    rejects: number;
    fetchedAt: Date;
  }[]
> {
  return await sql<
    {
      id: number;
      timestamp: Date;
      deliveryAttempts: number;
      bounces: number;
      complaints: number;
      rejects: number;
      fetchedAt: Date;
    }[]
  >`
    SELECT id, timestamp, delivery_attempts as "deliveryAttempts", bounces, complaints, rejects,
           fetched_at as "fetchedAt"
    FROM ses_send_statistics
    WHERE timestamp >= ${startDate} AND timestamp <= ${endDate}
    ORDER BY timestamp DESC
  `;
}

/**
 * Upsert identity status records
 * Uses atomic UPSERT to handle concurrent updates
 * @param identities - Array of identity status records
 */
export async function upsertIdentityStatus(identities: IdentityStatus[]): Promise<void> {
  for (const identity of identities) {
    await sql`
      INSERT INTO ses_identity_status (identity, verification_status, dkim_enabled, dkim_verification_status, checked_at)
      VALUES (${identity.identity}, ${identity.verificationStatus}, ${identity.dkimEnabled}, 
              ${identity.dkimVerificationStatus}, ${identity.checkedAt})
      ON CONFLICT (identity) DO UPDATE
      SET verification_status = EXCLUDED.verification_status,
          dkim_enabled = EXCLUDED.dkim_enabled,
          dkim_verification_status = EXCLUDED.dkim_verification_status,
          checked_at = EXCLUDED.checked_at
    `;
  }
}

/**
 * Get all identity statuses
 * @returns Array of all tracked identities
 */
export async function getIdentityStatuses(): Promise<
  {
    id: number;
    identity: string;
    verificationStatus: string;
    dkimEnabled: boolean;
    dkimVerificationStatus: string | null;
    checkedAt: Date;
  }[]
> {
  return await sql<
    {
      id: number;
      identity: string;
      verificationStatus: string;
      dkimEnabled: boolean;
      dkimVerificationStatus: string | null;
      checkedAt: Date;
    }[]
  >`
    SELECT id, identity, verification_status as "verificationStatus", dkim_enabled as "dkimEnabled",
           dkim_verification_status as "dkimVerificationStatus", checked_at as "checkedAt"
    FROM ses_identity_status
    ORDER BY identity
  `;
}

/**
 * Convert event data to JSONValue for postgres.js
 * Handles type conversion safely
 */
function serializeEventData(data: Record<string, unknown>): JSONValue {
  return JSON.parse(JSON.stringify(data)) as JSONValue;
}

/**
 * Create a message event record
 * Tracks email lifecycle events internally
 * @param event - Message event data
 * @returns The created event record
 */
export async function createMessageEvent(event: MessageEvent): Promise<{
  id: number;
  eventType: string;
  messageId: string | null;
  contactId: string | null;
  sendLogId: string | null;
  eventData: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
}> {
  const serializedData = serializeEventData(event.eventData);
  const [record] = await sql<
    {
      id: number;
      eventType: string;
      messageId: string | null;
      contactId: string | null;
      sendLogId: string | null;
      eventData: Record<string, unknown>;
      occurredAt: Date;
      createdAt: Date;
    }[]
  >`
    INSERT INTO ses_message_events (event_type, message_id, contact_id, send_log_id, event_data, occurred_at)
    VALUES (${event.eventType}, ${event.messageId ?? null}, ${event.contactId}, ${event.sendLogId}, 
            ${sql.json(serializedData)}, ${event.occurredAt})
    RETURNING id, event_type as "eventType", message_id as "messageId", 
              contact_id as "contactId", send_log_id as "sendLogId", 
              event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
  `;
  return record;
}

/**
 * Options for fetching message events
 */
export interface GetMessageEventsOptions {
  eventType?: AnalyticsEventType;
  contactId?: string;
  messageId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

/**
 * Get message events with optional filtering
 * Uses separate queries for each filter combination to maintain type safety with postgres.js
 * @param options - Filter options
 * @returns Array of matching message events
 */
export async function getMessageEvents(options: GetMessageEventsOptions = {}): Promise<
  {
    id: number;
    eventType: string;
    messageId: string | null;
    contactId: string | null;
    sendLogId: string | null;
    eventData: Record<string, unknown>;
    occurredAt: Date;
    createdAt: Date;
  }[]
> {
  const { eventType, contactId, messageId, startDate, endDate, limit = 100 } = options;

  // Query by event type
  if (eventType && !contactId && !messageId && !startDate && !endDate) {
    return await sql<
      {
        id: number;
        eventType: string;
        messageId: string | null;
        contactId: string | null;
        sendLogId: string | null;
        eventData: Record<string, unknown>;
        occurredAt: Date;
        createdAt: Date;
      }[]
    >`
      SELECT id, event_type as "eventType", message_id as "messageId", 
             contact_id as "contactId", send_log_id as "sendLogId", 
             event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
      FROM ses_message_events
      WHERE event_type = ${eventType}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
  }

  // Query by contact ID
  if (contactId && !eventType && !messageId && !startDate && !endDate) {
    return await sql<
      {
        id: number;
        eventType: string;
        messageId: string | null;
        contactId: string | null;
        sendLogId: string | null;
        eventData: Record<string, unknown>;
        occurredAt: Date;
        createdAt: Date;
      }[]
    >`
      SELECT id, event_type as "eventType", message_id as "messageId", 
             contact_id as "contactId", send_log_id as "sendLogId", 
             event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
      FROM ses_message_events
      WHERE contact_id = ${contactId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
  }

  // Query by message ID
  if (messageId && !eventType && !contactId && !startDate && !endDate) {
    return await sql<
      {
        id: number;
        eventType: string;
        messageId: string | null;
        contactId: string | null;
        sendLogId: string | null;
        eventData: Record<string, unknown>;
        occurredAt: Date;
        createdAt: Date;
      }[]
    >`
      SELECT id, event_type as "eventType", message_id as "messageId", 
             contact_id as "contactId", send_log_id as "sendLogId", 
             event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
      FROM ses_message_events
      WHERE message_id = ${messageId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
  }

  // Query by date range
  if (startDate && endDate && !eventType && !contactId && !messageId) {
    return await sql<
      {
        id: number;
        eventType: string;
        messageId: string | null;
        contactId: string | null;
        sendLogId: string | null;
        eventData: Record<string, unknown>;
        occurredAt: Date;
        createdAt: Date;
      }[]
    >`
      SELECT id, event_type as "eventType", message_id as "messageId", 
             contact_id as "contactId", send_log_id as "sendLogId", 
             event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
      FROM ses_message_events
      WHERE occurred_at >= ${startDate} AND occurred_at <= ${endDate}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
  }

  // Query by event type and contact ID
  if (eventType && contactId && !messageId && !startDate && !endDate) {
    return await sql<
      {
        id: number;
        eventType: string;
        messageId: string | null;
        contactId: string | null;
        sendLogId: string | null;
        eventData: Record<string, unknown>;
        occurredAt: Date;
        createdAt: Date;
      }[]
    >`
      SELECT id, event_type as "eventType", message_id as "messageId", 
             contact_id as "contactId", send_log_id as "sendLogId", 
             event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
      FROM ses_message_events
      WHERE event_type = ${eventType} AND contact_id = ${contactId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `;
  }

  // Default: return most recent events
  return await sql<
    {
      id: number;
      eventType: string;
      messageId: string | null;
      contactId: string | null;
      sendLogId: string | null;
      eventData: Record<string, unknown>;
      occurredAt: Date;
      createdAt: Date;
    }[]
  >`
    SELECT id, event_type as "eventType", message_id as "messageId", 
           contact_id as "contactId", send_log_id as "sendLogId", 
           event_data as "eventData", occurred_at as "occurredAt", created_at as "createdAt"
    FROM ses_message_events
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `;
}

// ============================================================================
// Standalone initialization (for CLI usage)
// ============================================================================

// ============================================================================
// SES Event Tracking Functions (SQS Consumer)
// ============================================================================

/**
 * Create SES event tracking record
 * Logs all incoming SES events for audit trail
 * @param eventData - Event tracking data
 */
export async function createSESEventTracking(eventData: {
  eventType: string;
  snsMessageId: string;
  sesMessageId: string;
  contactId?: string;
  sendLogId?: string;
  recipientEmail?: string;
  sourceEmail?: string;
  eventData: Record<string, unknown>;
  occurredAt: Date;
}): Promise<void> {
  try {
    const serializedData = serializeEventData(eventData.eventData);
    await sql`
      INSERT INTO ses_event_tracking (
        event_type, sns_message_id, ses_message_id, contact_id, send_log_id,
        recipient_email, source_email, event_data, occurred_at
      ) 
      SELECT 
        ${eventData.eventType}, ${eventData.snsMessageId}, ${eventData.sesMessageId},
        ${eventData.contactId ?? null}, ${eventData.sendLogId ?? null},
        ${eventData.recipientEmail ?? null}, ${eventData.sourceEmail ?? null},
        ${sql.json(serializedData)}, ${eventData.occurredAt}
      WHERE NOT EXISTS (
        SELECT 1 FROM ses_event_tracking WHERE sns_message_id = ${eventData.snsMessageId}
      )
    `;
  } catch (error) {
    logger.warn(
      `Failed to create SES event tracking: ${error instanceof Error ? error.message : String(error)}`
    );
    // Don't throw - event tracking failures should not block processing
  }
}

/**
 * Create contact suppression record
 * Prevents future sends to suppressed contacts
 * @param suppressionData - Suppression details
 */
export async function createContactSuppression(suppressionData: {
  contactId: string;
  suppressionType: 'bounce' | 'complaint' | 'manual';
  suppressionReason: string;
  sesMessageId?: string;
  originalEventData?: Record<string, unknown>;
}): Promise<void> {
  try {
    const serializedData = suppressionData.originalEventData
      ? serializeEventData(suppressionData.originalEventData)
      : {};
    await sql`
      INSERT INTO contact_suppressions (
        contact_id, suppression_type, suppression_reason, ses_message_id, original_event_data
      ) VALUES (
        ${suppressionData.contactId}, ${suppressionData.suppressionType},
        ${suppressionData.suppressionReason}, ${suppressionData.sesMessageId ?? null},
        ${sql.json(serializedData)}
      )
      ON CONFLICT (contact_id, suppression_type) DO NOTHING
    `;
  } catch (error) {
    logger.warn(
      `Failed to create contact suppression: ${error instanceof Error ? error.message : String(error)}`
    );
    // Don't throw - suppression failures should not block processing
  }
}

/**
 * Check if a contact is suppressed
 * @param contactId - Contact ID to check
 * @returns Suppression record or null if not suppressed
 */
export async function getContactSuppression(contactId: string): Promise<{
  id: string;
  suppressionType: string;
  suppressionReason: string;
  suppressedAt: Date;
} | null> {
  const [record] = await sql<
    {
      id: string;
      suppressionType: string;
      suppressionReason: string;
      suppressedAt: Date;
    }[]
  >`
    SELECT id, suppression_type as "suppressionType", suppression_reason as "suppressionReason",
           suppressed_at as "suppressedAt"
    FROM contact_suppressions
    WHERE contact_id = ${contactId}
    LIMIT 1
  `;
  return record || null;
}

/**
 * Check if a contact is suppressed (alias for getContactSuppression)
 * @param contactId - Contact ID to check
 * @returns Boolean indicating if contact is suppressed
 */
export async function isContactSuppressed(contactId: string): Promise<boolean> {
  const suppression = await getContactSuppression(contactId);
  return suppression !== null;
}

/**
 * Find send log by SES message ID
 * @param messageId - SES message ID
 * @returns Send log record or null
 */
export async function getSendLogByMessageId(messageId: string): Promise<{
  id: string;
  contactId: string;
  status: string;
  messageId: string;
} | null> {
  const [record] = await sql<
    {
      id: string;
      contactId: string;
      status: string;
      messageId: string;
    }[]
  >`
    SELECT id, contact_id as "contactId", status, message_id as "messageId"
    FROM send_logs
    WHERE message_id = ${messageId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return record || null;
}

/**
 * Update send log status with SES event tracking
 * @param sendLogId - Send log ID
 * @param status - New status
 * @param eventData - Additional event data to store
 */
export async function updateSendLogStatus(
  sendLogId: string,
  status: 'delivered' | 'bounced' | 'complained',
  _eventData: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      UPDATE send_logs
      SET status = ${status}
      WHERE id = ${sendLogId}
    `;
  } catch (error) {
    logger.warn(
      `Failed to update send log status: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * Update send log with delivery confirmation
 * @param sendLogId - Send log ID
 * @param confirmedAt - Confirmation timestamp
 */
export async function confirmSendLogDelivery(sendLogId: string, confirmedAt: Date): Promise<void> {
  try {
    await sql`
      UPDATE send_logs
      SET status = 'delivered',
          delivery_confirmed_at = ${confirmedAt}
      WHERE id = ${sendLogId}
    `;
  } catch (error) {
    logger.warn(
      `Failed to confirm send log delivery: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * Increment send log open count
 * @param sendLogId - Send log ID
 * @param firstOpenAt - Timestamp of first open
 */
export async function incrementSendLogOpens(sendLogId: string, firstOpenAt: Date): Promise<void> {
  try {
    await sql`
      UPDATE send_logs
      SET open_count = COALESCE(open_count, 0) + 1,
          first_opened_at = COALESCE(first_opened_at, ${firstOpenAt})
      WHERE id = ${sendLogId}
    `;
  } catch (error) {
    logger.warn(
      `Failed to increment send log opens: ${error instanceof Error ? error.message : String(error)}`
    );
    // Don't throw - engagement tracking failures should not block processing
  }
}

/**
 * Increment send log click count
 * @param sendLogId - Send log ID
 * @param clickData - Click event data
 */
export async function incrementSendLogClicks(
  sendLogId: string,
  clickData: { timestamp: Date; link: string }
): Promise<void> {
  try {
    await sql`
      UPDATE send_logs
      SET click_count = COALESCE(click_count, 0) + 1,
          first_clicked_at = COALESCE(first_clicked_at, ${clickData.timestamp})
      WHERE id = ${sendLogId}
    `;
  } catch (error) {
    logger.warn(
      `Failed to increment send log clicks: ${error instanceof Error ? error.message : String(error)}`
    );
    // Don't throw - engagement tracking failures should not block processing
  }
}

/**
 * Update send log status with bounce tracking
 * @param sendLogId - Send log ID
 * @param bounceType - 'Permanent' or 'Transient'
 * @param bounceData - Full bounce details
 */
export async function updateSendLogBounced(
  sendLogId: string,
  bounceType: 'Permanent' | 'Transient',
  _bounceData: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      UPDATE send_logs
      SET status = 'bounced',
          error_reason = ${`Bounce: ${bounceType}`}
      WHERE id = ${sendLogId}
    `;
  } catch (error) {
    logger.warn(
      `Failed to update send log bounced: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * Update send log status with complaint tracking
 * @param sendLogId - Send log ID
 * @param complaintData - Complaint details
 */
export async function updateSendLogComplained(
  sendLogId: string,
  complaintData: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      UPDATE send_logs
      SET status = 'complained',
          error_reason = ${`Complaint: ${complaintData.complaintFeedbackType || 'unknown'}`}
      WHERE id = ${sendLogId}
    `;
  } catch (error) {
    logger.warn(
      `Failed to update send log complained: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * Suppress contact from future sends due to bounce/complaint
 * Creates contact_suppressions record for suppression
 * @param contactId - Contact ID to suppress
 * @param reason - Suppression reason
 * @param eventType - Type of event causing suppression
 */
export async function suppressContact(
  contactId: string,
  reason: string,
  eventType: 'bounce' | 'complaint'
): Promise<void> {
  await createContactSuppression({
    contactId,
    suppressionType: eventType,
    suppressionReason: reason,
  });
}

/**
 * Record engagement event (open/click) to analytics
 * @param sendLogId - Send log ID
 * @param contactId - Contact ID
 * @param eventType - 'open' or 'click'
 * @param eventData - Event details (IP, user agent, link, etc.)
 */
export async function recordEngagementEvent(
  sendLogId: string,
  _contactId: string,
  eventType: 'open' | 'click',
  eventData: Record<string, unknown>
): Promise<void> {
  try {
    if (eventType === 'open') {
      await incrementSendLogOpens(sendLogId, eventData.timestamp as Date);
    } else if (eventType === 'click') {
      await incrementSendLogClicks(sendLogId, {
        timestamp: eventData.timestamp as Date,
        link: eventData.link as string,
      });
    }
  } catch (error) {
    logger.warn(
      `Failed to record engagement event: ${error instanceof Error ? error.message : String(error)}`
    );
    // Don't throw - engagement tracking failures should not block processing
  }
}

/**
 * Update send log engagement (alias for recordEngagementEvent)
 * @param sendLogId - Send log ID
 * @param engagementType - 'open' or 'click'
 * @param timestamp - Event timestamp
 * @param metadata - Additional metadata (link, ip, userAgent, etc.)
 */
export async function updateSendLogEngagement(
  sendLogId: string,
  engagementType: 'open' | 'click',
  timestamp: Date,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    if (engagementType === 'open') {
      await incrementSendLogOpens(sendLogId, timestamp);
    } else if (engagementType === 'click') {
      await incrementSendLogClicks(sendLogId, {
        timestamp,
        link: (metadata?.link as string) || '',
      });
    }
  } catch (error) {
    logger.warn(
      `Failed to update send log engagement: ${error instanceof Error ? error.message : String(error)}`
    );
    // Don't throw - engagement tracking failures should not block processing
  }
}

async function runStandalone(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle reset command
  if (args[0] === 'reset') {
    try {
      const result = await resetDatabase();
      console.log(`\n✅ ${result.message}`);
      await closeConnection();
      process.exit(0);
    } catch (error) {
      const dbConfig = getDbConfig();
      console.error('❌ Database reset failed');
      console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Connection: ${dbConfig.host}:${dbConfig.port}`);
      console.error('   Check:');
      console.error('     1. DATABASE_URL in .env file');
      console.error('     2. PostgreSQL is running');
      console.error('     3. User has permissions to truncate tables');
      process.exit(1);
    }
    return;
  }

  // Default: initialize schema
  try {
    await initializeSchema();
    console.log('✅ Database initialized successfully');
    await closeConnection();
    process.exit(0);
  } catch (error) {
    const dbConfig = getDbConfig();
    console.error('❌ Database initialization failed');
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`   Connection: ${dbConfig.host}:${dbConfig.port}`);
    console.error('   Check:');
    console.error('     1. DATABASE_URL in .env file');
    console.error('     2. PostgreSQL is running');
    console.error('     3. Database user has CREATE TABLE permissions');
    process.exit(1);
  }
}

import { pathToFileURL } from 'node:url';

// Check if this file is being run directly (not imported as a module)
// Only run standalone logic when db.ts is the entry point
const isDbEntryPoint = (): boolean => {
  // Get the actual entry point from Bun's runtime
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  // Convert both paths to file URLs for comparison
  const currentFileUrl = pathToFileURL(import.meta.filename).href;
  const entryPointUrl = pathToFileURL(entryPoint).href;

  return currentFileUrl === entryPointUrl;
};

if (isDbEntryPoint()) {
  runStandalone().catch((err) => {
    console.error('Failed to run standalone:', err);
  });
}
