/**
 * Database module for TermiSend
 * Handles PostgreSQL connection, schema initialization, and query execution
 */

import postgres from 'postgres';
import { getEnv } from './config.js';
import type { AuditLog, Contact, JSONValue } from './types.js';

// ============================================================================
// Environment Configuration
// ============================================================================

const env = getEnv();

// Merge with process.env - fail fast if required config is missing
const DB_HOST = process.env.DB_HOST || env.DB_HOST;
const DB_PORT = Number.parseInt(process.env.DB_PORT || env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || env.DB_USER;
const DB_PASS = process.env.DB_PASS || env.DB_PASS;
const DB_NAME = process.env.DB_NAME || env.DB_NAME || 'termisend';

// Validate required configuration
if (!DB_HOST) {
  throw new Error('DB_HOST is required. Set it in environment variables or .env file.');
}
if (!DB_USER) {
  throw new Error('DB_USER is required. Set it in environment variables or .env file.');
}
if (!DB_PASS) {
  throw new Error('DB_PASS is required. Set it in environment variables or .env file.');
}

// ============================================================================
// PostgreSQL Client Setup
// ============================================================================

// Use connection object format to properly handle special characters in credentials
export const sql = postgres({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

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
 * Insert an audit log entry
 */
export async function insertAuditLog(
  eventType: string,
  payload: Record<string, unknown>
): Promise<AuditLog> {
  // Serialize payload to ensure JSON compatibility (handles Date objects, etc.)
  const jsonPayload = JSON.parse(JSON.stringify(payload)) as JSONValue;
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
// Connection Management
// ============================================================================

/**
 * Close database connection
 */
export async function closeConnection(): Promise<void> {
  await sql.end();
}

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
