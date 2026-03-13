/**
 * useActivityFeed Hook
 *
 * Maintains a rolling list of activity events for the dashboard feed.
 */

import { useEffect, useState } from 'react';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import type { ActivityEvent, ActivitySource } from '../types.js';

const MAX_EVENTS = 200;

export interface UseActivityFeedReturn {
  events: ActivityEvent[];
}

export function useActivityFeed(): UseActivityFeedReturn {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const handleAnalyticsEvent = (event: AnalyticsEvent) => {
      const mapped = mapAnalyticsEventToActivity(event);
      if (!mapped) {
        return;
      }

      setEvents((prev) => {
        const next = [...prev, mapped];
        if (next.length > MAX_EVENTS) {
          return next.slice(-MAX_EVENTS);
        }
        return next;
      });
    };

    eventBus.on('analytics', handleAnalyticsEvent);
    return () => {
      eventBus.off('analytics', handleAnalyticsEvent);
    };
  }, []);

  return { events };
}

function mapAnalyticsEventToActivity(event: AnalyticsEvent): ActivityEvent | null {
  const now = new Date();

  switch (event.type) {
    case 'contact:imported':
      return createActivityEvent('import', `Imported ${event.count} contacts`, 'success', now);
    case 'contact:verified':
      return createActivityEvent(
        'verifier',
        event.isValid ? 'Contact verified' : 'Contact invalid/unsafe',
        event.isValid ? 'success' : 'warning',
        now
      );
    case 'email:sent':
      return createActivityEvent('ses', `Sent to ${event.email}`, 'success', now);
    case 'email:failed':
      return createActivityEvent('ses', `Failed sending to ${event.email}`, 'error', now);
    case 'email:skipped':
      return createActivityEvent(
        'system',
        `Skipped ${event.email} (${event.reason})`,
        'warning',
        now
      );
    case 'email:delivered':
      return createActivityEvent('ses', 'Delivery confirmed', 'success', now);
    case 'email:bounced':
      return createActivityEvent('ses', `Bounce detected (${event.bounceType})`, 'warning', now);
    case 'email:complained':
      return createActivityEvent('ses', 'Complaint reported', 'error', now);
    case 'email:opened':
      return createActivityEvent('ses', 'Email opened', 'info', now);
    case 'email:clicked':
      return createActivityEvent('ses', 'Link clicked', 'info', now);
    case 'contact:suppressed':
      return createActivityEvent(
        'system',
        `Suppressed ${event.email} (${event.reason})`,
        'warning',
        now
      );
    case 'contact:updated':
      return createActivityEvent('system', `Contact status updated: ${event.status}`, 'info', now);
    case 'verifier:credits_updated':
      return createActivityEvent('verifier', `Verifier credits: ${event.credits}`, 'info', now);
    default:
      return null;
  }
}

function createActivityEvent(
  source: ActivitySource,
  message: string,
  status: ActivityEvent['status'],
  timestamp: Date
): ActivityEvent {
  return {
    id: timestamp.getTime() + Math.floor(Math.random() * 1000),
    source,
    message,
    status,
    timestamp,
  };
}
