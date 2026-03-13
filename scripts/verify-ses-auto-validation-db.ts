import postgres from 'postgres';
import {
  getDatabaseConnectionConfig,
  loadDatabaseEnvironment,
  parseEnvironment,
  type DatabaseEnvironment,
} from '../src/db-admin.js';

interface CliOptions {
  environment: DatabaseEnvironment;
  days: number;
  limit: number;
  email?: string;
  help: boolean;
}

interface WindowSummaryRow {
  totalSends: number;
  withMessageId: number;
  sendEvents: number;
  deliveryEvents: number;
  bounceEvents: number;
  complaintEvents: number;
  rejectEvents: number;
  renderingFailureEvents: number;
  deliveredLogs: number;
  bouncedLogs: number;
  complainedLogs: number;
  sentLogs: number;
}

interface SendVerificationRow {
  sendLogId: string;
  createdAt: Date;
  sentAt: Date | null;
  status: string;
  email: string;
  companyName: string;
  personName: string;
  messageId: string | null;
  deliveryConfirmedAt: Date | null;
  sendEventAt: Date | null;
  deliveryEventAt: Date | null;
  bounceEventAt: Date | null;
  complaintEventAt: Date | null;
  rejectEventAt: Date | null;
  renderingFailureAt: Date | null;
  allEventTypes: string[] | null;
}

function printHelp(): void {
  console.log('Usage: bun run scripts/verify-ses-auto-validation-db.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --env <development|production>   Environment file to load (default: production)');
  console.log('  --days <number>                  Look back window in days (default: 30)');
  console.log('  --limit <number>                 Number of sample records to print (default: 15)');
  console.log('  --email <address>                Restrict verification to one recipient email');
  console.log('  --help, -h                       Show this help message');
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    environment: 'production',
    days: 30,
    limit: 15,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case '--env':
        if (!next) {
          throw new Error('Missing value for --env');
        }
        options.environment = parseEnvironment(next);
        index += 1;
        break;
      case '--days':
        if (!next) {
          throw new Error('Missing value for --days');
        }
        options.days = Number.parseInt(next, 10);
        if (!Number.isFinite(options.days) || options.days <= 0) {
          throw new Error(`Invalid --days value "${next}"`);
        }
        index += 1;
        break;
      case '--limit':
        if (!next) {
          throw new Error('Missing value for --limit');
        }
        options.limit = Number.parseInt(next, 10);
        if (!Number.isFinite(options.limit) || options.limit <= 0) {
          throw new Error(`Invalid --limit value "${next}"`);
        }
        index += 1;
        break;
      case '--email':
        if (!next) {
          throw new Error('Missing value for --email');
        }
        options.email = next.trim().toLowerCase();
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function formatDate(value: Date | null): string {
  if (!value) {
    return '-';
  }

  return value.toISOString();
}

function formatEventTypes(value: string[] | null): string {
  if (!value || value.length === 0) {
    return '-';
  }

  return value.join(', ');
}

function printSummary(summary: WindowSummaryRow, options: CliOptions, since: Date): void {
  console.log(`SES DB verification window: since ${since.toISOString()}`);
  console.log(`Environment: ${options.environment}`);
  if (options.email) {
    console.log(`Email filter: ${options.email}`);
  }
  console.log('');
  console.log('Counts');
  console.log(`  send_logs rows: ${summary.totalSends}`);
  console.log(`  send_logs with message_id: ${summary.withMessageId}`);
  console.log(`  SES Send events: ${summary.sendEvents}`);
  console.log(`  SES Delivery events: ${summary.deliveryEvents}`);
  console.log(`  SES Bounce events: ${summary.bounceEvents}`);
  console.log(`  SES Complaint events: ${summary.complaintEvents}`);
  console.log(`  SES Reject events: ${summary.rejectEvents}`);
  console.log(`  SES RenderingFailure events: ${summary.renderingFailureEvents}`);
  console.log('');
  console.log('Current send_log statuses');
  console.log(`  sent: ${summary.sentLogs}`);
  console.log(`  delivered: ${summary.deliveredLogs}`);
  console.log(`  bounced: ${summary.bouncedLogs}`);
  console.log(`  complained: ${summary.complainedLogs}`);
  console.log('');
}

function printRows(title: string, rows: SendVerificationRow[]): void {
  console.log(title);

  if (rows.length === 0) {
    console.log('  none');
    console.log('');
    return;
  }

  for (const row of rows) {
    console.log(`  ${row.email} | ${row.status} | ${row.messageId ?? 'no-message-id'}`);
    console.log(
      `    created=${formatDate(row.createdAt)} sent=${formatDate(row.sentAt)} delivered=${formatDate(row.deliveryEventAt || row.deliveryConfirmedAt)}`
    );
    console.log(
      `    send=${formatDate(row.sendEventAt)} bounce=${formatDate(row.bounceEventAt)} complaint=${formatDate(row.complaintEventAt)} reject=${formatDate(row.rejectEventAt)} renderFail=${formatDate(row.renderingFailureAt)}`
    );
    console.log(`    events=${formatEventTypes(row.allEventTypes)}`);
  }

  console.log('');
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const fileEnvironment = loadDatabaseEnvironment(options.environment);
  const environment = {
    ...fileEnvironment,
    ...process.env,
    NODE_ENV: options.environment,
  };
  const dbConfig = getDatabaseConnectionConfig(environment);
  const sql = postgres({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => {},
  });

  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const emailFilter = options.email ?? null;

  try {
    const [summary] = await sql<WindowSummaryRow[]>`
      WITH filtered_logs AS (
        SELECT sl.id, sl.status, sl.message_id
        FROM send_logs sl
        JOIN contacts c ON c.id = sl.contact_id
        WHERE sl.created_at >= ${since}
          AND sl.mode = 'production'
          AND (${emailFilter}::text IS NULL OR lower(c.email) = ${emailFilter})
      ),
      filtered_events AS (
        SELECT setr.event_type
        FROM ses_event_tracking setr
        JOIN send_logs sl ON sl.id = setr.send_log_id
        JOIN contacts c ON c.id = sl.contact_id
        WHERE sl.created_at >= ${since}
          AND sl.mode = 'production'
          AND (${emailFilter}::text IS NULL OR lower(c.email) = ${emailFilter})
      )
      SELECT
        (SELECT COUNT(*)::int FROM filtered_logs) AS "totalSends",
        (SELECT COUNT(*)::int FROM filtered_logs WHERE message_id IS NOT NULL) AS "withMessageId",
        (SELECT COUNT(*)::int FROM filtered_events WHERE event_type = 'Send') AS "sendEvents",
        (SELECT COUNT(*)::int FROM filtered_events WHERE event_type = 'Delivery') AS "deliveryEvents",
        (SELECT COUNT(*)::int FROM filtered_events WHERE event_type = 'Bounce') AS "bounceEvents",
        (SELECT COUNT(*)::int FROM filtered_events WHERE event_type = 'Complaint') AS "complaintEvents",
        (SELECT COUNT(*)::int FROM filtered_events WHERE event_type = 'Reject') AS "rejectEvents",
        (
          SELECT COUNT(*)::int
          FROM filtered_events
          WHERE event_type = 'RenderingFailure'
        ) AS "renderingFailureEvents",
        (SELECT COUNT(*)::int FROM filtered_logs WHERE status = 'sent') AS "sentLogs",
        (SELECT COUNT(*)::int FROM filtered_logs WHERE status = 'delivered') AS "deliveredLogs",
        (SELECT COUNT(*)::int FROM filtered_logs WHERE status = 'bounced') AS "bouncedLogs",
        (SELECT COUNT(*)::int FROM filtered_logs WHERE status = 'complained') AS "complainedLogs"
    `;

    const rows = await sql<SendVerificationRow[]>`
      SELECT
        sl.id AS "sendLogId",
        sl.created_at AS "createdAt",
        sl.sent_at AS "sentAt",
        sl.status,
        c.email,
        c.company_name AS "companyName",
        c.person_name AS "personName",
        sl.message_id AS "messageId",
        sl.delivery_confirmed_at AS "deliveryConfirmedAt",
        MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Send') AS "sendEventAt",
        MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Delivery') AS "deliveryEventAt",
        MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Bounce') AS "bounceEventAt",
        MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Complaint') AS "complaintEventAt",
        MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'Reject') AS "rejectEventAt",
        MAX(setr.occurred_at) FILTER (WHERE setr.event_type = 'RenderingFailure') AS "renderingFailureAt",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT setr.event_type), NULL) AS "allEventTypes"
      FROM send_logs sl
      JOIN contacts c ON c.id = sl.contact_id
      LEFT JOIN ses_event_tracking setr ON setr.send_log_id = sl.id
      WHERE sl.created_at >= ${since}
        AND sl.mode = 'production'
        AND (${emailFilter}::text IS NULL OR lower(c.email) = ${emailFilter})
      GROUP BY sl.id, sl.created_at, sl.sent_at, sl.status, c.email, c.company_name, c.person_name,
               sl.message_id, sl.delivery_confirmed_at
      ORDER BY sl.created_at DESC
      LIMIT ${Math.max(options.limit * 4, 40)}
    `;

    const acceptedNoDelivery = rows
      .filter(
        (row) =>
          row.messageId &&
          row.sendEventAt &&
          !row.deliveryEventAt &&
          !row.bounceEventAt &&
          !row.complaintEventAt &&
          !row.rejectEventAt &&
          !row.renderingFailureAt
      )
      .slice(0, options.limit);

    const deliveredRows = rows
      .filter((row) => row.deliveryEventAt || row.deliveryConfirmedAt || row.status === 'delivered')
      .slice(0, options.limit);

    const rejectedOrFailedRows = rows
      .filter((row) => row.rejectEventAt || row.renderingFailureAt)
      .slice(0, options.limit);

    printSummary(summary, options, since);
    printRows('Delivered samples', deliveredRows);
    printRows('Accepted by SES but no delivery/bounce/complaint tracked', acceptedNoDelivery);
    printRows('Reject / rendering failure samples', rejectedOrFailedRows);

    console.log('Interpretation');
    if (acceptedNoDelivery.length > 0) {
      console.log(
        '  There are messages SES accepted but the database has no later delivery/bounce/complaint event for them.'
      );
      console.log(
        '  That is consistent with either SES suppression/Auto Validation or missing downstream event ingestion.'
      );
    } else {
      console.log(
        '  In the sampled records, every SES-accepted message has a downstream outcome recorded or no Send event was tracked.'
      );
    }

    if (rejectedOrFailedRows.length > 0) {
      console.log(
        '  Reject or rendering-failure events exist, but those are not the usual proof of Auto Validation.'
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('SES DB verification failed');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
