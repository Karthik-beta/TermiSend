# Phase 1 - Comprehensive Codebase Analysis for Analytics Layer Design

## Executive Summary

This document provides a comprehensive analysis of the TermiSend email outreach tool codebase to understand the execution flows, state transitions, and implicit domain events that will inform the design of an event-driven analytics layer.

## 1. Execution Flow Analysis

### 1.1 Contact Import Flow (src/importer.ts)

**Entry Point:** [`importExcelFile()`](src/importer.ts:174)

**Flow Sequence:**
1. **Path Validation** ([`validateImportPath()`](src/importer.ts:189))
   - Security check to prevent directory traversal
   - Returns sanitized path

2. **File Reading** ([`readFile()`](src/importer.ts:199))
   - Validates file existence
   - Uses ExcelJS to parse workbook

3. **Header Validation** ([`headerStrings`](src/importer.ts:219))
   - Validates required columns: 'Company Name', 'Person Name', 'Email'
   - Throws error if missing columns

4. **Row Processing Loop** ([`processRow()`](src/importer.ts:235))
   - For each row (2 to worksheet.rowCount):
   - **Data Normalization** ([`normalizeRow()`](src/importer.ts:110))
   - **Validation** ([`validateRow()`](src/importer.ts:118))
   - **Duplicate Check** (file-internal) ([`seenEmails.has()`](src/importer.ts:132))
   - **Database Insert** ([`insertContactSkipDuplicate()`](src/importer.ts:141))

5. **Audit Logging** (throughout):
   - [`logExcelImportStart()`](src/importer.ts:232)
   - [`logExcelImportRowValid()`](src/importer.ts:153)
   - [`logExcelImportRowInvalid()`](src/importer.ts:126)
   - [`logExcelImportComplete()`](src/importer.ts:240)

**Key Decision Points:**
- Skip empty rows ([`row.values === null`](src/importer.ts:100))
- Skip file-internal duplicates ([`seenEmails.has()`](src/importer.ts:132))
- Skip database duplicates via [`insertContactSkipDuplicate()`](src/importer.ts:141)

### 1.2 Email Verification Flow (src/verifier.ts)

**Entry Point:** [`verifyEmail()`](src/verifier.ts:140)

**Flow Sequence:**
1. **Format Validation** ([`validateEmailFormat()`](src/verifier.ts:142))
   - Pre-check before API call
   - Throws [`EmailValidationError`](src/verifier.ts:144) if invalid

2. **Rate Limiting Check** ([`verificationRateLimiter.checkLimit()`](src/verifier.ts:148))
   - Per-email rate limiting (1 request per 5 seconds)
   - Throws [`RateLimitError`](src/verifier.ts:150) if exceeded

3. **Simulation Mode** ([`shouldSimulateVerifier()`](src/verifier.ts:154))
   - Development mode with mock responses
   - [`simulateVerifyEmail()`](src/verifier.ts:103)

4. **API Call** ([`fetch()`](src/verifier.ts:173))
   - GET request to MyEmailVerifier API
   - Headers: Accept, X-API-Key

5. **Response Validation** ([`validateEmailVerificationResponse()`](src/verifier.ts:190))
   - Security validation with Zod schema
   - Prevents blind type casts

6. **Credits Sync** ([`syncCreditsAfterVerification()`](src/verifier.ts:200))
   - Fire-and-forget operation
   - Updates credits in database

**Audit Logging:**
- [`logApiVerifierRequest()`](src/verifier.ts:167)
- [`logApiVerifierResponse()`](src/verifier.ts:194)

**Error Handling:**
- API errors logged with redacted email ([`redactEmail()`](src/verifier.ts:211))
- Credits update failures tracked with retry limit ([`MAX_CREDITS_UPDATE_RETRIES`](src/verifier.ts:37))

### 1.3 Email Sending Flow (src/mailer.ts, src/ses.ts)

**Entry Point:** [`runCampaign()`](src/mailer.ts:629)

**Flow Sequence:**

#### Campaign Level ([`runCampaign()`](src/mailer.ts:629))
1. **Template Path Validation** ([`validateTemplatePath()`](src/mailer.ts:643))
2. **Get Eligible Contacts** ([`getEligibleContacts()`](src/mailer.ts:653))
3. **Quota Check** ([`throttleController.checkQuota()`](src/mailer.ts:661))
4. **Template Reading** ([`readFile()`](src/mailer.ts:681))
5. **Contact Processing Loop** ([`processContact()`](src/mailer.ts:687))

#### Contact Level ([`processContact()`](src/mailer.ts:471))
1. **Template Processing** ([`processTemplate()`](src/mailer.ts:485))
   - Placeholder replacement
   - Spintax parsing ([`parseSpintax()`](src/mailer.ts:174))
   - Subject/body extraction ([`extractSubject()`](src/mailer.ts:486))

2. **Send Log Creation** ([`createSendLog()`](src/mailer.ts:493))
   - Status: 'pending'
   - Mode: 'production' or 'dry_run'

3. **Email Verification** ([`verifyContactEmail()`](src/mailer.ts:505))
   - Calls [`verifyEmail()`](src/verifier.ts:140)
   - Updates send log on failure

4. **Safety Check** ([`isEmailSafe()`](src/mailer.ts:518))
   - Skips unsafe emails
   - Updates send log to 'skipped'

5. **Throttling Wait** ([`throttleController.waitBeforeSend()`](src/mailer.ts:539))
   - Rate limiting delay
   - Progress callbacks during wait

6. **Dry Run Handling** ([`handleDryRun()`](src/mailer.ts:555))
   - Marks as 'sent' without actual sending

7. **Email Rendering** ([`renderMarkdown()`](src/mailer.ts:575))
   - HTML generation
   - Plain text generation ([`generatePlainText()`](src/mailer.ts:576))

8. **Email Sending** ([`sendEmail()`](src/mailer.ts:586))
   - Calls SES API
   - Handles success/failure

#### SES Level ([`sendEmail()`](src/ses.ts:191))
1. **Configuration Check** ([`getSESFromEmail()`](src/ses.ts:197))
2. **Environment Redirection** ([`shouldRedirectEmails()`](src/ses.ts:210))
3. **Command Construction** ([`constructSendEmailInput()`](src/ses.ts:222))
4. **Send with Retry** ([`sendWithRetry()`](src/ses.ts:130))
   - Quota check ([`controller.checkQuota()`](src/ses.ts:139))
   - Rate limit acquire ([`controller.acquireSendPermission()`](src/ses.ts:144))
   - SES API call ([`sesClient.send()`](src/ses.ts:151))
   - Retry logic for throttling errors

**State Transitions:**
- 'pending' → 'sent' ([`handleSuccessfulSend()`](src/mailer.ts:352))
- 'pending' → 'failed' ([`handleFailedSend()`](src/mailer.ts:391))
- 'pending' → 'skipped' ([`handleUnsafeEmail()`](src/mailer.ts:297))

**Analytics Events:**
- [`analyticsEvents.emit('SEND')`](src/mailer.ts:377)
- [`analyticsEvents.emit('FAILURE')`](src/mailer.ts:415)

### 1.4 Throttling Logic Flow (src/throttle.ts)

**Entry Point:** [`EmailThrottleController`](src/throttle.ts:464)

**Components:**

#### Delay Calculator ([`calculateDelay()`](src/throttle.ts:44))
1. **Base Delay Calculation** (uniform distribution)
2. **Break Probability** ([`Math.random() < config.breakProbabilityPercent`](src/throttle.ts:50))
3. **Break Duration** (random within bounds)
4. **Logging** ([`logger.info()`](src/throttle.ts:61))

#### Token Bucket Rate Limiter ([`TokenBucketRateLimiter`](src/throttle.ts:125))
1. **Token Acquisition** ([`acquire()`](src/throttle.ts:220))
   - Queue management
   - Refill calculation ([`refill()`](src/throttle.ts:158))
2. **Token Release** ([`release()`](src/throttle.ts:248))
3. **Queue Processing** ([`processQueue()`](src/throttle.ts:178))

#### Quota Monitor ([`QuotaMonitor`](src/throttle.ts:285))
1. **Quota Fetching** ([`fetchQuotaStatus()`](src/throttle.ts:308))
   - Calls [`getAccountInfo()`](src/ses-quota.ts:101)
2. **Circuit Breaker** ([`consecutiveFailures`](src/throttle.ts:402))
3. **Quota Check** ([`checkQuota()`](src/throttle.ts:352))
   - Buffer percentage calculation
   - Fail-closed behavior

#### Main Controller ([`EmailThrottleController`](src/throttle.ts:464))
1. **Wait Before Send** ([`waitBeforeSend()`](src/throttle.ts:531))
   - Progress callbacks
   - Delay execution
2. **Send Permission** ([`acquireSendPermission()`](src/throttle.ts:583))
3. **Quota Status** ([`checkQuota()`](src/throttle.ts:604))

## 2. External API Call Locations

### 2.1 MyEmailVerifier API (src/verifier.ts)

**Endpoints:**
- **Email Verification:** `https://api.myemailverifier.com/v1/verify`
  - Location: [`verifyEmail()`](src/verifier.ts:169)
  - Method: GET
  - Authentication: X-API-Key header

- **Credits Check:** `https://client.myemailverifier.com/verifier/getcredits/{apiKey}`
  - Location: [`fetchVerifierCredits()`](src/verifier.ts:238)
  - Method: GET
  - Called after each verification (fire-and-forget)

**Rate Limiting:**
- 1 request per 5 seconds per email ([`verificationRateLimiter`](src/verifier.ts:28))
- Retry on rate limit with [`RateLimitError`](src/verifier.ts:76)

### 2.2 AWS SES API (src/ses.ts, src/ses-analytics.ts)

**Email Sending:**
- **SendEmail:** [`sesClient.send(new SendEmailCommand(input))`](src/ses.ts:151)
  - Location: [`sendWithRetry()`](src/ses.ts:151)
  - Retry logic for throttling errors

**Analytics APIs:**
- **GetSendQuota:** [`fetchQuotaSnapshot()`](src/ses-analytics.ts:263)
- **GetSendStatistics:** [`fetchSendStatistics()`](src/ses-analytics.ts:323)
- **ListIdentities:** [`fetchIdentityStatuses()`](src/ses-analytics.ts:398)
- **GetIdentityVerificationAttributes:** [`fetchIdentityStatuses()`](src/ses-analytics.ts:430)

**Rate Limiting:**
- 1 request per second for analytics APIs ([`AnalyticsRateLimiter`](src/ses-analytics.ts:193))
- Exponential backoff for retries ([`isRetryableError()`](src/ses-analytics.ts:233))

## 3. State Transition Points

### 3.1 Send Log State Transitions (src/mailer.ts)

**Initial State:** 'pending' ([`createSendLog()`](src/mailer.ts:493))

**Transitions:**
1. **'pending' → 'sent'**
   - Location: [`handleSuccessfulSend()`](src/mailer.ts:366)
   - Trigger: Successful SES send
   - Data: messageId, sentAt

2. **'pending' → 'failed'**
   - Location: [`handleFailedSend()`](src/mailer.ts:405)
   - Trigger: SES send error or verification error
   - Data: errorReason

3. **'pending' → 'skipped'**
   - Location: [`handleUnsafeEmail()`](src/mailer.ts:310)
   - Trigger: Email verification failed (unsafe)
   - Data: errorReason

4. **'pending' → 'sent' (Dry Run)**
   - Location: [`handleDryRun()`](src/mailer.ts:337)
   - Trigger: Dry run mode
   - Data: No actual send

### 3.2 Database State Changes (src/db.ts)

**Contact States:**
- **Insert:** [`insertContact()`](src/db.ts:329) or [`insertContactSkipDuplicate()`](src/db.ts:349)
- **Query:** [`getEligibleContacts()`](src/db.ts:381) (no successful send log)

**Send Log States:**
- **Create:** [`createSendLog()`](src/db.ts:427)
- **Update:** [`updateSendLog()`](src/db.ts:445)

**Analytics States:**
- **Quota Snapshots:** [`createQuotaSnapshot()`](src/db.ts:783)
- **Send Statistics:** [`createSendStatistics()`](src/db.ts:843)
- **Message Events:** [`createMessageEvent()`](src/db.ts:955)

## 4. Audit Log Writing Locations

### 4.1 Logger Implementation (src/logger.ts)

**Core Method:** [`logEvent()`](src/logger.ts:61)
- Writes to [`audit_logs`](src/db.ts:196) table
- Serializes payload with [`serializePayload()`](src/db.ts:553)

### 4.2 Specific Audit Log Events

**Import Events:**
- [`logExcelImportStart()`](src/logger.ts:91) - 'EXCEL_IMPORT_START'
- [`logExcelImportRowValid()`](src/logger.ts:102) - 'EXCEL_IMPORT_ROW_VALID'
- [`logExcelImportRowInvalid()`](src/logger.ts:116) - 'EXCEL_IMPORT_ROW_INVALID'
- [`logExcelImportComplete()`](src/logger.ts:135) - 'EXCEL_IMPORT_COMPLETE'

**API Events:**
- [`logApiVerifierRequest()`](src/logger.ts:152) - 'API_VERIFIER_REQ'
- [`logApiVerifierResponse()`](src/logger.ts:163) - 'API_VERIFIER_RES'
- [`logAwsSesRequest()`](src/logger.ts:174) - 'AWS_SES_REQ'
- [`logAwsSesResponse()`](src/logger.ts:190) - 'AWS_SES_RES'

**State Change Events:**
- [`logSendLogUpdated()`](src/logger.ts:201) - 'SEND_LOG_UPDATED'
- [`logContactUpdated()`](src/logger.ts:75) - 'CONTACT_UPDATED' (not implemented)

**Error Events:**
- [`logError()`](src/logger.ts:221) - 'ERROR'
- [`info()`](src/logger.ts:247) - 'USER_INPUT' (info level)
- [`warn()`](src/logger.ts:258) - 'ERROR' (warn level)

## 5. Implicit Domain Events

### 5.1 Already Present (Explicit)

**From src/types.ts (lines 65-78):**
- 'USER_INPUT'
- 'EXCEL_IMPORT_START'
- 'EXCEL_IMPORT_ROW_VALID'
- 'EXCEL_IMPORT_ROW_INVALID'
- 'EXCEL_IMPORT_COMPLETE'
- 'API_VERIFIER_REQ'
- 'API_VERIFIER_RES'
- 'AWS_SES_REQ'
- 'AWS_SES_RES'
- 'CONTACT_UPDATED'
- 'SEND_LOG_CREATED'
- 'SEND_LOG_UPDATED'
- 'ERROR'

**Analytics Events (src/ses-analytics.ts):**
- 'SEND' - Email sent successfully
- 'DELIVERY' - Email delivered (not implemented)
- 'BOUNCE' - Email bounced (not implemented)
- 'COMPLAINT' - Email complaint (not implemented)
- 'REJECT' - Email rejected (not implemented)
- 'FAILURE' - Send failed

### 5.2 Implicit Events Not Explicitly Modeled

**Contact Lifecycle:**
1. **CONTACT_CREATED** - When new contact inserted
2. **CONTACT_DUPLICATE_SKIPPED** - When duplicate found during import
3. **CONTACT_ELIGIBLE_FOR_SENDING** - When contact qualifies for campaign

**Verification Events:**
1. **VERIFICATION_STARTED** - Before verification API call
2. **VERIFICATION_SUCCEEDED** - After successful verification
3. **VERIFICATION_FAILED** - After failed verification
4. **VERIFICATION_SKIPPED** - When verification bypassed (test mode)
5. **EMAIL_DEEMED_UNSAFE** - When email fails safety check

**Throttling Events:**
1. **THROTTLE_DELAY_STARTED** - When delay begins
2. **THROTTLE_BREAK_TRIGGERED** - When random break starts
3. **THROTTLE_DELAY_COMPLETED** - When delay ends
4. **RATE_LIMIT_ACQUIRED** - When rate limit permission granted
5. **RATE_LIMIT_RELEASED** - When rate limit permission released
6. **QUOTA_CHECK_PASSED** - When quota allows sending
7. **QUOTA_CHECK_FAILED** - When quota blocks sending
8. **QUOTA_REFRESHED** - When quota data updated from API

**Campaign Events:**
1. **CAMPAIGN_STARTED** - When campaign begins
2. **CAMPAIGN_CONTACT_STARTED** - When processing a contact
3. **CAMPAIGN_CONTACT_COMPLETED** - When contact processing finished
4. **CAMPAIGN_PAUSED** - When campaign paused (quota exhaustion)
5. **CAMPAIGN_COMPLETED** - When campaign finished
6. **CAMPAIGN_FAILED** - When campaign aborted

**Template Events:**
1. **TEMPLATE_PROCESSED** - When template rendered for contact
2. **SPINTAX_PARSED** - When spintax variations generated
3. **MARKDOWN_RENDERED** - When markdown converted to HTML

**Error Recovery Events:**
1. **RETRY_ATTEMPTED** - When retry initiated
2. **RETRY_SUCCEEDED** - When retry succeeds
3. **RETRY_FAILED** - When all retries exhausted
4. **CIRCUIT_BREAKER_OPENED** - When circuit breaker triggers
5. **CIRCUIT_BREAKER_CLOSED** - When circuit breaker resets

**Credits Events:**
1. **CREDITS_CHECKED** - When credits fetched
2. **CREDITS_UPDATED** - When credits stored in database
3. **CREDITS_LOW** - When credits below threshold
4. **CREDITS_EXHAUSTED** - When credits reach zero

## 6. Current Database Schema

### 6.1 Core Tables

**contacts** (lines 149-157)
```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  person_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**send_logs** (lines 165-179)
```sql
CREATE TABLE send_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id UUID,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  mode VARCHAR(50) NOT NULL DEFAULT 'production',
  subject VARCHAR(500) NOT NULL,
  body_preview VARCHAR(500) NOT NULL,
  error_reason TEXT,
  message_id VARCHAR(255),
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**audit_logs** (lines 196-203)
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 6.2 Analytics Tables

**ses_quota_snapshots** (lines 229-238)
```sql
CREATE TABLE ses_quota_snapshots (
  id SERIAL PRIMARY KEY,
  max_24_hour_send DOUBLE PRECISION NOT NULL,
  sent_last_24_hours DOUBLE PRECISION NOT NULL,
  max_send_rate DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'api'
)
```

**ses_send_statistics** (lines 246-256)
```sql
CREATE TABLE ses_send_statistics (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL UNIQUE,
  delivery_attempts BIGINT NOT NULL DEFAULT 0,
  bounces BIGINT NOT NULL DEFAULT 0,
  complaints BIGINT NOT NULL DEFAULT 0,
  rejects BIGINT NOT NULL DEFAULT 0,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)
```

**ses_identity_status** (lines 264-273)
```sql
CREATE TABLE ses_identity_status (
  id SERIAL PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  verification_status TEXT NOT NULL DEFAULT 'NotStarted',
  dkim_enabled BOOLEAN DEFAULT FALSE,
  dkim_verification_status TEXT,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)
```

**ses_message_events** (lines 281-292)
```sql
CREATE TABLE ses_message_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  message_id TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  send_log_id UUID REFERENCES send_logs(id) ON DELETE SET NULL,
  event_data JSONB DEFAULT '{}',
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)
```

### 6.3 Supporting Tables

**email_verifier_credits** (lines 216-222)
```sql
CREATE TABLE email_verifier_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

## 7. Existing Analytics Infrastructure

### 7.1 Event System (src/ses-analytics.ts)

**AnalyticsEventEmitter** (lines 70-147)
- Internal event emitter for analytics
- Event persistence to database
- Handler error isolation

**Event Types** (from src/types.ts:344)
```typescript
export type AnalyticsEventType = 'SEND' | 'DELIVERY' | 'BOUNCE' | 'COMPLAINT' | 'REJECT' | 'FAILURE';
```

**Event Emission Points:**
- [`analyticsEvents.emit('SEND')`](src/mailer.ts:377) - Successful send
- [`analyticsEvents.emit('FAILURE')`](src/mailer.ts:415) - Send failure

### 7.2 API Data Collection

**Rate-Limited Fetchers:**
- [`fetchQuotaSnapshot()`](src/ses-analytics.ts:263) - GetSendQuota API
- [`fetchSendStatistics()`](src/ses-analytics.ts:323) - GetSendStatistics API
- [`fetchIdentityStatuses()`](src/ses-analytics.ts:398) - ListIdentities + GetIdentityVerificationAttributes APIs

**Storage Functions:**
- [`storeQuotaSnapshot()`](src/ses-analytics.ts:493)
- [`storeSendStatistics()`](src/ses-analytics.ts:509)
- [`storeIdentityStatuses()`](src/ses-analytics.ts:529)

### 7.3 Sync Coordinator

**syncAllAnalytics()** (lines 568-616)
- Coordinates multiple API calls
- Respects rate limits
- Returns sync result with counts

### 7.4 Caching Layer

**Cache Utilities:**
- [`getQuotaSnapshotCached()`](src/ses-analytics.ts:627) - 5-minute cache
- [`getSendStatisticsCached()`](src/ses-analytics.ts:659) - Database cache

## 8. Analytics Gaps Identified

### 8.1 Missing Event Implementations

**SES Event Types Not Implemented:**
- 'DELIVERY' - Email delivered to recipient
- 'BOUNCE' - Email bounced back
- 'COMPLAINT' - Recipient marked as spam
- 'REJECT' - SES rejected the email

**Domain Events Not Captured:**
- Contact lifecycle events (created, duplicate, eligible)
- Verification lifecycle events (started, succeeded, failed)
- Throttling events (delays, breaks, quota checks)
- Campaign lifecycle events (started, paused, completed)
- Template processing events (spintax, markdown rendering)
- Error recovery events (retries, circuit breaker)
- Credits tracking events

### 8.2 Missing Analytics Data Points

**Contact-Level Analytics:**
- Verification status distribution
- Import success/failure rates
- Duplicate detection rates

**Campaign-Level Analytics:**
- Campaign duration metrics
- Contact processing rates
- Template performance metrics

**Throttling Analytics:**
- Delay distribution statistics
- Break frequency and duration
- Quota utilization trends
- Rate limiting behavior

**Error Analytics:**
- Error categorization and frequency
- Retry success rates
- Circuit breaker triggers
- API failure patterns

**Performance Analytics:**
- API response times
- Database query performance
- Memory usage patterns
- Concurrent processing metrics

## 9. Recommended Domain Events to Implement

### 9.1 High Priority Events

**Contact Events:**
```typescript
'CONTACT_CREATED'      // New contact added to database
'CONTACT_DUPLICATE_SKIPPED'  // Duplicate found during import
'CONTACT_VERIFICATION_STARTED'  // Email verification initiated
'CONTACT_VERIFICATION_SUCCEEDED'  // Email verified successfully
'CONTACT_VERIFICATION_FAILED'  // Email verification failed
'CONTACT_DEEMED_UNSAFE'  // Email marked unsafe for sending
```

**Campaign Events:**
```typescript
'CAMPAIGN_STARTED'     // Campaign execution began
'CAMPAIGN_CONTACT_STARTED'  // Processing individual contact
'CAMPAIGN_CONTACT_COMPLETED'  // Finished processing contact
'CAMPAIGN_PAUSED'      // Campaign paused (quota exhaustion)
'CAMPAIGN_COMPLETED'   // All contacts processed
'CAMPAIGN_FAILED'      // Campaign aborted due to error
```

**Throttling Events:**
```typescript
'THROTTLE_DELAY_STARTED'  // Delay between sends initiated
'THROTTLE_BREAK_TRIGGERED'  // Random break triggered
'QUOTA_CHECK_PASSED'  // Quota allows sending
'QUOTA_CHECK_FAILED'  // Quota blocks sending
'RATE_LIMIT_ACQUIRED'  // Rate limit permission granted
'RATE_LIMIT_RELEASED'  // Rate limit permission released
```

### 9.2 Medium Priority Events

**Template Events:**
```typescript
'TEMPLATE_PROCESSED'  // Template rendered for contact
'SPINTAX_PARSED'      // Spintax variations generated
'MARKDOWN_RENDERED'   // Markdown converted to HTML
```

**Error Recovery Events:**
```typescript
'RETRY_ATTEMPTED'     // Retry initiated for failed operation
'RETRY_SUCCEEDED'     // Retry operation succeeded
'CIRCUIT_BREAKER_OPENED'  // Circuit breaker triggered
'CIRCUIT_BREAKER_CLOSED'  // Circuit breaker reset
```

**Credits Events:**
```typescript
'CREDITS_UPDATED'      // Credits balance updated
'CREDITS_LOW'         // Credits below warning threshold
'CREDITS_EXHAUSTED'   // Credits depleted
```

### 9.3 Implementation Strategy

1. **Phase 1:** Implement high-priority events for core business flows
2. **Phase 2:** Add medium-priority events for operational visibility
3. **Phase 3:** Enhance with low-level performance and debugging events

**Event Schema Recommendations:**
- Standardize event payload structure
- Include correlation IDs for event chains
- Add timestamps for event ordering
- Include context data (user, session, environment)

## 10. Technical Considerations

### 10.1 Event Storage

**Current Infrastructure:**
- [`ses_message_events`](src/db.ts:281) table exists for event storage
- [`createMessageEvent()`](src/db.ts:955) function for event insertion
- [`getMessageEvents()`](src/db.ts:1004) for event querying

**Recommendations:**
- Extend existing event table for new event types
- Add indexes for efficient event querying
- Implement event retention policies
- Consider event partitioning for large datasets

### 10.2 Event Processing

**Current Pattern:**
- Event emission via [`analyticsEvents.emit()`](src/ses-analytics.ts:162)
- Immediate persistence to database
- Handler error isolation

**Enhancements:**
- Add event batching for high-volume scenarios
- Implement async event processing queues
- Add event replay capabilities
- Consider event streaming for real-time analytics

### 10.3 Performance Impact

**Considerations:**
- Event logging should not block main flows
- Database writes should be optimized
- Event processing should be fault-tolerant
- Monitor event system performance

**Mitigation Strategies:**
- Use fire-and-forget patterns for non-critical events
- Implement event batching and bulk inserts
- Add circuit breakers for event systems
- Monitor and alert on event system failures

## 11. Conclusion

The TermiSend codebase has a solid foundation for implementing an event-driven analytics layer. Key findings:

1. **Existing Infrastructure:** Already has event emission, storage, and basic analytics collection
2. **Clear Execution Flows:** Well-defined flows for import, verification, and sending
3. **State Management:** Comprehensive state tracking in send_logs table
4. **Audit Logging:** Extensive audit logging throughout the application
5. **Analytics Gaps:** Missing many domain events that would provide valuable insights

**Next Steps:**
1. Implement the recommended high-priority domain events
2. Extend the existing event infrastructure
3. Add analytics dashboards for the new event data
4. Implement event retention and archival policies
5. Add monitoring and alerting for the event system

The existing codebase provides an excellent foundation for building a comprehensive event-driven analytics system that will provide deep insights into the email outreach tool's operations and performance.