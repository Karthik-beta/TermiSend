# **Product Design Document: Local Email Outreach CLI**

## **1\. Project Overview**

This project is a local-only, terminal-based internal tool built for data import and email outreach. It consists of a Terminal User Interface (TUI) and is divided into two primary operations:

* **Part A:** Importing contact data from an Excel sheet, validating it, and saving it to a local PostgreSQL database.  
* **Part B:** Parsing a markdown spintax file, verifying emails via the MyEmailVerifier API, and sending the rendered emails via AWS SES.  
* **Global Constraint:** Every input, output, API request, and third-party response must be logged into the database for auditing. The script will run exclusively on a local PC.

## **2\. Tech Stack & Exact Versions**

The AI Agent MUST strictly adhere to these specific library versions. For any unlisted dependencies, the latest stable version must be used.

* **Runtime:** Bun 1.3.10  
* **Language:** TypeScript 5.9.3  
* **Validation:** Zod 4.3.6  
* **Package Manager:** Bun  
* **Terminal UI:** Ink 6.8.0 (<https://github.com/vadimdemedes/ink.git>), along with React (latest stable compatible with Ink).  
* **Database Client:** postgres 3.4.8 (Extremely simple and fast Postgres client for JS/TS).  
* **Excel Parser:** exceljs 4.4.0  
* **AWS SES Client:** @aws-sdk/client-ses (Latest stable 3.x)  
* **Markdown Renderer:** marked (Latest stable)

## **3\. Environment Configuration**

The application must support two environments: development and production.

* Environment variables should be loaded from .env.development and .env.production based on a NODE\_ENV or BUN\_ENV flag.  
* Required variables: DB\_HOST, DB\_PORT, DB\_USER, DB\_PASS, DB\_NAME, AWS\_REGION, AWS\_ACCESS\_KEY\_ID, AWS\_SECRET\_ACCESS\_KEY, MYEMAILVERIFIER\_API\_KEY, SES\_FROM\_EMAIL.

## **4\. Database Schema Requirements**

The application requires a local PostgreSQL database with at least two tables. The AI should generate a simple initialization script or function to create these if they do not exist.  
**Table 1: contacts**

* id (UUID, Primary Key)  
* company\_name (String, Not Null)  
* person\_name (String, Not Null)  
* email (String, Unique, Not Null)  
* status (String, Default 'pending') \- Tracks if emailed or verified.  
* created\_at (Timestamp)

**Table 2: audit\_logs**

* id (UUID, Primary Key)  
* event\_type (String) \- e.g., 'USER\_INPUT', 'EXCEL\_IMPORT', 'API\_VERIFIER\_REQ', 'API\_VERIFIER\_RES', 'AWS\_SES\_REQ', 'AWS\_SES\_RES'.  
* payload (JSONB) \- Stores the exact input/output data.  
* created\_at (Timestamp)

## **5\. Part A: Excel Import & Validation**

**Objective:** Read an Excel file, validate data, and store it.

1. **File Input:** The user provides a file path via the Terminal UI.  
2. **Parsing:** Use exceljs to read the specific columns: "Company Name", "Person Name", "Email".  
3. **Validation:** Use Zod 4.3.6 to validate each row.  
   * Schema: { companyName: z.string().min(1), personName: z.string().min(1), email: z.string().email() }  
4. **Storage:** Insert valid rows into the contacts table. Skip or log invalid rows.  
5. **Logging:** Log the start of the import, the file path, and the final result (success/fail count) to the audit\_logs table.

## **6\. Part B: Email Rendering, Verification & Sending**

**Objective:** Read a template, verify emails, render spintax, and send via AWS SES.

1. **Spintax Parsing:** The user provides a markdown file containing spintax (e.g., {Hello|Hi|Hey} {Person Name}, ...). The script must parse the spintax to generate a unique variation of the text.  
2. **Markdown Rendering:** Convert the spun markdown into valid HTML for the email body using marked.  
3. **Email Verification (MyEmailVerifier):**  
   * Before sending, call the MyEmailVerifier API for the target email.  
   * Log the exact Request and Response to audit\_logs.  
   * Proceed ONLY if the response indicates the email is "low risk" or "valid".  
4. **AWS SES Integration:**  
   * Use @aws-sdk/client-ses to send the rendered HTML email.  
   * Log the exact SES Request parameters and the SES Response (MessageId) to audit\_logs.  
   * Update the contacts table status to 'sent'.

### B.3 Email Throttling & Rate Limiting

To ensure responsible email sending and protect sender reputation, TermiSend implements comprehensive throttling that integrates with AWS SES constraints.

#### Throttling Architecture

The throttling system consists of three layers:

1. **Inter-Email Delays**: Bounded random delays between 60-120 seconds to simulate human sending patterns
2. **Break Periods**: Random 3-5 minute pauses (5-10% probability) to further humanize sending
3. **SES Rate Limiting**: Token bucket algorithm ensuring compliance with SES max send rate
4. **Quota Monitoring**: Automatic pause when approaching daily sending limits

#### Delay Calculation

**Base Delay**:
- Minimum: 60,000 ms (1 minute)
- Maximum: 120,000 ms (2 minutes)
- Distribution: Bounded uniform random (Math.random())
- Mathematical guarantee: No outliers possible

**Break Modifier** (Optional):
- Probability: 5-10% (configurable)
- Duration: 3-5 minutes (bounded uniform random)
- Adds to base delay when triggered

**Total Delay Formula**:
```
totalDelay = max(60000, baseDelay + (breakTriggered ? breakDuration : 0))
```

#### Configuration Options

All throttling parameters are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `THROTTLE_MIN_DELAY_MS` | 60000 | Minimum delay between emails (ms) |
| `THROTTLE_MAX_DELAY_MS` | 120000 | Maximum delay between emails (ms) |
| `THROTTLE_BREAK_PROBABILITY_PERCENT` | 5 | Probability of break (0-100) |
| `THROTTLE_BREAK_MIN_MINUTES` | 3 | Minimum break duration (minutes) |
| `THROTTLE_BREAK_MAX_MINUTES` | 5 | Maximum break duration (minutes) |
| `SES_RATE_LIMIT_PER_SECOND` | 14 | SES max send rate (tokens/sec) |
| `SES_QUOTA_BUFFER_PERCENT` | 10 | Safety buffer before quota exhaustion |

#### SES Safety Considerations

**Rate Limiting**:
- Token bucket algorithm prevents exceeding SES max send rate
- Each email send acquires a token; tokens refill over time
- Prevents burst sending that could trigger SES throttling

**Quota Monitoring**:
- Periodically checks SES account send quota (every 5 minutes)
- Automatically pauses when approaching daily limit
- Respects configurable buffer percentage (default: 10%)
- Graceful degradation: allows sending if quota check fails

**Expected Throughput**:
- With default settings: ~40-50 emails/hour
- With break triggered: ~30-35 emails/hour
- Well within typical SES sandbox limits (14/sec, 200/day)

#### Example Configuration

```bash
# Conservative settings for new domains
THROTTLE_MIN_DELAY_MS=90000
THROTTLE_MAX_DELAY_MS=180000
THROTTLE_BREAK_PROBABILITY_PERCENT=10
THROTTLE_BREAK_MIN_MINUTES=5
THROTTLE_BREAK_MAX_MINUTES=10
SES_RATE_LIMIT_PER_SECOND=1
SES_QUOTA_BUFFER_PERCENT=20
```

#### Implementation Details

**Files**:
- `src/throttle.ts` - Core throttling logic (delay calculator, rate limiter, quota monitor)
- `src/mailer.ts` - Integration point (waits before each email)
- `src/ses.ts` - Rate limiting wrapper around SES sends
- `src/types.ts` - TypeScript interfaces for configuration

**Logging**:
Every throttling event is logged with structured data:
- Delay calculations (base, break, total)
- Rate limit waits
- Quota pauses and resumes

**Testing**:
Comprehensive unit tests validate:
- Delay bounds (always 60s+)
- Statistical correctness of break probability
- Rate limiter behavior
- Quota monitoring logic

## **7\. Architecture & File Structure Requirements**

The codebase must be strictly modular, type-safe, and well-documented. Each major domain must reside in its own file.

* index.tsx: The main entry point mounting the Ink UI.  
* ui.tsx: Contains the Ink components, managing user steps (Part A vs Part B).  
* db.ts: Database connection setup and schema initialization using postgres.  
* logger.ts: A dedicated utility for writing all inputs/outputs to the audit\_logs table.  
* importer.ts: Logic for Part A (Excel reading, Zod validation, saving to DB).  
* mailer.ts: Logic for Part B (Spintax parsing, markdown rendering).  
* verifier.ts: Logic for calling the MyEmailVerifier API.  
* ses.ts: Logic for AWS SES integration.

## **8\. Specific Instructions for the AI Agent**

1. **Extreme Simplicity:** Do not over-engineer. Use straightforward functions and explicit type definitions. No complex state management libraries like Redux; use React's built-in useState and useEffect for the Ink UI.  
2. **Type Safety:** Define exact TypeScript interfaces for DB rows, API responses, and function parameters.  
3. **Logging Rule:** Do not use console.log for core operational tracking. Everything must go through a logger.logEvent(type, payload) function which writes to PostgreSQL.  
4. **Error Handling:** Wrap API calls and DB queries in try/catch blocks. Surface errors gracefully in the Ink UI in red text without crashing the process.  
5. **No Deployment:** Do not add Dockerfiles, CI/CD pipelines, or deployment scripts. This is strictly a local Bun script.
