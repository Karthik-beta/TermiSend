/**
 * useCampaign Hook
 *
 * Purpose: Manages email campaign execution, preview generation, and progress tracking
 * Props: None - Self-contained hook
 * State: campaignState, liveProgress, logEntries
 * Extension: Add campaign history, scheduling, or A/B testing support
 */

import { useCallback, useRef, useState } from 'react';
import { getEligibleContactCount, getEligibleContacts } from '../../db.js';
import { generatePreview, runCampaign } from '../../mailer.js';
import type { CampaignResult, Contact, SendProgress } from '../../types.js';
import type { CampaignViewStatus, LiveProgress, LogEntry } from '../types.js';

/**
 * Campaign hook return type
 */
interface UseCampaignReturn {
  // State
  status: CampaignViewStatus;
  templatePath: string;
  campaignId: string;
  isContinuous: boolean;
  pendingCount: number;
  result: CampaignResult | null;
  error: string | null;
  preview: { subject: string; textBody: string } | null;
  liveProgress: LiveProgress;
  logEntries: LogEntry[];

  // Actions
  setTemplatePath: (path: string) => void;
  setCampaignId: (id: string) => void;
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
  const [templatePath, setTemplatePathState] = useState<string>('');
  const [campaignId, setCampaignId] = useState<string>(crypto.randomUUID());
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

  const setTemplatePath = useCallback((path: string) => {
    setTemplatePathState(path);
  }, []);

  const loadPendingCount = useCallback(async () => {
    try {
      const count = await getEligibleContactCount(campaignId);
      setPendingCount(count);
    } catch {
      setPendingCount(0);
    }
  }, [campaignId]);

  const generateCampaignPreview = useCallback(async () => {
    if (!templatePath.trim()) {
      setError('Please enter a template path');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setError(null);
    setPreview(null);

    try {
      const contacts = await getEligibleContacts(campaignId, 1);
      if (contacts.length === 0) {
        setError('No eligible contacts found for this campaign. Import contacts first.');
        setStatus('error');
        return;
      }

      const sampleContact: Contact = contacts[0];
      const previewResult = await generatePreview(templatePath.trim(), sampleContact);
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
  }, [templatePath, campaignId]);

  const startCampaign = useCallback(async () => {
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
        templatePath.trim(),
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
        campaignId,
        isContinuous
      );
      setResult(campaignResult);
      setStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setStatus('error');
    }
  }, [templatePath, campaignId, isContinuous]);

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
    setTemplatePathState('');
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
    templatePath,
    campaignId,
    isContinuous,
    pendingCount,
    result,
    error,
    preview,
    liveProgress,
    logEntries,

    // Actions
    setTemplatePath,
    setCampaignId,
    setIsContinuous,
    loadPendingCount,
    generateCampaignPreview,
    startCampaign,
    confirmCampaign,
    reset,
    clearError,
  };
}
