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

## Tech Stack

- **Runtime**: Bun 1.3.10
- **Language**: TypeScript 5.9.3
- **UI**: Ink 6.8.0 + React 19
- **Database**: PostgreSQL with `postgres` client
- **Validation**: Zod 4.3.6
- **Excel**: exceljs 4.4.0
- **AWS**: @aws-sdk/client-ses
- **Markdown**: marked

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

   Edit the `.env.*.local` file with your credentials:
   ```env
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASS=your_password
   DB_NAME=termisend

   # AWS SES Configuration
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key_id
   AWS_SECRET_ACCESS_KEY=your_secret_access_key
   SES_FROM_EMAIL=noreply@yourdomain.com

   # MyEmailVerifier API Configuration
   MYEMAILVERIFIER_API_KEY=your_api_key
   ```

4. **Initialize the database**
   ```bash
   bun run db:init
   ```

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

### Database Reset (Development Only)

Reset the database to a clean state during development:

```bash
# Using CLI flag
bun run db:reset --confirm-reset

# Or using shorthand
bun run db:reset -y

# Or using environment variable
ALLOW_DEV_RESET=true bun run db:reset
```

**⚠️ Security Notice:**
- The database reset feature is **only available in development environments**
- It will **not work** in production (NODE_ENV=production)
- It will **not work** if DB_NAME contains "prod" or "production"
- Always confirm before running to avoid accidental data loss

## Database Commands

| Command | Description |
|---------|-------------|
| `bun run db:init` | Initialize database schema (create tables) |
| `bun run db:reset` | Reset database (delete all data) - DEV ONLY |

## Project Structure

```
termisend/
├── src/
│   ├── index.tsx          # Entry point - mounts Ink UI
│   ├── ui.tsx             # Ink/React TUI components
│   ├── db.ts              # Database connection, schema init, and reset
│   ├── logger.ts         # Audit logging utility
│   ├── importer.ts       # Excel import logic
│   ├── template-generator.ts  # Excel template generator
│   ├── mailer.ts          # Spintax & markdown rendering
│   ├── verifier.ts        # MyEmailVerifier API client
│   ├── ses.ts             # AWS SES integration
│   ├── path-validator.ts # Path validation for security
│   └── types.ts           # TypeScript type definitions
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
The database reset feature includes multiple guardrails:
1. **Environment Check**: Blocked in production (NODE_ENV=production)
2. **Database Name Check**: Blocked if DB_NAME contains "prod" or "production"
3. **Explicit Confirmation**: Requires `--confirm-reset` flag or `ALLOW_DEV_RESET=true`

**This makes it impossible to accidentally reset a production database.**

## Troubleshooting

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

### Email Verification Issues
- Check MyEmailVerifier API key is valid
- Verify API rate limits aren't exceeded

### Excel Import Issues
- Ensure Excel file has headers: "Company Name", "Person Name", "Email"
- Check file path is correct
- Verify file is not corrupted
- Use the built-in template generator (press T) to ensure correct format

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
