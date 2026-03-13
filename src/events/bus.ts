/**
 * Global Event Bus for Real-Time Analytics
 *
 * Provides a lightweight event emitter using Node's native events module
 * for broadcasting analytics events across the application.
 */

import { EventEmitter } from 'node:events';

// Global event bus for real-time analytics
export const eventBus = new EventEmitter();

// Event types for analytics
export type AnalyticsEvent =
  | { type: 'contact:imported'; count: number }
  | { type: 'contact:updated'; id: string; status: string }
  | { type: 'email:sent'; contactId: string; email: string }
  | { type: 'email:failed'; contactId: string; email: string; error: string }
  | { type: 'email:skipped'; contactId: string; email: string; reason: string }
  | { type: 'contact:verified'; id: string; isValid: boolean }
  // New SES event analytics
  | { type: 'email:delivered'; contactId: string; messageId: string }
  | {
      type: 'email:bounced';
      contactId: string;
      messageId: string;
      bounceType: 'Permanent' | 'Transient';
    }
  | { type: 'email:complained'; contactId: string; messageId: string }
  | { type: 'email:opened'; contactId: string; messageId: string }
  | { type: 'email:clicked'; contactId: string; messageId: string; link: string }
  | {
      type: 'contact:suppressed';
      email: string;
      reason: string;
      suppressionType: 'bounce' | 'complaint' | 'unsubscribe' | 'manual';
      contactId?: string;
      messageId?: string;
    }
  | { type: 'verifier:credits_updated'; credits: number };

// Helper function to emit events
export function emitAnalyticsEvent(event: AnalyticsEvent): void {
  try {
    eventBus.emit('analytics', event);
  } catch (error) {
    console.error(
      `[TermiSend] Analytics event handler error for ${event.type}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
