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
 * Insert a new contact into the database, skipping if email already exists
 * @returns true if inserted, false if skipped due to duplicate
 */
export async function insertContactSkipDuplicate(
  companyName: string,
  personName: string,
  email: string
): Promise<boolean> {
  const result = await sql<Contact[]>`
    INSERT INTO contacts (company_name, person_name, email, status)
    VALUES (${companyName}, ${personName}, ${email}, 'pending')
    ON CONFLICT (email) DO NOTHING
    RETURNING *
  `;
  return result.length > 0;
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
      TRUNCATE TABLE contacts, audit_logs, email_verifier_credits
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
      console.error(
        '✗ Database reset failed:',
        error instanceof Error ? error.message : String(error)
      );
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
    console.error(
      '✗ Failed to initialize database:',
      error instanceof Error ? error.message : String(error)
    );
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

  // Normalize both paths for comparison (case-insensitive for Windows)
  const entryUrl = pathToFileURL(entryPoint).href.toLowerCase();
  const dbUrl = pathToFileURL(`${process.cwd()}/src/db.ts`).href.toLowerCase();

  return entryUrl === dbUrl;
};

if (isDbEntryPoint()) {
  runStandalone();
}
