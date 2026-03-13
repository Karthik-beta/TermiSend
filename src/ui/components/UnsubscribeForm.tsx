/**
 * UnsubscribeForm
 *
 * Purpose: Manual unsubscribe intake for operators who receive removal requests by email.
 */

/** @jsxImportSource react */
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type React from 'react';
import { useEffect } from 'react';
import { shutdown } from '../../shutdown.js';
import { useUnsubscribe } from '../hooks/useUnsubscribe.js';
import { colors, icons, spacing } from '../theme.js';
import { ErrorText, SuccessText, WarningText } from './common/Text.js';
import { Panel } from './Panel.js';

interface UnsubscribeFormProps {
  onUnsubscribeComplete?: () => void;
}

export function UnsubscribeForm({
  onUnsubscribeComplete,
}: UnsubscribeFormProps): React.ReactElement {
  const { exit } = useApp();
  const {
    unsubscribeStatus,
    unsubscribeResult,
    unsubscribeError,
    email,
    setEmail,
    submit,
    reset,
  } = useUnsubscribe();

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      shutdown();
      exit();
      setTimeout(() => process.exit(0), 100);
      return;
    }

    if (key.escape && unsubscribeStatus !== 'loading') {
      reset();
    }
  });

  useEffect(() => {
    if (unsubscribeStatus === 'success' && unsubscribeResult?.status === 'created') {
      onUnsubscribeComplete?.();
    }
  }, [onUnsubscribeComplete, unsubscribeResult, unsubscribeStatus]);

  if (unsubscribeStatus === 'success' && unsubscribeResult) {
    const wasCreated = unsubscribeResult.status === 'created';

    return (
      <Panel
        title={wasCreated ? `${icons.success} Unsubscribe Saved` : `${icons.warning} Already Blocked`}
        borderColor={wasCreated ? colors.warningBright : colors.secondary}
      >
        <Box flexDirection="column" gap={spacing.xs}>
          <Box borderStyle="round" borderColor={colors.dim} paddingX={1}>
            <Text dimColor={true}>Address</Text>
            <Text> </Text>
            <Text bold={true} color={colors.white}>
              {unsubscribeResult.email}
            </Text>
          </Box>

          {wasCreated ? (
            <WarningText>This email is now blocked from all future campaign sends.</WarningText>
          ) : (
            <SuccessText>
              This email was already protected by an existing suppression rule.
            </SuccessText>
          )}

          <Box flexDirection="column" marginTop={1}>
            <Text dimColor={true}>Suppression Type: {unsubscribeResult.suppressionType}</Text>
            <Text dimColor={true}>Reason: {unsubscribeResult.suppressionReason}</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor={true}>Press Escape to clear the form</Text>
            <Text dimColor={true}>Press Q to quit</Text>
          </Box>
        </Box>
      </Panel>
    );
  }

  if (unsubscribeStatus === 'error') {
    return (
      <Panel title={`${icons.error} Unsubscribe Failed`} borderColor={colors.error}>
        <Box flexDirection="column" gap={spacing.xs}>
          <ErrorText>{unsubscribeError}</ErrorText>
          <Text dimColor={true}>Press Escape to try again</Text>
        </Box>
      </Panel>
    );
  }

  return (
    <Panel title=">> Manual Unsubscribe" borderColor={colors.warning}>
      <Box flexDirection="column" gap={spacing.xs}>
        <Box borderStyle="round" borderColor={colors.secondary} paddingX={1}>
          <Text color={colors.secondaryBright}>Inbox triage</Text>
          <Text dimColor={true}> Paste one address you never want emailed again.</Text>
        </Box>

        <Box>
          <Text>Email Address: </Text>
          <TextInput
            value={email}
            onChange={setEmail}
            onSubmit={() => {
              submit().catch(() => {
                // Error is surfaced in hook state
              });
            }}
            placeholder="client@example.com"
          />
        </Box>

        {unsubscribeStatus === 'loading' && (
          <Box>
            <Text color={colors.warningBright}>Recording unsubscribe...</Text>
          </Box>
        )}

        {unsubscribeStatus !== 'loading' && (
          <Box flexDirection="column">
            <Text dimColor={true}>Press Enter to save the unsubscribe</Text>
            <Text dimColor={true}>Press Escape to clear the form</Text>
          </Box>
        )}
      </Box>
    </Panel>
  );
}
