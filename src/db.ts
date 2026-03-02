/**
 * Database module for TermiSend
 * Handles PostgreSQL connection, schema initialization, and query execution
 *
 * Uses lazy initialization to avoid module-level side effects.
 * Database connection is only established when first used.
 */

import postgres from 'postgres';
import { getEnv } from './config.js';
import type {
  AuditLog,
  Contact,
  EmailVerifierCredits,
  JSONValue,
  LogStatus,
  SendLog,
  SendMode,
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

    // Create send_logs table for tracking email send attempts
    await sql`
      CREATE TABLE IF NOT EXISTS send_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        campaign_id UUID,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        mode VARCHAR(50) NOT NULL DEFAULT 'production',
        subject VARCHAR(500) NOT NULL,
        body_preview VARCHAR(500) NOT NULL,
        error_reason TEXT,
        message_id VARCHAR(255),
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

    // Success message for CLI usage
    if (require.main === module || process.argv[1]?.includes('db.ts')) {
      const dbConfig = getDbConfig();
      console.log('✅ Database initialized successfully!');
      console.log(`   Database: ${dbConfig.database}`);
      console.log('   Tables: contacts, send_logs, audit_logs, email_verifier_credits');
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
 * @returns true if inserted, false if skipped due to duplicate
 */
export async function insertContactSkipDuplicate(
  companyName: string,
  personName: string,
  email: string
): Promise<boolean> {
  const result = await sql<Contact[]>`
    INSERT INTO contacts (company_name, person_name, email)
    VALUES (${companyName}, ${personName}, ${email})
    ON CONFLICT (email) DO NOTHING
    RETURNING *
  `;
  return result.length > 0;
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
 * A contact is eligible if it has no successful 'sent' log entry
 * In dev/test mode, this allows retries
 *
 * @param limit - Maximum number of contacts to return (default: 1000)
 * @returns Array of eligible contacts
 */
export async function getEligibleContacts(limit: number = 1000): Promise<Contact[]> {
  return await sql<Contact[]>`
    SELECT c.* FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'sent'
    )
    ORDER BY c.created_at ASC
    LIMIT ${limit}
  `;
}

/**
 * Get count of eligible contacts for sending
 */
export async function getEligibleContactCount(): Promise<number> {
  const [result] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count
    FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM send_logs sl
      WHERE sl.contact_id = c.id
      AND sl.status = 'sent'
    )
  `;
  return result?.count ?? 0;
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
  campaignId?: string
): Promise<SendLog> {
  const [log] = await sql<SendLog[]>`
    INSERT INTO send_logs (contact_id, campaign_id, status, mode, subject, body_preview)
    VALUES (${contactId}, ${campaignId ?? null}, 'pending', ${mode}, ${subject}, ${bodyPreview})
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
  }
): Promise<SendLog> {
  const [log] = await sql<SendLog[]>`
    UPDATE send_logs
    SET 
      status = ${updates.status},
      message_id = ${updates.messageId ?? null},
      error_reason = ${updates.errorReason ?? null},
      sent_at = ${updates.sentAt ?? null}
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
    // Execute truncate with CASCADE to handle any foreign key references
    // RESTART IDENTITY resets auto-increment sequences
    //
    // IMPORTANT: When new tables are added to the database schema, they must be
    // added to this TRUNCATE list to ensure complete database resets.
    await sql`
      TRUNCATE TABLE contacts, send_logs, audit_logs, email_verifier_credits
      RESTART IDENTITY CASCADE
    `;

    return {
      success: true,
      message: `Database '${dbName}' reset successfully. All data deleted.`,
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
// Standalone initialization (for CLI usage)
// ============================================================================

async function runStandalone(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle reset command
  if (args[0] === 'reset') {
    try {
      await resetDatabase();
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
