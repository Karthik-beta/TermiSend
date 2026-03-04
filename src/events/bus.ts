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
  | { type: 'contact:updated'; id: number; status: string }
  | { type: 'email:sent'; contactId: number }
  | { type: 'email:failed'; contactId: number; error: string }
  | { type: 'email:skipped'; contactId: number; reason: string }
  | { type: 'contact:verified'; id: number; isValid: boolean }
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
  | { type: 'contact:suppressed'; contactId: string; reason: string };

// Helper function to emit events
export function emitAnalyticsEvent(event: AnalyticsEvent): void {
  eventBus.emit('analytics', event);
}
