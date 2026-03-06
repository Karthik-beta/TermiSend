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
import { getRecentAnalyticsEvents } from '../../db.js';
import { type AnalyticsEvent, eventBus } from '../../events/bus.js';
import type { AnalyticsEventRecord } from '../../types.js';
import { layout } from '../theme.js';
import type { ActivityEvent, ActivitySource } from '../types.js';
import {
  type NormalizedAnalyticsEventType,
  normalizeAnalyticsEventType,
} from '../utils/analytics.js';

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

  // Initial load from database
  useEffect(() => {
    let mounted = true;

    async function initializeFeed() {
      try {
        const recentEvents = await getRecentAnalyticsEvents(layout.maxFeedEntries);
        if (!mounted || recentEvents.length === 0) {
          return;
        }

        // Map database records to activity events
        // Reverse because DB sorts newest first (DESC), but feed appends/slices from end
        const initialEvents: ActivityEvent[] = recentEvents
          .reverse()
          .map((event) => mapRecordToActivityEvent(event))
          .filter((e): e is ActivityEvent => e !== null);

        // Prepend hidden history or replace if empty
        // In practice, since this runs on mount, eventsRef should be empty unless a real-time event
        // arrived during the async call.
        const merged = [...initialEvents, ...eventsRef.current].slice(-layout.maxFeedEntries);
        eventsRef.current = merged;
        setEvents(merged);
      } catch (_error) {
        // Silently ignore initialization errors
      }
    }

    initializeFeed();

    return () => {
      mounted = false;
    };
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

/**
 * Helper to map database records to ActivityEvent structure
 * Extracted to reduce cognitive complexity of the main hook
 */
interface ActivityBuilderArgs {
  event: AnalyticsEventRecord;
  payload: Record<string, unknown>;
  email: string;
}

type ActivityBuilderResult = {
  source: ActivitySource;
  message: string;
  status: ActivityEvent['status'];
};

const activityBuilders: Record<
  NormalizedAnalyticsEventType,
  (args: ActivityBuilderArgs) => ActivityBuilderResult
> = {
  'contact:imported': ({ payload }) => ({
    source: 'import',
    message: `Imported ${payload.count ?? 0} contact(s)`,
    status: 'info',
  }),
  'contact:verified': ({ payload, event }) => {
    const isValid =
      payload.isValid === true || String(payload.result || '').toLowerCase() === 'valid';
    const reason = payload.reason ? `: ${payload.reason}` : '';
    return {
      source: 'verifier',
      message: `Contact #${String(event.contactId || '').slice(0, 8)} ${
        isValid ? 'verified valid' : `marked invalid${reason}`
      }`,
      status: isValid ? 'success' : 'warning',
    };
  },
  'contact:suppressed': ({ payload }) => ({
    source: 'system',
    message: `Contact suppressed: ${payload.reason || 'unknown'}`,
    status: 'warning',
  }),
  'email:sent': ({ email }) => ({
    source: 'ses',
    message: `Email sent to ${email}`,
    status: 'success',
  }),
  'email:failed': ({ email, payload }) => ({
    source: 'ses',
    message: `Send failed for ${email}: ${payload.error ?? payload.errorReason ?? 'unknown error'}`,
    status: 'error',
  }),
  'email:skipped': ({ email, payload }) => ({
    source: 'ses',
    message: `Skipped ${email}: ${payload.reason ?? 'unspecified'}`,
    status: 'warning',
  }),
  'email:delivered': ({ payload }) => ({
    source: 'ses',
    message: `Email delivered (${String(payload.messageId || '').slice(0, 12)}…)`,
    status: 'success',
  }),
  'email:bounced': ({ payload }) => ({
    source: 'ses',
    message: `Bounce (${payload.bounceType || 'unknown'}) for ${String(
      payload.messageId || ''
    ).slice(0, 12)}…`,
    status: 'error',
  }),
  'email:complained': ({ payload }) => ({
    source: 'ses',
    message: `Complaint for ${String(payload.messageId || '').slice(0, 12)}…`,
    status: 'error',
  }),
};

function mapRecordToActivityEvent(event: AnalyticsEventRecord): ActivityEvent | null {
  const normalizedType = normalizeAnalyticsEventType(event.eventType);
  if (!normalizedType) {
    return null;
  }

  const builder = activityBuilders[normalizedType];
  if (!builder) {
    return null;
  }

  const payload = event.payload as unknown as Record<string, unknown>;
  const email = String(payload.email || payload.recipientEmail || 'unknown');
  const { source, message, status } = builder({ event, payload, email });

  return {
    id: nextEventId++,
    source,
    message,
    status,
    timestamp: new Date(event.occurredAt),
  };
}
