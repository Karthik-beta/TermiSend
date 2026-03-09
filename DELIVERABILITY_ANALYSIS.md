# Email Deliverability Analysis Report

## 1. AWS SES Deliverability Best Practices Summary

Based on official AWS SES documentation and industry standards:

| Practice | Description |
|----------|-------------|
| **Authentication** | SPF, DKIM, DMARC must be correctly configured and aligned |
| **From Address** | Use branded domain with display name (RFC 5322), avoid no-reply |
| **List-Unsubscribe** | Required header for bulk senders — Gmail expects `List-Unsubscribe` and `List-Unsubscribe-Post` |
| **Content** | Favor plain/conversational tone over marketing HTML layouts |
| **HTML-to-Text Ratio** | Keep more text than HTML markup; avoid `<style>` blocks and complex tables |
| **Links** | Minimize external links; each additional link increases promotional classification risk |
| **Bounce/Complaint** | Maintain <2% bounce rate, <0.1% complaint rate; suppress bounced/complained contacts |
| **Engagement** | Send to engaged recipients; remove inactive contacts |

---

## 2. Current System Behavior

### 2.1 Email Construction (`src/mailer.ts`)

**`renderMarkdown()` (lines 445–473):**
- Wraps all emails in a full `<!DOCTYPE html>` document with `<style>` block
- Applies newsletter-style CSS: `max-width: 600px`, `margin: 0 auto`, branded colors (`#2c3e50`, `#3498db`)
- Styles headings, links, lists, blockquotes, and code blocks with custom colors
- Appends a styled unsubscribe footer with `<hr>` and `<p style="font-size: 12px; color: #666">`

**Impact:** Gmail's classifier treats emails with `<style>` blocks, `max-width` containers, and branded color schemes as marketing newsletters → **Promotions tab**.

**`UNSUBSCRIBE_FOOTER` (lines 434–440):**
- Uses `<hr>` separator and styled `<p>` tag
- Formatting resembles a marketing email footer

**`generatePlainText()` (lines 479–491):**
- Does not include an unsubscribe line in the plain-text version
- This is a compliance gap — both HTML and text parts should include opt-out information

### 2.2 Email Sending (`src/ses.ts`)

**`constructSendEmailInput()` (lines 137–149):**
- Uses `SendEmailCommand` which does not support custom headers
- `Source` field uses raw email address (no display name)
- No `List-Unsubscribe` or `List-Unsubscribe-Post` headers

**`getSESFromEmail()` (lines 69–71):**
- Returns raw `SES_FROM_EMAIL` env var
- No `SES_FROM_NAME` env var for display name

### 2.3 Bounce/Complaint/Suppression (COMPLIANT ✅)

- Hard bounces suppress contacts via `contact_suppressions` table
- All spam complaints trigger immediate suppression
- `isContactSuppressed()` prevents sending to suppressed contacts
- Unsubscribe suppression type exists in the schema

### 2.4 Retry Logic (COMPLIANT ✅)

- Transient errors retried up to `MAX_RETRIES` (2) with delays
- Permanent errors (`MessageRejected`, `MailFromDomainNotVerifiedException`) never retried
- Campaign stops on critical configuration errors

---

## 3. Template Analysis

### 3.1 Active Template (`templates/email_body.spintax.md`)

| Issue | Line(s) | Impact |
|-------|---------|--------|
| **Feature bullet list** | 9–12 | `- **You own it.**`, `- **No restrictions.**`, etc. — classic marketing pattern |
| **Multiple external links** | 14, 23 | GDrive link + website link — multiple links increase promotional score |
| **Inline HTML `<span>` styling** | 19–20 | `<span style="color: #3c5bb6; font-size: 14px; font-weight: bold;">` — branded color styling |
| **Call-to-action** | 16 | "Would a 20-minute call make sense?" — soft CTA but combined with above patterns |

### 3.2 Root-Level Template (`email_body.spintax.md`)

| Issue | Line(s) | Impact |
|-------|---------|--------|
| **Inline `<span>` + `<br>` tags** | 13–18 | HTML signature with branded colors |
| **External brochure link** | 7 | GDrive brochure link |
| **Product/company description** | 5–7 | Reads as a sales pitch |

### 3.3 Subject Template (`templates/subject.spintax`)

- Current: `{Quick question|A quick note|Reaching out} {regarding|about} [Company-Name]`
- **Assessment:** Good — conversational and personalized. No issues.

### 3.4 Template Recommendations

> [!IMPORTANT]
> Templates are user-controlled content. These are recommendations, not automated changes.

1. **Remove bullet-point feature lists** — replace with 1-2 sentence descriptions written in conversational prose
2. **Limit to one external link** per email — choose between the GDrive link OR the website link, not both
3. **Remove inline HTML styling** from signature — use plain text signature instead of `<span>` tags with branded colors
4. **Shorten email body** — shorter emails with fewer elements are more likely to reach Primary
5. **Write like a real person** — avoid structured sales pitches; use the tone of a personal email from a colleague

---

## 4. Compliance Gaps

| # | Gap | File | Location | Severity |
|---|-----|------|----------|----------|
| 1 | Newsletter-style HTML wrapper with `<style>` block | `src/mailer.ts` | `renderMarkdown()` L452–473 | **High** |
| 2 | No `List-Unsubscribe` header | `src/ses.ts` | `constructSendEmailInput()` L137–149 | **High** |
| 3 | No `List-Unsubscribe-Post` header (one-click unsubscribe) | `src/ses.ts` | Same | **High** |
| 4 | No From display name formatting | `src/ses.ts` | `getSESFromEmail()` L69–71 | **Medium** |
| 5 | Styled unsubscribe footer resembles newsletter | `src/mailer.ts` | `UNSUBSCRIBE_FOOTER` L434–440 | **Medium** |
| 6 | No unsubscribe line in plain-text body | `src/mailer.ts` | `generatePlainText()` L479–491 | **Medium** |
| 7 | Templates contain promotional patterns | `templates/` | Various | **Medium** |

---

## 5. Recommended Improvements

### 5.1 High Priority — Code Changes

1. **Simplify `renderMarkdown()` HTML** — remove `<style>` block, use only minimal inline `font-family` on body. Remove `max-width`, branded colors, and all custom CSS.

2. **Migrate to `SendRawEmailCommand`** — construct raw MIME message to support custom headers. Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers per RFC 8058.

3. **Add `SES_FROM_NAME` support** — format `Source` field as `"Name" <email>` per RFC 5322.

### 5.2 Medium Priority — Code Changes

4. **Simplify unsubscribe footer** — remove `<hr>` and styled `<p>`; use plain line.

5. **Add plain-text unsubscribe** — append opt-out line in `generatePlainText()`.

### 5.3 User Action — Templates

6. **Revise templates** per recommendations in Section 3.4 above.

---

## 6. AWS Documentation References

- [AWS SES Sending Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)
- [AWS SES SendRawEmail API](https://docs.aws.amazon.com/ses/latest/APIReference/API_SendRawEmail.html)
- [RFC 8058 — One-Click Unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058)
- [RFC 5322 — Internet Message Format](https://datatracker.ietf.org/doc/html/rfc5322)
- [Gmail Sender Guidelines](https://support.google.com/mail/answer/81126)
