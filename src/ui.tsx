/**
 * Terminal UI Components for TermiSend
 * Built with Ink (React for terminals)
 */

import { Box, Spacer, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
/** @jsxImportSource react */
import React, { useCallback, useState } from 'react';
import { getPendingContacts } from './db.js';
import { importExcelFile } from './importer.js';
import { generatePreview, runCampaign } from './mailer.js';
import type { AppView, CampaignResult, Contact, ImportResult } from './types.js';

// ============================================================================
// Types
// ============================================================================

type MenuItem = {
  label: string;
  value: string;
};

type ImportStatus = 'idle' | 'loading' | 'success' | 'error';
type CampaignStatus = 'idle' | 'loading' | 'preview' | 'confirm' | 'running' | 'success' | 'error';

// ============================================================================
// Main App Component
// ============================================================================

export default function App(): React.ReactElement {
  const [currentView, setCurrentView] = useState<AppView>('MENU');
  const { exit } = useApp();

  const handleMenuSelect = useCallback(
    (item: MenuItem) => {
      if (item.value === 'quit') {
        exit();
      } else if (item.value === 'import') {
        setCurrentView('IMPORT');
      } else if (item.value === 'campaign') {
        setCurrentView('CAMPAIGN');
      }
    },
    [exit]
  );

  const handleBack = useCallback(() => {
    setCurrentView('MENU');
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Header />
      <Box marginTop={1}>
        {currentView === 'MENU' && <MainMenu onSelect={handleMenuSelect} />}
        {currentView === 'IMPORT' && <ImportView onBack={handleBack} />}
        {currentView === 'CAMPAIGN' && <CampaignView onBack={handleBack} />}
      </Box>
    </Box>
  );
}

// ============================================================================
// Header Component
// ============================================================================

function Header(): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold={true} color="cyan">
        📧 TermiSend
      </Text>
      <Spacer />
      <Text dimColor={true}>Local Email Outreach CLI</Text>
    </Box>
  );
}

// ============================================================================
// Main Menu Component
// ============================================================================

const menuItems: MenuItem[] = [
  { label: '📥 Import Excel Contacts', value: 'import' },
  { label: '📤 Send Email Campaign', value: 'campaign' },
  { label: '❌ Quit', value: 'quit' },
];

interface MainMenuProps {
  onSelect: (item: MenuItem) => void;
}

function MainMenu({ onSelect }: MainMenuProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold={true} underline={true} color="white">
        Main Menu
      </Text>
      <Box marginTop={1}>
        <SelectInput items={menuItems} onSelect={onSelect} />
      </Box>
    </Box>
  );
}

// ============================================================================
// Import View Component
// ============================================================================

interface ImportViewProps {
  onBack: () => void;
}

function ImportView({ onBack }: ImportViewProps): React.ReactElement {
  const [filePath, setFilePath] = useState('');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  const handleSubmit = useCallback(async () => {
    if (!filePath.trim()) {
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      const importResult = await importExcelFile(filePath.trim());
      setResult(importResult);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [filePath]);

  if (status === 'success' && result) {
    return (
      <Box flexDirection="column">
        <Text bold={true} color="green">
          ✓ Import Complete!
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Total Rows: {result.totalRows}</Text>
          <Text color="green">Successfully Imported: {result.successCount}</Text>
          <Text color={result.failedCount > 0 ? 'red' : 'green'}>Failed: {result.failedCount}</Text>
          {result.errors.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold={true} color="yellow">
                Errors:
              </Text>
              {result.errors.slice(0, 5).map((err) => (
                <Text key={`error-${err.row}`} color="red" dimColor={true}>
                  Row {err.row}: {err.error}
                </Text>
              ))}
              {result.errors.length > 5 && (
                <Text dimColor={true}>...and {result.errors.length - 5} more</Text>
              )}
            </Box>
          )}
        </Box>
        <Box marginTop={2}>
          <Text dimColor={true}>Press any key to go back...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text bold={true} color="red">
          ✗ Import Failed
        </Text>
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
        <Box marginTop={2}>
          <Text dimColor={true}>Press Escape to go back...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold={true} underline={true}>
        Import Excel Contacts
      </Text>
      <Box marginTop={1}>
        <Text>Excel File Path: </Text>
        <TextInput
          value={filePath}
          onChange={setFilePath}
          onSubmit={handleSubmit}
          placeholder="./contacts.xlsx"
        />
      </Box>
      {status === 'loading' ? (
        <Box marginTop={1}>
          <Text color="yellow">Importing contacts...</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor={true}>Enter the path to your Excel file and press Enter</Text>
          <Text dimColor={true}>Press Escape to go back</Text>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Campaign View Component
// ============================================================================

interface CampaignViewProps {
  onBack: () => void;
}

function CampaignView({ onBack }: CampaignViewProps): React.ReactElement {
  const [templatePath, setTemplatePath] = useState('');
  const [status, setStatus] = useState<CampaignStatus>('idle');
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [preview, setPreview] = useState<{ subject: string; textBody: string } | null>(null);

  useInput((input, key) => {
    if (key.escape && status !== 'running') {
      onBack();
    }
    if (status === 'confirm' && (input === 'y' || input === 'Y')) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      handleConfirm(true).catch(() => {
        // Error already handled in handleConfirm
      });
    }
    if (status === 'confirm' && (input === 'n' || input === 'N')) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      handleConfirm(false).catch(() => {
        // Error already handled in handleConfirm
      });
    }
  });

  const loadPendingCount = useCallback(async () => {
    try {
      const contacts = await getPendingContacts();
      setPendingCount(contacts.length);
    } catch {
      setPendingCount(0);
    }
  }, []);

  // Load pending count on mount
  React.useEffect(() => {
    loadPendingCount().catch((err) => {
      console.error('Failed to load pending count:', err);
      // Keep pending count at 0, error is non-critical
    });
  }, [loadPendingCount]);

  const handleSubmit = useCallback(async () => {
    if (!templatePath.trim()) {
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      // Generate preview with first pending contact
      const contacts = await getPendingContacts();
      if (contacts.length === 0) {
        setError('No pending contacts found. Import contacts first.');
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
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [templatePath]);

  const startCampaign = useCallback(async () => {
    setStatus('running');

    try {
      const campaignResult = await runCampaign(templatePath.trim());
      setResult(campaignResult);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [templatePath]);

  const handleConfirm = useCallback(
    async (confirmed: boolean) => {
      if (!confirmed) {
        setStatus('idle');
        return;
      }

      try {
        await startCampaign();
      } catch (err) {
        console.error('Failed to start campaign:', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [startCampaign]
  );

  if (status === 'success' && result) {
    return (
      <Box flexDirection="column">
        <Text bold={true} color="green">
          ✓ Campaign Complete!
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Total Contacts: {result.totalContacts}</Text>
          <Text color="green">Emails Sent: {result.sentCount}</Text>
          <Text color="yellow">Skipped (Invalid): {result.skippedCount}</Text>
          <Text color="red">Failed: {result.failedCount}</Text>
        </Box>
        <Box marginTop={2}>
          <Text dimColor={true}>Press any key to go back...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text bold={true} color="red">
          ✗ Campaign Failed
        </Text>
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
        <Box marginTop={2}>
          <Text dimColor={true}>Press Escape to go back...</Text>
        </Box>
      </Box>
    );
  }

  if (status === 'confirm' && preview) {
    return (
      <Box flexDirection="column">
        <Text bold={true} underline={true}>
          Campaign Preview
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Pending Contacts: {pendingCount}</Text>
          <Text>Template: {templatePath}</Text>
        </Box>
        <Box marginTop={1} borderStyle="single" padding={1}>
          <Text bold={true}>Subject: {preview.subject}</Text>
          <Box marginTop={1}>
            <Text dimColor={true}>{preview.textBody.slice(0, 200)}...</Text>
          </Box>
        </Box>
        <Box marginTop={2} flexDirection="column">
          <Text bold={true} color="yellow">
            Start campaign? (y/n)
          </Text>
        </Box>
      </Box>
    );
  }

  if (status === 'running') {
    return (
      <Box flexDirection="column">
        <Text bold={true} color="yellow">
          ⏳ Sending Emails...
        </Text>
        <Box marginTop={1}>
          <Text>This may take a while. Please wait...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold={true} underline={true}>
        Send Email Campaign
      </Text>
      <Box marginTop={1}>
        <Text>Pending Contacts: </Text>
        <Text color={pendingCount > 0 ? 'green' : 'yellow'}>{pendingCount}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Template Path: </Text>
        <TextInput
          value={templatePath}
          onChange={setTemplatePath}
          onSubmit={handleSubmit}
          placeholder="./template.md"
        />
      </Box>
      {status === 'loading' ? (
        <Box marginTop={1}>
          <Text color="yellow">Loading preview...</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor={true}>Enter the path to your markdown template and press Enter</Text>
          <Text dimColor={true}>Press Escape to go back</Text>
        </Box>
      )}
    </Box>
  );
}
