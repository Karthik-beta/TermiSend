/**
 * Database module for TermiSend
 * Handles PostgreSQL connection, schema initialization, and query execution
 *
 * Uses lazy initialization to avoid module-level side effects.
 * Database connection is only established when first used.
 */

import postgres from 'postgres';
import { getEnv } from './config.js';
import type { AuditLog, Contact, EmailVerifierCredits, JSONValue } from './types.js';

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
    // Create contacts table
    await sql`
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name VARCHAR(255) NOT NULL,
        person_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index on email for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)
    `;

    // Create index on status for filtering
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status)
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
    INSERT INTO contacts (company_name, person_name, email, status)
    VALUES (${companyName}, ${personName}, ${email}, 'pending')
    ON CONFLICT (email) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      person_name = EXCLUDED.person_name,
      status = 'pending'
    RETURNING *
  `;
  return contact;
}

/**
 * Get all contacts with optional status filter
 */
export async function getContacts(status?: string): Promise<Contact[]> {
  if (status) {
    return await sql<Contact[]>`
      SELECT * FROM contacts
      WHERE status = ${status}
      ORDER BY created_at DESC
    `;
  }
  return await sql<Contact[]>`
    SELECT * FROM contacts
    ORDER BY created_at DESC
  `;
}

/**
 * Get pending contacts for email campaign
 */
export async function getPendingContacts(): Promise<Contact[]> {
  return await sql<Contact[]>`
    SELECT * FROM contacts
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `;
}

/**
 * Update contact status
 */
export async function updateContactStatus(email: string, status: Contact['status']): Promise<void> {
  await sql`
    UPDATE contacts 
    SET status = ${status}
    WHERE email = ${email}
  `;
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
  try {
    await initializeSchema();
    await closeConnection();
    process.exit(0);
  } catch (error) {
    console.error(
      '✗ Failed to initialize database:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.cwd()}/src/db.ts`) {
  runStandalone();
}
