# TermiSend - Local Email Outreach CLI

A local-only, terminal-based email outreach tool built with Bun, TypeScript, and Ink. Import contacts from Excel, verify emails, and send personalized campaigns via AWS SES - all from your terminal.

## Features

- 📥 **Excel Import**: Import contacts from Excel files with validation
- ✅ **Email Verification**: Verify emails via MyEmailVerifier API before sending
- 🎨 **Spintax Support**: Create dynamic email templates with spintax syntax
- 📝 **Markdown Templates**: Write emails in Markdown, rendered to HTML
- 🗄️ **Audit Logging**: Every action logged to PostgreSQL for compliance
- 🖥️ **Terminal UI**: Beautiful TUI built with Ink and React
- 📄 **Template Generator**: Download Excel templates with proper format
- ⏱️ **Smart Throttling**: Configurable rate limiting to stay within SES quotas
- 🔒 **Safety Controls**: Built-in safeguards to prevent accidental sends in development

## Tech Stack

- **Runtime**: Bun 1.3.10
- **Language**: TypeScript 5.9.3
- **UI**: Ink 6.8.0 + React 19
- **Database**: PostgreSQL with `postgres` client
- **Validation**: Zod 4.3.6
- **Excel**: exceljs 4.4.0
- **AWS**: @aws-sdk/client-ses
- **Markdown**: marked

## Quick Start

1. **Prerequisites**: Install Bun and PostgreSQL
2. **Clone & Install**: `git clone <repo> && cd termisend && bun install`
3. **Environment**: Copy `.env.development` to `.env.development.local` and fill in your credentials
4. **Verify Setup**: Run verification scripts to ensure everything is configured correctly
   ```bash
   bun run scripts/verify-ses.ts
   bun run scripts/verify-myemailverifier.ts
   ```
5. **Initialize Database**: `bun run db:init:dev` (or `db:init:prod` for production)
6. **Start**: `bun run dev`

## Database Backup and Restore

TermiSend includes PostgreSQL-native backup and restore commands for full database snapshots.

### Create a backup

Development:
```bash
bun run db:backup --output-dir ./backups/postgres
```

Production:
```bash
bun run db:backup:prod --output-dir ./backups/postgres --confirm-production-backup
```

This creates a complete PostgreSQL custom-format dump (`.dump`) containing schema and data. If you omit `--output-dir`, TermiSend uses `DB_BACKUP_DIR` when configured, otherwise `./backups/postgres`.

### Restore a backup

Development:
```bash
bun run db:restore --input ./backups/postgres/termisend-2026-03-08T12-00-00.000Z.dump --confirm-restore
```

Production:
```bash
bun run db:restore:prod --input ./backups/postgres/termisend-2026-03-08T12-00-00.000Z.dump --confirm-restore --confirm-production-restore
```

Restore uses `pg_restore --clean --if-exists`, so existing database objects are dropped before the backup is reapplied. Install PostgreSQL client tools so `pg_dump` and `pg_restore` are available on your `PATH` before using these commands.

## Prerequisites

1. **Bun** (1.3.10 or higher)
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **PostgreSQL** (Local installation)
   - Download from [postgresql.org](https://www.postgresql.org/download/)
   - Create a database named `termisend`

3. **AWS Account** with SES configured
   - Verify your sender email address in SES
   - Obtain AWS Access Key and Secret Key

4. **MyEmailVerifier Account**
   - Sign up at [myemailverifier.com](https://myemailverifier.com)
   - Obtain API key

## Installation

1. **Clone the repository** (or extract the project files)
   ```bash
   cd termisend
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment variables**
   
   Copy the appropriate environment file and fill in your credentials:
   ```bash
   # For development
   cp .env.development .env.development.local
   
   # For production
   cp .env.production .env.production.local
   ```

   See the [Environment Setup](#environment-setup) section for detailed configuration options.

4. **Verify your configuration**

   Before starting the application, verify that your API integrations are working:
   ```bash
   # Verify AWS SES configuration
   bun run scripts/verify-ses.ts
   
   # Verify MyEmailVerifier API
   bun run scripts/verify-myemailverifier.ts
   ```

5. **Initialize the database**
   ```bash
   bun run db:init
   ```

## Desktop Shortcut (Windows)

Use the bundled production build to make TermiSend available via a desktop icon:

1. Build the production bundle if you have not already:
   ```bash
   bun build
   ```
2. Run the shortcut helper from the repo root:
   ```bash
   bun run shortcut:create
   ```

The helper enforces a Windows-only session, validates that `dist/index.js` exists, and creates a `.lnk` on your desktop that launches Command Prompt (`cmd.exe /k`) and runs a generated launcher script so the console window stays open and TermiSend keeps interactive terminal control. It also applies the TermiSend icon (`assets/termisend.ico`) when present and wires a `Ctrl+Alt+T` hotkey.

Customise the shortcut with the following flags:

- `--name <label>`: override the shortcut label that appears in Explorer (the script appends `.lnk` if you omit it).
- `--desktop-path <path>`: point the script at a different directory (useful for shared desktops or nonstandard profiles).
- `--icon <path>`: supply your own `.ico` file instead of the default.
- `--force`: replace an existing shortcut without prompting.

Re-run the helper whenever you move the repo, rebuild the bundle, or redeploy TermiSend so the shortcut continues to point at the correct `dist/index.js`.

## Environment Setup

### Required Configuration

Configure the following in your `.env.development.local` or `.env.production.local`:

#### Database Configuration
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=your_password
DB_NAME=termisend
```

#### AWS SES Configuration
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
SES_FROM_EMAIL=noreply@yourdomain.com
```

#### MyEmailVerifier API Configuration
```env
MYEMAILVERIFIER_API_KEY=your_api_key
```

### Development / Safety Controls

These settings help prevent accidental sends during development:

```env
# Redirect all emails to this address in development
TEST_RECIPIENT_EMAIL=test@yourdomain.com

# Set to 'true' to simulate verification without calling the API (saves credits)
SIMULATE_VERIFIER=true

# Set to 'true' to redirect all emails to TEST_RECIPIENT_EMAIL in dev mode
REDIRECT_EMAILS=true
```

### Throttling Configuration

Configure rate limiting to stay within AWS SES quotas:

```env
# Minimum delay between emails (milliseconds)
THROTTLE_MIN_DELAY_MS=1000

# Maximum delay between emails (milliseconds)
THROTTLE_MAX_DELAY_MS=5000

# Probability of taking a longer break (percentage)
THROTTLE_BREAK_PROBABILITY_PERCENT=5

# Minimum break duration (minutes)
THROTTLE_BREAK_MIN_MINUTES=3

# Maximum break duration (minutes)
THROTTLE_BREAK_MAX_MINUTES=10

# SES rate limit per second
SES_RATE_LIMIT_PER_SECOND=14

# Buffer percentage to stay below quota
SES_QUOTA_BUFFER_PERCENT=10
```

## Verification Scripts

Before running campaigns, verify your API configurations using these scripts:

### AWS SES Verification

The `scripts/verify-ses.ts` script checks your AWS SES configuration:

```bash
bun run scripts/verify-ses.ts
```

This script verifies:
- AWS credentials are valid
- SES account has sending enabled
- Lists verified sender identities
- Shows current send quota and sent count

**Expected Output:**
```
✓ Environment variables configured
✓ AWS credentials validated
✓ SES account sending enabled
✓ SES verified identities found
✓ SES configuration verified successfully
```

### MyEmailVerifier Verification

The `scripts/verify-myemailverifier.ts` script checks your email verification API:

```bash
bun run scripts/verify-myemailverifier.ts
```

This script verifies:
- API key is configured
- API key is valid (makes a test call)
- Available verification credits

**Expected Output:**
```
✓ MYEMAILVERIFIER_API_KEY is configured
✓ API credentials validated
✓ API test call successful
✓ Account has X verification credits available
✓ MyEmailVerifier configuration verified successfully
```

## API Integrations

### AWS SES Integration

TermiSend uses AWS SES for sending emails. The integration includes:

- **Rate Limiting**: Automatically stays within SES rate limits
- **Quota Management**: Respects daily sending quotas with configurable buffer
- **Retry Logic**: Handles transient failures with exponential backoff
- **Region Support**: Configurable AWS region

**Verification Steps:**
1. Run `bun run scripts/verify-ses.ts`
2. Verify your sender email is listed in "Verified Identities"
3. Check that "Account sending enabled" shows "Yes"
4. Note your send quota limits

### MyEmailVerifier Integration

TermiSend uses MyEmailVerifier to validate email addresses before sending:

- **Risk Assessment**: Classifies emails as valid, invalid, catch-all, etc.
- **Credit Management**: Tracks available verification credits
- **Safety Controls**: Can be simulated in development to save credits

**Verification Steps:**
1. Run `bun run scripts/verify-myemailverifier.ts`
2. Confirm API key is valid
3. Check available verification credits
4. Note: Credits are deducted for each verification call

**Bypass Mode:**
- Set `BYPASS_MYEMAILVERIFIER_API=true` when you intentionally want TermiSend to skip the live API and return simulated responses. This flag works in every environment (including production) and keeps the downstream workflow intact, but you will no longer get real risk scoring or credit tracking while it is enabled. The bypass is the only supported way to avoid reaching MyEmailVerifier from TermiSend—auto-validation in SES (or other AWS controls) does not toggle it.

**Configurable Send Policy:**
- Set `EMAIL_VERIFICATION_POLICY` to control how strict TermiSend should be when deciding whether to send.
- Supported values:
  - `strict`: allow `valid:low`
  - `balanced`: allow `valid:low`, `catch-all:low`, and `catch-all:medium`
  - `permissive`: allow `valid:low`, `valid:medium`, `catch-all:low`, `catch-all:medium`, and `role:low`
- This setting controls send eligibility after TermiSend maps the MyEmailVerifier response into its internal status/risk result. It does not change the verifier API response itself.
- If the variable is unset, TermiSend uses `balanced`.

**Email Verification Results:**
- **Valid**: Mapped as low risk and allowed by default
- **Invalid**: Will not send (high risk)
- **Catch-all**: Domain accepts all emails and is allowed by default for low/medium risk
- **Unknown**: Cannot verify (treated as risky)
- **Disposable**: Temporary email (will not send)
- **Role**: Role-based email like admin@ (mapped as low risk but blocked by default unless explicitly allowed)

## Usage

### Start the Application

```bash
# Development mode
bun run dev

# Production mode
bun run prod

# Or simply
bun run start
```

### Main Menu

The application presents a simple menu:
- **📥 Import Excel Contacts** - Import contacts from Excel file
- **📤 Send Email Campaign** - Send emails to pending contacts
- **❌ Quit** - Exit the application

### Importing Contacts

1. Select "Import Excel Contacts" from the menu
2. Enter the path to your Excel file
3. Optionally press **T** to download an Excel template
4. The system will:
   - Parse the Excel file
   - Validate columns (Company Name, Person Name, Email)
   - Validate email format using Zod
   - Insert valid contacts into PostgreSQL
   - Log all actions to audit_logs

### Downloading Excel Template

When importing contacts, you can download a template file:

1. Select "Import Excel Contacts" from the menu
2. Press **T** to download an Excel template
3. The template is saved to `./contacts-template.xlsx`
4. Open it in Excel, fill in your contacts, and import

**Excel Template Format:**
| Company Name | Person Name | Email |
|--------------|-------------|-------|
| Acme Corp | John Doe | john@acme.com |
| Tech Inc | Jane Smith | jane@tech.com |

### Sending Email Campaigns

1. Select "Send Email Campaign" from the menu
2. Enter the path to your Markdown template file
3. Preview the email with first contact
4. Confirm to start the campaign
5. The system will:
   - Load all pending contacts
   - Parse spintax to generate unique content
   - Render Markdown to HTML
   - Verify each email via MyEmailVerifier
   - Send via AWS SES (only if email is valid/low-risk)
   - Update contact status
   - Log all actions

**Markdown Template Format:**

```markdown
# {Hello|Hi|Hey} {Person Name}

{I hope this email finds you well.|Hope you're having a great day!}

{I'm reaching out|I wanted to connect} regarding {an opportunity|a partnership} with {Company Name}.

Best regards,
Your Name
```

**Spintax Syntax:**
- `{option1|option2|option3}` - Randomly selects one option
- Nested spintax supported: `{Hello|Hi {there|friend}}`
- Placeholders: `{Person Name}`, `{Company Name}`

### Database Reset

Reset the database to a clean state. TermiSend provides distinct commands for development and production to prevent accidental data loss.

#### Development Reset
Recommended for clearing test data:
```bash
bun run db:reset:dev
```

#### Production Reset
Requires explicit bypass flags for safety:
```bash
bun run db:reset:prod
```

**⚠️ Safety Guardrails:**
- **Environment Block**: Production resets are blocked by default if `NODE_ENV=production`.
- **Database Name Check**: Resets are blocked if `DB_NAME` contains "prod" or "production".
- **Explicit Confirmation**: Always requires the `--confirm-reset` flag.
- **Production Force**: Resets in production require the additional `--force-production-reset` flag.

## Database Commands

| Command | Description |
|---------|-------------|
| `bun run db:init:dev` | Initialize development database schema |
| `bun run db:init:prod` | Initialize production database schema |
| `bun run db:reset:dev` | Reset development database (deletes all data) |
| `bun run db:reset:prod` | Reset production database (requires force flags) |

## Project Structure

```
termisend/
├── src/
│   ├── index.tsx          # Entry point - mounts Ink UI
│   ├── ui/                # Ink/React TUI components
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   └── theme.ts       # UI theme configuration
│   ├── db.ts              # Database connection, schema init, and reset
│   ├── logger.ts          # Audit logging utility
│   ├── importer.ts        # Excel import logic
│   ├── template-generator.ts  # Excel template generator
│   ├── mailer.ts          # Spintax & markdown rendering
│   ├── verifier.ts        # MyEmailVerifier API client
│   ├── ses.ts             # AWS SES integration
│   ├── ses-quota.ts       # SES quota management
│   ├── throttle.ts        # Rate limiting and throttling
│   ├── path-validator.ts  # Path validation for security
│   ├── config.ts          # Configuration management
│   └── types.ts           # TypeScript type definitions
├── scripts/               # Utility scripts
│   ├── verify-ses.ts      # Verify AWS SES configuration
│   ├── verify-myemailverifier.ts  # Verify MyEmailVerifier API
│   └── migrate-send-logs.ts       # Log migration utility
├── templates/             # Email template samples
├── tests/                 # Unit and integration tests
├── .env.development       # Development environment template
├── .env.production        # Production environment template
├── package.json           # Dependencies & scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # This file
```

## Database Schema

### contacts table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| company_name | VARCHAR(255) | Company name |
| person_name | VARCHAR(255) | Contact person name |
| email | VARCHAR(255) | Email address (unique) |
| status | VARCHAR(50) | pending/sent/verified/failed/invalid |
| created_at | TIMESTAMP | Creation timestamp |

### audit_logs table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| event_type | VARCHAR(100) | Type of event |
| payload | JSONB | Event data |
| created_at | TIMESTAMP | Creation timestamp |

### email_verifier_credits table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (singleton) |
| credits | INTEGER | Available verification credits |
| updated_at | TIMESTAMP | Last update timestamp |

**Event Types:**
- `USER_INPUT` - User interactions
- `EXCEL_IMPORT_START` - Import started
- `EXCEL_IMPORT_ROW_VALID` - Valid row imported
- `EXCEL_IMPORT_ROW_INVALID` - Invalid row skipped
- `EXCEL_IMPORT_COMPLETE` - Import finished
- `API_VERIFIER_REQ` - Email verification request
- `API_VERIFIER_RES` - Email verification response
- `AWS_SES_REQ` - Email send request
- `AWS_SES_RES` - Email send response
- `CONTACT_UPDATED` - Contact status changed
- `ERROR` - Error occurred

## SQS Event Consumer (Optional)

### Overview

The SQS Event Consumer is an optional module that polls an AWS SQS queue for SES email events, enabling real-time tracking of email delivery, bounces, complaints, and engagement metrics. The application works without this feature - emails will still be sent and tracked via SES analytics sync, but real-time event processing provides faster updates and richer event details.

**Events Processed:**
- **Bounce** - Email delivery failed (hard/soft bounces)
- **Complaint** - Recipient marked email as spam
- **Delivery** - Email successfully delivered
- **Open** - Recipient opened the email
- **Click** - Recipient clicked a link in the email

### AWS Infrastructure Setup

The SQS consumer requires the following AWS infrastructure:

```
SES Configuration Set → SNS Topic → SQS Queue
```

**Existing Infrastructure:**
- **SES Configuration Set**: `Termisend-config`
- **SNS Topic**: `termisend-ses-email-events`
- **SQS Queue**: `Termisend-SES-SNS-Topic`

To set up SES event publishing:
1. Create an SES Configuration Set with event publishing enabled
2. Configure the Configuration Set to publish events to an SNS topic
3. Subscribe an SQS queue to the SNS topic
4. Configure the SQS queue URL in your environment variables

### Configuration

Add the following to your `.env.development.local` or `.env.production.local`:

```bash
# SQS Configuration for SES Event Processing
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/Termisend-SES-SNS-Topic
SQS_POLLING_INTERVAL_MS=10000
SQS_CONSUMER_ENABLED=true
```

| Variable | Description | Default |
|----------|-------------|---------|
| `SQS_QUEUE_URL` | Full URL of the SQS queue | Required |
| `SQS_POLLING_INTERVAL_MS` | Polling interval in milliseconds | 10000 |
| `SQS_CONSUMER_ENABLED` | Enable/disable the consumer | true |

### Features

- **Bounce/Complaint Suppression**: Automatically suppress contacts that bounce or complain to protect sender reputation and reduce AWS penalty risk
- **Delivery Tracking**: Confirm successful email delivery and update contact status in real-time
- **Engagement Tracking**: Track opens and clicks for campaign analytics
- **Real-time Analytics**: Events are emitted to the event bus for immediate UI updates
- **Audit Trail**: All SES events are logged for compliance and debugging

### Database Tables

The SQS consumer uses two database tables:

#### ses_event_tracking
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| message_id | VARCHAR(255) | SES message ID |
| event_type | VARCHAR(50) | Type of event (bounce, complaint, delivery, etc.) |
| email | VARCHAR(255) | Recipient email address |
| event_data | JSONB | Full event payload |
| created_at | TIMESTAMP | Event timestamp |

#### contact_suppressions
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | VARCHAR(255) | Suppressed email address (unique) |
| reason | VARCHAR(50) | Suppression reason (bounce, complaint) |
| source | VARCHAR(100) | Source of suppression |
| created_at | TIMESTAMP | When suppressed |

### Event Processing Flow

1. **SES sends event**: When an email event occurs (bounce, delivery, etc.), SES generates an event
2. **SNS forwards**: The SES Configuration Set publishes to the SNS topic
3. **SQS receives**: SNS forwards the notification to the SQS queue
4. **Consumer polls**: The SQS consumer periodically polls for messages
5. **Event processing**: Messages are parsed, validated, and routed to handlers
6. **Database updates**: Handlers update contact status and create event records
7. **UI notification**: Events are emitted to the event bus for real-time UI updates

### Troubleshooting

**Queue URL not configured**
- Symptom: SQS consumer doesn't start
- Solution: Set `SQS_QUEUE_URL` in your environment file

**AWS permissions errors**
- Symptom: Access denied when polling SQS
- Solution: Ensure AWS credentials have `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and `sqs:GetQueueAttributes` permissions

**Message parsing errors**
- Symptom: Errors processing messages from SQS
- Solution: Verify SNS is configured to send raw message delivery, or check that the message format matches expected SNS notification structure

**Consumer not processing events**
- Symptom: Events occur in SES but aren't reflected in the application
- Solution: 
  - Check that `SQS_CONSUMER_ENABLED=true`
  - Verify the queue URL is correct and accessible
  - Ensure the SNS topic is properly subscribed to the SQS queue
  - Check that the SES Configuration Set is configured to publish to the correct SNS topic

## Scripts

| Command | Description |
|---------|-------------|
| `bun run start` | Start the application |
| `bun run dev` | Start in development mode |
| `bun run prod` | Start in production mode |
| `bun run db:init` | Initialize database schema |
| `bun run db:reset` | Reset database (development only) |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run lint` | Run Biome linter |
| `bun run lint:fix` | Fix linting issues automatically |
| `bun test` | Run all tests |
| `bun run scripts/verify-ses.ts` | Verify AWS SES configuration |
| `bun run scripts/verify-myemailverifier.ts` | Verify MyEmailVerifier API |

## Environment Modes

The application supports two environment modes:

- **Development**: Uses `.env.development` (or `.env.development.local`)
- **Production**: Uses `.env.production` (or `.env.production.local`)

Set `NODE_ENV` to switch modes:
```bash
NODE_ENV=production bun run start
```

## Security Considerations

### General Security
- All credentials are stored in environment variables
- No hardcoded secrets in source code
- Database uses parameterized queries (SQL injection safe)
- Input validation with Zod
- Audit logging of all operations
- Local-only execution (no network exposure)

### Path Validation
The application implements path validation to prevent path traversal attacks:
- All file paths are validated before use
- Path traversal sequences (`..`, `/`, `\`) are blocked
- Only relative paths within the project directory are allowed

### Template Generator Security
- Path validation prevents writing to arbitrary locations
- Overwrite protection prevents accidental file replacement
- User must explicitly provide file paths

### Database Reset Protection
The database reset feature includes multi-layered guardrails:
1. **Environment Check**: Blocked in production (`NODE_ENV=production`) unless `--force-production-reset` is used.
2. **Database Name Check**: Blocked if `DB_NAME` contains "prod" or "production" unless `--force-production-reset` is used.
3. **Explicit Confirmation**: Always requires the `--confirm-reset` flag (handled automatically by `db:reset:dev/prod` scripts).
4. **Interactive Safety**: The `db:reset` script is designed to fail early if safety conditions aren't met.

### Development Safety Controls
- `REDIRECT_EMAILS`: Redirect all emails to a test address in development
- `SIMULATE_VERIFIER`: Simulate email verification to save API credits
- `TEST_RECIPIENT_EMAIL`: Safe email address for testing

## Troubleshooting

### Verification Script Failures

If verification scripts fail:
1. Check that `.env.development.local` exists and is properly configured
2. Verify AWS credentials are correct and have SES permissions
3. Confirm MyEmailVerifier API key is valid and has credits
4. Check network connectivity to AWS and MyEmailVerifier APIs

### Database Connection Issues
- Verify PostgreSQL is running
- Check credentials in environment file
- Ensure database `termisend` exists

### Database Reset Fails
- Make sure you're in development mode (not production)
- Check that DB_NAME doesn't contain "prod"
- Use `--confirm-reset` flag or set `ALLOW_DEV_RESET=true`

### Template Generation Fails
- Check file path doesn't contain traversal sequences (`..`)
- Ensure you have write permissions to the target directory
- If file already exists, either delete it first or use a different path

### AWS SES Issues
- Verify sender email is verified in SES console
- Check if in sandbox mode (need to verify recipient emails too)
- Verify AWS credentials have SES permissions
- Run `bun run scripts/verify-ses.ts` for detailed diagnostics

### Email Verification Issues
- Check MyEmailVerifier API key is valid
- Verify API rate limits aren't exceeded
- Run `bun run scripts/verify-myemailverifier.ts` for diagnostics

### Excel Import Issues
- Ensure Excel file has headers: "Company Name", "Person Name", "Email"
- Check file path is correct
- Verify file is not corrupted
- Use the built-in template generator (press T) to ensure correct format

### Throttling Issues
- If sending is too slow, adjust `THROTTLE_MIN_DELAY_MS` and `THROTTLE_MAX_DELAY_MS`
- If hitting rate limits, ensure `SES_RATE_LIMIT_PER_SECOND` matches your SES quota
- Increase `SES_QUOTA_BUFFER_PERCENT` if you're approaching daily limits

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/unit/db-reset.test.ts

# Run tests with coverage
bun test --coverage
```

## License

MIT License - This is an internal tool for authorized use only.

## Support

For issues or questions, refer to the implementation plans in the `plans/` directory or contact the development team.
