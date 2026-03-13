/**
 * useUnsubscribe Hook
 *
 * Purpose: Manages manual unsubscribe submission state for the dashboard
 */

import { useCallback, useState } from 'react';
import { unsubscribeEmail } from '../../unsubscribe.js';
import type { UnsubscribeResult } from '../../types.js';
import type { UnsubscribeStatus } from '../types.js';

interface UseUnsubscribeReturn {
  unsubscribeStatus: UnsubscribeStatus;
  unsubscribeResult: UnsubscribeResult | null;
  unsubscribeError: string | null;
  email: string;
  setEmail: (email: string) => void;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useUnsubscribe(): UseUnsubscribeReturn {
  const [unsubscribeStatus, setUnsubscribeStatus] = useState<UnsubscribeStatus>('idle');
  const [unsubscribeResult, setUnsubscribeResult] = useState<UnsubscribeResult | null>(null);
  const [unsubscribeError, setUnsubscribeError] = useState<string | null>(null);
  const [email, setEmailState] = useState('');

  const setEmail = useCallback((nextEmail: string) => {
    setEmailState(nextEmail);
  }, []);

  const submit = useCallback(async () => {
    if (!email.trim()) {
      setUnsubscribeError('Please enter an email address');
      setUnsubscribeStatus('error');
      return;
    }

    setUnsubscribeStatus('loading');
    setUnsubscribeError(null);
    setUnsubscribeResult(null);

    try {
      const result = await unsubscribeEmail(email);
      setUnsubscribeResult(result);
      setUnsubscribeStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setUnsubscribeError(errorMessage);
      setUnsubscribeStatus('error');
    }
  }, [email]);

  const reset = useCallback(() => {
    setUnsubscribeStatus('idle');
    setUnsubscribeResult(null);
    setUnsubscribeError(null);
    setEmailState('');
  }, []);

  return {
    unsubscribeStatus,
    unsubscribeResult,
    unsubscribeError,
    email,
    setEmail,
    submit,
    reset,
  };
}
