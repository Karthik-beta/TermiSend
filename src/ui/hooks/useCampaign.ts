/**
 * useCampaign Hook
 *
 * Purpose: Manages email campaign execution, preview generation, and progress tracking
 * Props: None - Self-contained hook
 * State: campaignState, liveProgress, logEntries
 * Extension: Add campaign history, scheduling, or A/B testing support
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAnalyticsCounts,
  getEligibleContactCount,
  getEligibleContacts,
  getRecentAnalyticsEvents,
} from '../../db.js';
import { generatePreview, runCampaign } from '../../mailer.js';
import { isShuttingDown } from '../../shutdown.js';
import type { AnalyticsEventRecord, CampaignResult, Contact, SendProgress } from '../../types.js';
import type { CampaignViewStatus, LiveProgress, LogEntry } from '../types.js';
import { normalizeAnalyticsEventType } from '../utils/analytics.js';

/**
 * Campaign hook return type
 */
export interface UseCampaignReturn {
  // State
  status: CampaignViewStatus;
  isContinuous: boolean;
  pendingCount: number;
  result: CampaignResult | null;
  error: string | null;
  preview: { subject: string; textBody: string } | null;
  liveProgress: LiveProgress;
  logEntries: LogEntry[];

  // Actions
  setIsContinuous: (continuous: boolean) => void;
  loadPendingCount: () => Promise<void>;
  generateCampaignPreview: () => Promise<void>;
  startCampaign: () => Promise<void>;
  confirmCampaign: (confirmed: boolean) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

/**
 * Hook for managing email campaign operations
 * @returns Campaign state and actions
 */
export function useCampaign(): UseCampaignReturn {
  // Campaign state
  const [status, setStatus] = useState<CampaignViewStatus>('idle');
  const [isContinuous, setIsContinuous] = useState<boolean>(true); // Default to continuous based on user request
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; textBody: string } | null>(null);

  // Live progress state
  const [liveProgress, setLiveProgress] = useState<LiveProgress>({
    currentContact: 0,
    totalContacts: 0,
    currentEmail: '',
    status: 'verifying',
  });

  // Activity log
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  // Queue for pending log entries to prevent race conditions during rapid updates
  const pendingLogEntriesRef = useRef<LogEntry[]>([]);

  // Initial load from database
  useEffect(() => {
    let mounted = true;

    async function initializeCampaign() {
      try {
        const [counts, recentEvents] = await Promise.all([
          getAnalyticsCounts(),
          getRecentAnalyticsEvents(20),
        ]);

        if (!mounted) {
          return;
        }

        // Initialize progress bar
        const completedCount = counts.sent + counts.failed + counts.invalid;
        setLiveProgress({
          currentContact: completedCount,
          totalContacts: counts.total,
          currentEmail: '',
          status: completedCount >= counts.total && counts.total > 0 ? 'completed' : 'verifying',
          message: counts.total > 0 ? 'Resuming campaign from database' : 'Ready to start',
        });

        // Set pending count for the dashboard
        setPendingCount(counts.pending);

        // Map events to log entries for the campaign view
        const campaignLogs: LogEntry[] = (recentEvents as AnalyticsEventRecord[])
          .map((event) => mapAnalyticsEventToLogEntry(event))
          .filter((entry): entry is LogEntry => entry !== null)
          .reverse();

        setLogEntries(campaignLogs);
      } catch (_error) {
        // Silently ignore initialization errors
      }
    }

    initializeCampaign();

    return () => {
      mounted = false;
    };
  }, []);

  const loadPendingCount = useCallback(async () => {
    try {
      const count = await getEligibleContactCount();
      setPendingCount(count);
    } catch {
      setPendingCount(0);
    }
  }, []);

  const generateCampaignPreview = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setPreview(null);

    try {
      const contacts = await getEligibleContacts(1);
      if (contacts.length === 0) {
        setError('No eligible contacts found. Import contacts first.');
        setStatus('error');
        return;
      }

      const sampleContact: Contact = contacts[0];
      const previewResult = await generatePreview(sampleContact);
      setPreview({
        subject: previewResult.subject,
        textBody: previewResult.textBody,
      });
      setStatus('confirm');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setStatus('error');
    }
  }, []);

  const startCampaign = useCallback(async () => {
    // Check if shutdown was requested before starting
    if (isShuttingDown()) {
      return;
    }

    setStatus('running');
    setLogEntries([]);
    pendingLogEntriesRef.current = []; // Clear pending queue
    setLiveProgress({
      currentContact: 0,
      totalContacts: 0,
      currentEmail: '',
      status: 'verifying',
    });

    try {
      const campaignResult = await runCampaign(
        false,
        (progress: SendProgress) => {
          // Update live progress state
          setLiveProgress({
            currentContact: progress.currentContact,
            totalContacts: progress.totalContacts,
            currentEmail: progress.email,
            status: progress.status,
            waitTimeRemainingMs: progress.waitTimeRemainingMs,
            totalWaitTimeMs: progress.totalWaitTimeMs,
            message: progress.message,
          });

          // Add to pending queue when a contact is completed, skipped, or failed
          if (
            progress.status === 'completed' ||
            progress.status === 'skipped' ||
            progress.status === 'failed'
          ) {
            const newEntry: LogEntry = {
              email: progress.email,
              status: progress.status,
              message: progress.message,
              timestamp: new Date(),
            };
            pendingLogEntriesRef.current.push(newEntry);

            // Batch update state with all pending entries
            if (pendingLogEntriesRef.current.length > 0) {
              setLogEntries((prev) => {
                const updated = [...prev, ...pendingLogEntriesRef.current];
                pendingLogEntriesRef.current = []; // Clear queue after consuming
                // Keep last 20 entries
                if (updated.length > 20) {
                  return updated.slice(-20);
                }
                return updated;
              });
            }
          }
        },
        undefined, // campaignId - auto-generated by runCampaign for logging
        isContinuous
      );
      setResult(campaignResult);
      setStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setStatus('error');
    }
  }, [isContinuous]);

  const confirmCampaign = useCallback(
    async (confirmed: boolean) => {
      if (!confirmed) {
        setStatus('idle');
        return;
      }

      try {
        await startCampaign();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        setStatus('error');
      }
    },
    [startCampaign]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setPendingCount(0);
    setResult(null);
    setError(null);
    setPreview(null);
    setLiveProgress({
      currentContact: 0,
      totalContacts: 0,
      currentEmail: '',
      status: 'verifying',
    });
    setLogEntries([]);
    pendingLogEntriesRef.current = []; // Clear pending queue
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    status,
    isContinuous,
    pendingCount,
    result,
    error,
    preview,
    liveProgress,
    logEntries,

    // Actions
    setIsContinuous,
    loadPendingCount,
    generateCampaignPreview,
    startCampaign,
    confirmCampaign,
    reset,
    clearError,
  };
}

function mapAnalyticsEventToLogEntry(event: AnalyticsEventRecord): LogEntry | null {
  const normalized = normalizeAnalyticsEventType(event.eventType);
  if (!normalized || !['email:sent', 'email:failed', 'email:skipped'].includes(normalized)) {
    return null;
  }

  const payload = event.payload as unknown as Record<string, unknown>;
  const email = String(payload.email || payload.recipientEmail || 'unknown');
  const status: LogEntry['status'] =
    normalized === 'email:sent'
      ? 'completed'
      : normalized === 'email:skipped'
        ? 'skipped'
        : 'failed';
  const message =
    normalized === 'email:failed'
      ? String(payload.error || payload.errorReason || payload.message || '')
      : normalized === 'email:skipped'
        ? String(payload.reason || '')
        : '';

  return {
    email,
    status,
    message,
    timestamp: new Date(event.occurredAt),
  };
}
