/**
 * Migration script: Move send status from contacts table to send_logs table
 *
 * This migration:
 * 1. Creates the send_logs table
 * 2. Migrates existing contact status to send_logs entries
 * 3. Removes the status column from contacts table
 * 4. Removes the idx_contacts_status index
 *
 * Usage: bun run scripts/migrate-send-logs.ts
 */

import postgres from 'postgres';
import { sql, closeConnection } from '../src/db.js';
import { logger } from '../src/logger.js';

// Type for transaction sql (same as main sql client)
type SqlType = ReturnType<typeof postgres>;

interface ContactWithStatus {
  id: string;
  email: string;
  companyName: string;
  personName: string;
  status: 'pending' | 'sent' | 'failed' | 'invalid' | 'verified';
  createdAt: Date;
}

/**
 * Run the migration
 */
async function runMigration(): Promise<void> {
  console.log('🚀 Starting send_logs migration...\n');

  try {
    // Step 1: Check if contacts table has status column
    // This is kept outside the transaction since it only reads metadata
    console.log('Step 1: Checking current schema...');
    const columnCheck = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'contacts'
      AND column_name = 'status'
    `;

    const hasStatusColumn = columnCheck.length > 0;

    if (!hasStatusColumn) {
      console.log('  ✓ Status column already removed from contacts table');
    } else {
      console.log('  ✓ Found status column in contacts table');
    }

    // Steps 2-5: Wrap all database mutations in a transaction
    // If any operation fails, the entire transaction rolls back
    await sql.begin(async (tx) => {
      // Cast tx to SqlType for template literal query support
      // This is necessary because postgres's TransactionSql type doesn't expose
      // the tagged template function signature directly, but behaves identically at runtime
      const txSql = tx as unknown as SqlType;

      // Step 2: Create send_logs table if not exists
      console.log('\nStep 2: Creating send_logs table...');
      await txSql`
        CREATE TABLE IF NOT EXISTS send_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          campaign_id UUID,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          mode VARCHAR(50) NOT NULL DEFAULT 'production',
          subject VARCHAR(500) NOT NULL DEFAULT 'Migrated from legacy status',
          body_preview VARCHAR(500) NOT NULL DEFAULT 'Historical data - no body available',
          error_reason TEXT,
          message_id VARCHAR(255),
          sent_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      console.log('  ✓ send_logs table created');

      // Create indexes
      await txSql`CREATE INDEX IF NOT EXISTS idx_send_logs_contact_id ON send_logs(contact_id)`;
      await txSql`CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status)`;
      await txSql`CREATE INDEX IF NOT EXISTS idx_send_logs_created_at ON send_logs(created_at)`;
      await txSql`CREATE INDEX IF NOT EXISTS idx_send_logs_campaign_id ON send_logs(campaign_id)`;
      console.log('  ✓ send_logs indexes created');

      // Step 3: Migrate existing status data
      if (hasStatusColumn) {
        console.log('\nStep 3: Migrating existing contact status to send_logs...');

        // Get all contacts with their status
        const contacts = await txSql<ContactWithStatus[]>`
          SELECT id, email, company_name, person_name, status, created_at
          FROM contacts
          WHERE status != 'pending'
        `;

        console.log(`  Found ${contacts.length} contacts with non-pending status to migrate`);

        // Map old status to new log status
        // 'verified' -> treated as 'sent' (email was validated and sent)
        // 'invalid' -> 'skipped' (email was invalid, skipped sending)
        const statusMap: Record<string, string> = {
          sent: 'sent',
          failed: 'failed',
          invalid: 'skipped',
          verified: 'sent',
        };

        let migratedCount = 0;
        for (const contact of contacts) {
          const logStatus = statusMap[contact.status] || 'failed';
          const isSent = logStatus === 'sent';

          await txSql`
            INSERT INTO send_logs (
              contact_id,
              status,
              mode,
              subject,
              body_preview,
              sent_at
            )
            VALUES (
              ${contact.id},
              ${logStatus},
              'production',
              'Migrated from legacy status',
              'Historical data - no body available',
              ${isSent ? contact.createdAt : null}
            )
          `;
          migratedCount++;

          if (migratedCount % 100 === 0) {
            console.log(`  Migrated ${migratedCount}/${contacts.length} contacts...`);
          }
        }

        console.log(`  ✓ Migrated ${migratedCount} contacts to send_logs`);

        // Step 4: Remove status column from contacts
        console.log('\nStep 4: Removing status column from contacts table...');
        await txSql`ALTER TABLE contacts DROP COLUMN IF EXISTS status`;
        console.log('  ✓ Status column removed from contacts table');

        // Step 5: Remove idx_contacts_status index
        console.log('\nStep 5: Removing idx_contacts_status index...');
        await txSql`DROP INDEX IF EXISTS idx_contacts_status`;
        console.log('  ✓ idx_contacts_status index removed');
      } else {
        console.log('\nStep 3-5: Skipping data migration (status column already removed)');
      }
    });

    // Log migration completion outside the transaction
    if (hasStatusColumn) {
      await logger.logEvent('USER_INPUT', {
        action: 'MIGRATION_COMPLETED',
        timestamp: new Date().toISOString(),
      });
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nSummary:');
    console.log('  - send_logs table is ready');
    console.log('  - contacts table now contains identity data only');
    if (hasStatusColumn) {
      console.log('  - Historical status data migrated to send_logs');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error instanceof Error ? error.message : String(error));
    await logger.logError('MIGRATION_FAILED', error instanceof Error ? error : String(error));
    process.exit(1);
  } finally {
    await closeConnection();
  }
}

// Run migration if this file is executed directly
if (import.meta.main) {
  void runMigration();
}

export { runMigration };
