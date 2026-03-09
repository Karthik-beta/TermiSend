#!/usr/bin/env bun
/**
 * Query script to retrieve failed email logs from the database
 */

import { sql, closeConnection } from '../src/db.js';

async function queryFailedLogs() {
  console.log('🔍 Querying failed email logs from database...\n');

  try {
    // Query for the specific failed emails
    const failedEmails = [
      'anji@starhospitals.in',
      'bhavesh.takle@muthoothomefin.com',
      'satish.s@axiscades.com',
      'naik.ravinandan@ardexendura.com',
      'sunil.s@kimshealth.org'
    ];

    const results = await sql`
      SELECT 
        c.email,
        c.person_name,
        c.company_name,
        sl.status,
        sl.error_reason,
        sl.sent_at,
        sl.created_at
      FROM send_logs sl
      JOIN contacts c ON sl.contact_id = c.id
      WHERE c.email IN (${failedEmails})
      ORDER BY sl.created_at DESC
    `;

    console.log('📊 Failed Email Logs:\n');
    console.log('='.repeat(100));

    for (const row of results) {
      console.log(`\n📧 Email: ${row.email}`);
      console.log(`👤 Person: ${row.person_name || 'N/A'}`);
      console.log(`🏢 Company: ${row.company_name || 'N/A'}`);
      console.log(`📋 Status: ${row.status}`);
      console.log(`⏰ Time: ${row.sent_at || row.created_at}`);
      console.log(`❌ Error Reason: ${row.error_reason || 'No error details captured'}`);
      console.log('-'.repeat(100));
    }

    // Also check for null contact_id references (evidence of shutdown issue)
    console.log('\n\n🔍 Checking for null contact references (Ctrl+C issue evidence):\n');

    const nullAnalytics = await sql`SELECT COUNT(*) as count FROM analytics_events WHERE contact_id IS NULL`;
    const nullSesEvents = await sql`SELECT COUNT(*) as count FROM ses_message_events WHERE contact_id IS NULL`;

    console.log(`Analytics events with null contact_id: ${nullAnalytics[0]?.count || 0}`);
    console.log(`SES message events with null contact_id: ${nullSesEvents[0]?.count || 0}`);

    // Get ALL send logs to see the full picture
    console.log('\n\n📈 ALL Send Logs (full campaign history):\n');
    console.log('='.repeat(100));

    const allLogs = await sql`
      SELECT 
        c.email,
        c.person_name,
        sl.status,
        sl.error_reason,
        sl.message_id,
        sl.sent_at,
        sl.created_at
      FROM send_logs sl
      LEFT JOIN contacts c ON sl.contact_id = c.id
      ORDER BY sl.created_at ASC
    `;

    for (const row of allLogs) {
      console.log(`\n📧 Email: ${row.email || 'NULL (contact lost)'}`);
      console.log(`👤 Person: ${row.person_name || 'N/A'}`);
      console.log(` Status: ${row.status}`);
      console.log(`🆔 Message ID: ${row.message_id || 'N/A'}`);
      if (row.error_reason) {
        console.log(`❌ Error: ${row.error_reason}`);
      }
      if (row.sent_at) {
        console.log(`⏰ Sent At: ${row.sent_at}`);
      }
      console.log(`📝 Created At: ${row.created_at}`);
      console.log('-'.repeat(100));
    }

    // Summary statistics
    console.log('\n\n📊 Campaign Summary:\n');
    console.log('='.repeat(100));

    const stats = await sql`
      SELECT 
        status,
        COUNT(*) as count
      FROM send_logs
      GROUP BY status
    `;

    for (const row of stats) {
      console.log(`${row.status}: ${row.count}`);
    }

    const contactCount = await sql`SELECT COUNT(*) as count FROM contacts`;
    console.log(`\nTotal contacts in database: ${contactCount[0]?.count || 0}`);
    console.log(`Total send logs: ${allLogs.length}`);

  } catch (error) {
    console.error('❌ Error querying database:', error);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}

queryFailedLogs();
