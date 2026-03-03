/**
 * Domain Event Emitter for TermiSend
 * Type-safe event system for domain events
 *
 * This module provides a singleton event emitter that:
 * - Ensures type safety for all domain events
 * - Provides error isolation (handler failures don't affect main flow)
 * - Supports correlation IDs for event chains
 * - Persists events to the analytics database
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';
import { saveEvent } from './repository.js';
import type {
  DomainEvent,
  DomainEventHandler,
  DomainEventPayload,
  DomainEventType,
} from './types.js';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generates a unique event ID
 * Uses UUID v4 for uniqueness
 */
export function generateEventId(): string {
  return randomUUID();
}

/**
 * Generates a correlation ID for event chains
 * Used to link related events together
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

// ============================================================================
// Domain Event Emitter
// ============================================================================

/**
 * Domain event emitter
 * Simple, typed event system without external dependencies
 *
 * Usage:
 * ```typescript
 * import { domainEvents, createEvent } from './events/index.js';
 *
 * // Emit an event
 * const event = createEvent(DomainEventType.CONTACT_IMPORTED, {
 *   contactId: '123',
 *   email: 'test@example.com',
 *   // ... other payload fields
 * });
 * domainEvents.emit(event);
 *
 * // Subscribe to events
 * domainEvents.on(DomainEventType.EMAIL_SENT, (event) => {
 *   console.log('Email sent:', event.payload);
 * });
 * ```
 */
export class DomainEventEmitter {
  private handlers: Map<DomainEventType, DomainEventHandler[]> = new Map();
  private static instance: DomainEventEmitter;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {}

  /**
   * Get singleton instance
   * Ensures single event emitter across the application
   */
  static getInstance(): DomainEventEmitter {
    if (!DomainEventEmitter.instance) {
      DomainEventEmitter.instance = new DomainEventEmitter();
    }
    return DomainEventEmitter.instance;
  }

  /**
   * Emit a domain event
   * Calls all registered handlers and triggers persistence
   * @param event - Domain event to emit
   */
  emit(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      // Execute handlers with error isolation
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          // Silently ignore handler errors to prevent disrupting main flow
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Domain event handler error for ${event.type}`, {
            error: errorMessage,
            eventId: event.eventId,
            eventType: event.type,
          });
        }
      }
    }

    // Persist to analytics database asynchronously (Phase 4 implementation)
    this.persistEvent(event).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // biome-ignore lint/complexity/noVoid: Intentional fire-and-forget for error logging
      void logger.logError(
        `Failed to persist domain event ${event.type}`,
        error instanceof Error ? error : errorMessage,
        { eventId: event.eventId }
      );
    });
  }

  /**
   * Subscribe to a domain event
   * @param eventType - Event type to subscribe to
   * @param handler - Handler function to call when event is emitted
   * @returns Unsubscribe function for convenience
   */
  on(eventType: DomainEventType, handler: DomainEventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)?.push(handler);

    // Return unsubscribe function
    return () => this.off(eventType, handler);
  }

  /**
   * Subscribe to a domain event (fires once only)
   * @param eventType - Event type to subscribe to
   * @param handler - Handler function to call once
   */
  once(eventType: DomainEventType, handler: DomainEventHandler): void {
    const wrappedHandler: DomainEventHandler = (event) => {
      this.off(eventType, wrappedHandler);
      handler(event);
    };
    this.on(eventType, wrappedHandler);
  }

  /**
   * Remove event handler
   * @param eventType - Event type
   * @param handler - Handler function to remove
   */
  off(eventType: DomainEventType, handler: DomainEventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Remove all handlers for a specific event type
   * @param eventType - Event type to clear handlers for
   */
  removeAllHandlers(eventType: DomainEventType): void {
    this.handlers.delete(eventType);
  }

  /**
   * Check if there are any handlers for an event type
   * @param eventType - Event type to check
   * @returns True if handlers exist
   */
  hasHandlers(eventType: DomainEventType): boolean {
    const handlers = this.handlers.get(eventType);
    return handlers !== undefined && handlers.length > 0;
  }

  /**
   * Persist event to analytics database
   * Uses fire-and-forget pattern to avoid blocking main flows
   * @param event - Domain event to persist
   */
  private async persistEvent(event: DomainEvent): Promise<void> {
    // Use the repository to save the event
    // Errors are handled internally by saveEvent - won't throw
    await saveEvent(event);
  }
}

// ============================================================================
// Event Factory Functions
// ============================================================================

/**
 * Creates a domain event with auto-generated eventId and timestamp
 * @param type - Event type
 * @param payload - Event payload
 * @param correlationId - Optional correlation ID for event chains
 * @returns Complete domain event object
 */
export function createEvent<T extends DomainEventPayload>(
  type: DomainEventType,
  payload: T,
  correlationId?: string
): DomainEvent<T> {
  return {
    type,
    eventId: generateEventId(),
    timestamp: new Date(),
    correlationId,
    payload,
  };
}

/**
 * Creates a domain event with a new correlation ID
 * Useful for starting a new event chain
 * @param type - Event type
 * @param payload - Event payload
 * @returns Complete domain event object with new correlation ID
 */
export function createEventWithCorrelation<T extends DomainEventPayload>(
  type: DomainEventType,
  payload: T
): DomainEvent<T> {
  return createEvent(type, payload, generateCorrelationId());
}

// ============================================================================
// Singleton Instance Export
// ============================================================================

/**
 * Global domain event emitter instance
 * Exported for convenient access throughout the application
 *
 * Usage:
 * ```typescript
 * import { domainEvents } from './events/emitter.js';
 *
 * domainEvents.emit(event);
 * domainEvents.on(DomainEventType.EMAIL_SENT, handler);
 * ```
 */
export const domainEvents = DomainEventEmitter.getInstance();
