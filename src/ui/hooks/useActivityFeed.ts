/**
 * useActivityFeed Hook
 *
 * Purpose: Manages live activity feed state for the dashboard.
 * Subscribes to the event bus for real-time analytics events
 * and provides an addEntry() function for manual additions.
 *
 * Keeps the last 30 events, auto-prunes older entries.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import { layout } from '../theme.js';
import type { ActivityEvent, ActivitySource } from '../types.js';

interface UseActivityFeedReturn {
  events: ActivityEvent[];
  addEntry: (source: ActivitySource, message: string, status: ActivityEvent['status']) => void;
  clear: () => void;
}

// Auto-incrementing ID counter
let nextEventId = 1;

/**
 * Hook for managing the live activity feed
 */
export function useActivityFeed(): UseActivityFeedReturn {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const eventsRef = useRef<ActivityEvent[]>([]);

  const addEntry = useCallback(
    (source: ActivitySource, message: string, status: ActivityEvent['status']) => {
      const newEvent: ActivityEvent = {
        id: nextEventId++,
        source,
        message,
        status,
        timestamp: new Date(),
      };

      eventsRef.current = [...eventsRef.current, newEvent].slice(-layout.maxFeedEntries);
      setEvents(eventsRef.current);
    },
    []
  );

  const clear = useCallback(() => {
    eventsRef.current = [];
    setEvents([]);
  }, []);

  // Subscribe to event bus for analytics events
  useEffect(() => {
    const handleAnalyticsEvent = (event: AnalyticsEvent) => {
      switch (event.type) {
        case 'contact:imported':
          addEntry('import', `Imported ${event.count} contact(s)`, 'info');
          break;
        case 'contact:verified':
          addEntry(
            'verifier',
            `Contact #${event.id.slice(0, 8)} ${event.isValid ? 'verified valid' : 'marked invalid'}`,
            event.isValid ? 'success' : 'warning'
          );
          break;
        case 'email:sent':
          addEntry('ses', `Email sent to ${event.email}`, 'success');
          break;
        case 'email:failed':
          addEntry('ses', `Send failed for ${event.email}: ${event.error}`, 'error');
          break;
        case 'email:skipped':
          addEntry('ses', `Skipped ${event.email}: ${event.reason}`, 'warning');
          break;
        case 'email:delivered':
          addEntry('ses', `Email delivered (${event.messageId.slice(0, 12)}…)`, 'success');
          break;
        case 'email:bounced':
          addEntry(
            'ses',
            `Bounce (${event.bounceType}) for ${event.messageId.slice(0, 12)}…`,
            'error'
          );
          break;
        case 'email:complained':
          addEntry('ses', `Complaint for ${event.messageId.slice(0, 12)}…`, 'error');
          break;
        case 'contact:suppressed':
          addEntry('system', `Contact suppressed: ${event.reason}`, 'warning');
          break;
        // contact:updated, email:opened, email:clicked — not shown in feed to reduce noise
      }
    };

    eventBus.on('analytics', handleAnalyticsEvent);
    return () => {
      eventBus.off('analytics', handleAnalyticsEvent);
    };
  }, [addEntry]);

  return { events, addEntry, clear };
}
