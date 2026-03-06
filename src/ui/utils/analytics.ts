/**
 * Analytics normalization utilities
 * Provides shared helpers for mapping persisted event types back to the
 * colon-delimited keys consumed by the UI.
 */

export type NormalizedAnalyticsEventType =
  | 'contact:imported'
  | 'contact:verified'
  | 'contact:suppressed'
  | 'email:sent'
  | 'email:failed'
  | 'email:skipped'
  | 'email:delivered'
  | 'email:bounced'
  | 'email:complained';

const eventMap: Record<string, NormalizedAnalyticsEventType> = {
  'contact:imported': 'contact:imported',
  contact_imported: 'contact:imported',
  'contact:verified': 'contact:verified',
  contact_verified: 'contact:verified',
  contact_invalid: 'contact:verified',
  contact_deemed_unsafe: 'contact:verified',
  'contact:suppressed': 'contact:suppressed',
  contact_suppressed: 'contact:suppressed',
  'email:sent': 'email:sent',
  email_sent: 'email:sent',
  'email:failed': 'email:failed',
  email_failed: 'email:failed',
  'email:skipped': 'email:skipped',
  email_skipped: 'email:skipped',
  'email:delivered': 'email:delivered',
  ses_delivery_confirmed: 'email:delivered',
  'email:bounced': 'email:bounced',
  ses_bounce_processed: 'email:bounced',
  'email:complained': 'email:complained',
  ses_complaint_processed: 'email:complained',
};

/**
 * Normalize analytics event types stored in the database or emitted at runtime
 * so the UI can treat past and live events the same way.
 *
 * @param eventType - Raw event type string from storage
 * @returns Normalized key or undefined when no mapping exists
 */
export function normalizeAnalyticsEventType(
  eventType: string | null | undefined
): NormalizedAnalyticsEventType | undefined {
  if (!eventType) {
    return undefined;
  }
  const directMatch = eventMap[eventType];
  if (directMatch) {
    return directMatch;
  }
  const normalizedKey = eventType.replace(/:/g, '_').toLowerCase();
  return eventMap[normalizedKey];
}
