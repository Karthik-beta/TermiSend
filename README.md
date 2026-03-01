# TermiSend - Local Email Outreach CLI

A local-only, terminal-based email outreach tool built with Bun, TypeScript, and Ink. Import contacts from Excel, verify emails, and send personalized campaigns via AWS SES - all from your terminal.

## Features

- 📥 **Excel Import**: Import contacts from Excel files with validation
- ✅ **Email Verification**: Verify emails via MyEmailVerifier API before sending
- 🎨 **Spintax Support**: Create dynamic email templates with spintax syntax
- 📝 **Markdown Templates**: Write emails in Markdown, rendered to HTML
- 🗄️ **Audit Logging**: Every action logged to PostgreSQL for compliance
- 🖥️ **Terminal UI**: Beautiful TUI built with Ink and React

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

### Importing Contacts (Part A)

1. Select "Import Excel Contacts" from the menu
2. Enter the path to your Excel file
3. The system will:
   - Parse the Excel file
   - Validate columns (Company Name, Person Name, Email)
   - Validate email format using Zod
   - Insert valid contacts into PostgreSQL
   - Log all actions to audit_logs

**Excel Format:**
| Company Name | Person Name | Email |
|--------------|-------------|-------|
| Acme Corp | John Doe | john@acme.com |
| Tech Inc | Jane Smith | jane@tech.com |

### Sending Email Campaigns (Part B)

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

## Project Structure

```
termisend/
├── src/
│   ├── index.tsx          # Entry point - mounts Ink UI
│   ├── ui.tsx             # Ink/React TUI components
│   ├── db.ts              # Database connection & schema init
│   ├── logger.ts          # Audit logging utility
│   ├── importer.ts        # Excel import logic (Part A)
│   ├── mailer.ts          # Spintax & markdown rendering (Part B)
│   ├── verifier.ts        # MyEmailVerifier API client
│   ├── ses.ts             # AWS SES integration
│   └── types.ts           # TypeScript type definitions
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
| `bun run typecheck` | Run TypeScript type checking |

## Environment Modes

The application supports two environment modes:

- **Development**: Uses `.env.development` (or `.env.development.local`)
- **Production**: Uses `.env.production` (or `.env.production.local`)

Set `NODE_ENV` to switch modes:
```bash
NODE_ENV=production bun run start
```

## Security Considerations

- All credentials are stored in environment variables
- No hardcoded secrets in source code
- Database uses parameterized queries (SQL injection safe)
- Input validation with Zod
- Audit logging of all operations
- Local-only execution (no network exposure)

## Troubleshooting

### Database Connection Issues
- Verify PostgreSQL is running
- Check credentials in environment file
- Ensure database `termisend` exists

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

## License

MIT License - This is an internal tool for authorized use only.

## Support

For issues or questions, refer to the implementation plan in `plans/implementation-plan.md` or contact the development team.
