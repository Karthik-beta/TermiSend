/**
 * ContactList
 *
 * Purpose: Displays imported contacts with statistics and preview
 * Props: { contacts: Contact[], pendingCount: number, isLoading?: boolean }
 * State: None - Presentational component
 * Extension: Add pagination, search/filter, or bulk actions
 */

/** @jsxImportSource react */
import { Box, Text } from 'ink';
import type React from 'react';
import type { ContactWithSuppression } from '../../types.js';
import { colors, spacing } from '../theme.js';
import { Panel } from './Panel.js';

interface ContactListProps {
  /** List of contacts to display */
  contacts: ContactWithSuppression[];
  /** Number of pending contacts */
  pendingCount: number;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Maximum number of contacts to show */
  maxDisplay?: number;
  /** Maximum height for the contact list */
  maxHeight?: number;
}

export function ContactList({
  contacts,
  pendingCount,
  isLoading = false,
  maxDisplay = 10,
  maxHeight,
}: ContactListProps): React.ReactElement {
  const displayedContacts = contacts.slice(0, maxDisplay);
  const remainingCount = Math.max(0, contacts.length - maxDisplay);

  if (isLoading) {
    return (
      <Panel title="📇 Contacts" borderColor={colors.secondary} flexGrow={1} height={maxHeight}>
        <Text dimColor={true}>Loading contacts...</Text>
      </Panel>
    );
  }

  return (
    <Panel title="📇 Contacts" borderColor={colors.secondary} flexGrow={1} height={maxHeight}>
      {/* Stats Summary */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text dimColor={true}>Pending: </Text>
          <Text bold={true} color={pendingCount > 0 ? colors.success : colors.warning}>
            {pendingCount}
          </Text>
        </Box>
        <Box>
          <Text dimColor={true}>Total: </Text>
          <Text>{contacts.length}</Text>
        </Box>
      </Box>

      {/* Contact List */}
      {displayedContacts.length > 0 ? (
        <Box flexDirection="column" gap={spacing.xs}>
          {displayedContacts.map((contact, index) => (
            <Box key={contact.id} flexDirection="column">
              <Box>
                <Text dimColor={true}>{index + 1}.</Text>
                <Text> {contact.companyName}</Text>
                {contact.suppressionType ? (
                  <Text color={colors.warning}> [BLOCKED]</Text>
                ) : null}
              </Box>
              <Box paddingLeft={3}>
                <Text dimColor={true} wrap="truncate-end">
                  {contact.personName} · {contact.email}
                </Text>
              </Box>
              {contact.suppressionReason ? (
                <Box paddingLeft={3}>
                  <Text color={colors.warning} dimColor={true} wrap="truncate-end">
                    {contact.suppressionReason}
                  </Text>
                </Box>
              ) : null}
            </Box>
          ))}
          {remainingCount > 0 && (
            <Box marginTop={1}>
              <Text dimColor={true}>...and {remainingCount} more</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box>
          <Text dimColor={true}>No contacts imported yet.</Text>
        </Box>
      )}
    </Panel>
  );
}
