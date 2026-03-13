/**
 * Manual unsubscribe service
 * Handles validation, persistence, and analytics emission for operator-entered unsubscribes.
 */

import {
  createContactSuppression,
  getContactByEmail,
  getContactSuppressionByEmail,
  recordAnalyticsEvent,
} from './db.js';
import { emitAnalyticsEvent } from './events/bus.js';
import { DomainEventType } from './events/index.js';
import type { UnsubscribeResult } from './types.js';
import { validateEmailFormat } from './utils/security.js';

const MANUAL_UNSUBSCRIBE_REASON = 'Manual unsubscribe';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function unsubscribeEmail(rawEmail: string): Promise<UnsubscribeResult> {
  const email = normalizeEmail(rawEmail);
  const validation = validateEmailFormat(email);

  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid email format');
  }

  const existingSuppression = await getContactSuppressionByEmail(email);
  if (existingSuppression) {
    return {
      status: 'already_suppressed',
      email,
      contactId: existingSuppression.contactId ?? undefined,
      suppressionType: existingSuppression.suppressionType,
      suppressionReason: existingSuppression.suppressionReason,
    };
  }

  const contact = await getContactByEmail(email);
  const created = await createContactSuppression({
    contactId: contact?.id,
    email,
    suppressionType: 'unsubscribe',
    suppressionReason: MANUAL_UNSUBSCRIBE_REASON,
  });

  if (!created) {
    const suppressionAfterInsert = await getContactSuppressionByEmail(email);
    if (suppressionAfterInsert) {
      return {
        status: 'already_suppressed',
        email,
        contactId: suppressionAfterInsert.contactId ?? undefined,
        suppressionType: suppressionAfterInsert.suppressionType,
        suppressionReason: suppressionAfterInsert.suppressionReason,
      };
    }

    throw new Error('Failed to record unsubscribe');
  }

  await recordAnalyticsEvent({
    eventType: DomainEventType.CONTACT_SUPPRESSED,
    contactId: contact?.id,
    payload: {
      contactId: contact?.id,
      email,
      reason: MANUAL_UNSUBSCRIBE_REASON,
      suppressionType: 'unsubscribe',
    },
  });

  emitAnalyticsEvent({
    type: 'contact:suppressed',
    contactId: contact?.id,
    email,
    reason: MANUAL_UNSUBSCRIBE_REASON,
    suppressionType: 'unsubscribe',
  });

  return {
    status: 'created',
    email,
    contactId: contact?.id,
    suppressionType: 'unsubscribe',
    suppressionReason: MANUAL_UNSUBSCRIBE_REASON,
  };
}
