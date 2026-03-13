/**
 * useContacts Hook
 *
 * Purpose: Manages contact data fetching and state for the dashboard
 * Props: None - Self-contained hook
 * State: contacts, pendingCount, isLoading, error
 * Extension: Add contact filtering, sorting, or pagination
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getContactsWithSuppression, getEligibleContactCount } from '../../db.js';
import type { ContactWithSuppression } from '../../types.js';
import type { ContactsState } from '../types.js';

/**
 * Contact data actions
 */
interface ContactsActions {
  /** Refresh contact data from database */
  refresh: () => Promise<void>;
  /** Set loading state manually */
  setLoading: (loading: boolean) => void;
  /** Clear any error */
  clearError: () => void;
}

/**
 * Hook for managing contact data
 * @param autoLoad - Whether to load contacts on mount (default: true)
 * @returns Contact state and actions
 */
export function useContacts(autoLoad = true): ContactsState & ContactsActions {
  const [contacts, setContacts] = useState<ContactWithSuppression[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const lastRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const requestId = ++lastRequestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      // Load all contacts (no status filter)
      const allContacts = await getContactsWithSuppression();
      const eligibleCount = await getEligibleContactCount();

      // Only update if this is still the most recent request and component is mounted
      if (isMountedRef.current && requestId === lastRequestIdRef.current) {
        setContacts(allContacts);
        setPendingCount(eligibleCount);
      }
    } catch (err) {
      if (isMountedRef.current && requestId === lastRequestIdRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load contacts';
        setError(errorMessage);
        setContacts([]);
        setPendingCount(0);
      }
    } finally {
      if (isMountedRef.current && requestId === lastRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-load on mount if enabled
  useEffect(() => {
    if (autoLoad) {
      refresh().catch((err) => {
        console.error('Failed to load contacts:', err);
      });
    }
  }, [autoLoad, refresh]);

  // Cleanup on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    contacts,
    pendingCount,
    isLoading,
    error,
    refresh,
    setLoading,
    clearError,
  };
}
