/**
 * SES Configuration Verification Script
 *
 * This script verifies AWS SES configuration by:
 * 1. Loading environment variables from .env.development
 * 2. Creating an SES client with the configured credentials
 * 3. Calling GetSendQuotaCommand to verify AWS connectivity and get quota info
 * 4. Calling GetAccountSendingEnabledCommand to check account sending status
 * 5. Calling ListIdentitiesCommand to list verified identities
 * 6. Displaying clear success/failure messages
 *
 * Usage: bun run scripts/verify-ses.ts
 */

import {
  GetAccountSendingEnabledCommand,
  GetSendQuotaCommand,
  ListIdentitiesCommand,
  SESClient,
} from '@aws-sdk/client-ses';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// ============================================================================
// Environment Configuration
// ============================================================================

/** Required environment variables for SES */
const REQUIRED_ENV_VARS = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

/** Optional environment variables */
const OPTIONAL_ENV_VARS = ['SES_FROM_EMAIL'] as const;

// ============================================================================
// Types
// ============================================================================

interface VerificationResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  present: Record<string, string>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load environment variables from .env.development
 */
function loadEnvironment(): void {
  const envPath = resolve(process.cwd(), '.env.development');
  const result = config({ path: envPath });

  if (result.error) {
    console.error('❌ Failed to load .env.development file');
    console.error(`   Error: ${result.error.message}`);
    console.error('\n   Make sure the file exists in the project root.');
    console.error('   You can copy .env.example to .env.development to get started.');
    process.exit(1);
  }

  console.log('✅ Loaded environment from .env.development\n');
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): EnvValidationResult {
  const missing: string[] = [];
  const present: Record<string, string> = {};

  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key];
    if (!value || value.trim() === '' || value.startsWith('your_')) {
      missing.push(key);
    } else {
      present[key] = value;
    }
  }

  for (const key of OPTIONAL_ENV_VARS) {
    const value = process.env[key];
    if (value && !value.startsWith('your_')) {
      present[key] = value;
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    present,
  };
}

/**
 * Create SES client with configured credentials
 * @returns Object containing the SES client and a cleanup function
 */
function createSESClient(): { client: SESClient; cleanup: () => void } {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';

  const client = new SESClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  // Return client with cleanup function to ensure proper resource management
  const cleanup = () => {
    try {
      client.destroy();
    } catch {
      // Ignore cleanup errors
    }
  };

  return { client, cleanup };
}

/**
 * Format a number with commas for readability
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Get a human-readable account status
 */
function getSendingStatus(enabled: boolean | undefined): string {
  if (enabled === true) return '✅ Enabled';
  if (enabled === false) return '⛔ Disabled';
  return '❓ Unknown';
}

// ============================================================================
// Verification Functions
// ============================================================================

/**
 * Verify SES configuration and connectivity
 */
async function verifySES(): Promise<VerificationResult> {
  const { client, cleanup } = createSESClient();

  try {
    // Step 1: Get Send Quota
    console.log('📊 Checking SES send quota...');
    const quotaCommand = new GetSendQuotaCommand({});
    const quotaResponse = await client.send(quotaCommand);

    console.log('   ✅ Successfully retrieved send quota');
    console.log(`      Max 24-hour send: ${formatNumber(quotaResponse.Max24HourSend || 0)} emails`);
    console.log(`      Max send rate: ${formatNumber(quotaResponse.MaxSendRate || 0)} emails/second`);
    console.log(`      Sent last 24 hours: ${formatNumber(quotaResponse.SentLast24Hours || 0)} emails`);
    console.log(`      Remaining quota: ${formatNumber((quotaResponse.Max24HourSend || 0) - (quotaResponse.SentLast24Hours || 0))} emails\n`);

    // Step 2: Get Account Sending Status
    console.log('📋 Checking SES account status...');
    const accountCommand = new GetAccountSendingEnabledCommand({});
    const accountResponse = await client.send(accountCommand);

    console.log('   ✅ Successfully retrieved account info');
    console.log(`      Sending enabled: ${getSendingStatus(accountResponse.Enabled)}`);

    if (accountResponse.Enabled === false) {
      console.log('\n   ⚠️  Warning: SES sending is currently disabled for this account.');
      console.log('      You may need to:');
      console.log('      • Complete the AWS SES verification process');
      console.log('      • Request production access if still in sandbox mode');
      console.log('      • Check AWS SES console for any compliance issues');
    }

    // Step 3: List Verified Identities
    console.log('\n🔍 Checking verified identities...');
    const identitiesCommand = new ListIdentitiesCommand({});
    const identitiesResponse = await client.send(identitiesCommand);

    const identities = identitiesResponse.Identities || [];
    if (identities.length === 0) {
      console.log('   ⚠️  No verified identities found');
      console.log('      You need to verify email addresses or domains before sending.');
    } else {
      console.log(`   ✅ Found ${identities.length} verified identity/identities:`);
      for (const identity of identities) {
        console.log(`      • ${identity}`);
      }
    }

    // Check SES_FROM_EMAIL configuration
    const fromEmail = process.env.SES_FROM_EMAIL;
    console.log('');
    if (fromEmail && !fromEmail.startsWith('your_')) {
      console.log(`📧 From email configured: ${fromEmail}`);

      // Check if the from email matches a verified identity
      const domain = fromEmail.split('@')[1];
      const isVerified = identities.some(
        (identity) => identity === fromEmail || identity === domain
      );

      if (!isVerified && identities.length > 0) {
        console.log(`\n   ⚠️  Warning: ${fromEmail} is not in the list of verified identities.`);
        console.log('      Emails may fail to send if the from address is not verified.');
      }
    } else {
      console.log('⚠️  Warning: SES_FROM_EMAIL is not configured or is still a placeholder');
    }

    return {
      success: true,
      message: 'SES configuration verified successfully',
      details: {
        quota: {
          max24HourSend: quotaResponse.Max24HourSend,
          maxSendRate: quotaResponse.MaxSendRate,
          sentLast24Hours: quotaResponse.SentLast24Hours,
        },
        sendingEnabled: accountResponse.Enabled,
        identities,
      },
    };
  } catch (error) {
    return handleError(error);
  } finally {
    // Clean up the client using the provided cleanup function
    cleanup();
  }
}

/**
 * Handle errors from AWS API calls
 */
function handleError(error: unknown): VerificationResult {
  if (!error || typeof error !== 'object') {
    return {
      success: false,
      message: 'Unknown error occurred',
    };
  }

  const err = error as {
    name?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };

  const errorName = err.name || err.code || 'UnknownError';
  const errorMessage = err.message || 'No error message provided';

  // Handle specific AWS error codes
  switch (errorName) {
    case 'InvalidClientTokenId':
    case 'SignatureDoesNotMatch':
      return {
        success: false,
        message: '❌ Invalid AWS credentials',
        details: {
          error: 'The AWS Access Key ID or Secret Access Key is invalid.',
          suggestion: 'Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.development',
        },
      };

    case 'OptInRequired':
      return {
        success: false,
        message: '❌ AWS SES is not enabled in your account',
        details: {
          error: 'SES is not activated for this AWS account.',
          suggestion: 'Visit the AWS SES console to enable SES for your account.',
        },
      };

    case 'AccessDenied':
      return {
        success: false,
        message: '❌ Access denied to SES',
        details: {
          error: 'Your AWS credentials do not have permission to access SES.',
          suggestion: 'Ensure your IAM user has ses:SendEmail, ses:GetSendQuota, ses:GetAccountSendingEnabled, and ses:ListIdentities permissions.',
        },
      };

    case 'Throttling':
      return {
        success: false,
        message: '❌ Request throttled by AWS',
        details: {
          error: 'Too many requests to SES API.',
          suggestion: 'Wait a few moments and try again.',
        },
      };

    case 'TimeoutError':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'ETIMEDOUT':
      return {
        success: false,
        message: '❌ Network error connecting to AWS',
        details: {
          error: 'Could not connect to AWS SES endpoint.',
          suggestion: 'Check your internet connection and try again. If you are behind a proxy, ensure proxy settings are configured.',
        },
      };

    default:
      // Check HTTP status code if available
      const statusCode = err.$metadata?.httpStatusCode;
      if (statusCode === 403) {
        return {
          success: false,
          message: '❌ Forbidden - AWS credentials lack required permissions',
          details: {
            error: errorMessage,
            suggestion: 'Verify your IAM policy includes permissions for SES operations.',
          },
        };
      }

      if (statusCode === 500 || statusCode === 503) {
        return {
          success: false,
          message: '❌ AWS service error',
          details: {
            error: 'AWS SES is experiencing issues.',
            suggestion: 'Try again later. Check AWS Service Health Dashboard for outages.',
          },
        };
      }

      return {
        success: false,
        message: `❌ AWS Error: ${errorName}`,
        details: {
          error: errorMessage,
          suggestion: 'Check the error message above and verify your AWS configuration.',
        },
      };
  }
}

// ============================================================================
// Main Script
// ============================================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           AWS SES Configuration Verification Tool');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Load environment
  loadEnvironment();

  // Step 2: Validate environment variables
  const envValidation = validateEnvironment();

  if (!envValidation.valid) {
    console.error('❌ Missing required environment variables:\n');
    for (const key of envValidation.missing) {
      console.error(`   • ${key}`);
    }
    console.error('\n📋 Required environment variables:');
    console.error('   • AWS_REGION - Your AWS region (e.g., us-east-1)');
    console.error('   • AWS_ACCESS_KEY_ID - Your AWS access key');
    console.error('   • AWS_SECRET_ACCESS_KEY - Your AWS secret key');
    console.error('\n💡 Next steps:');
    console.error('   1. Open .env.development in your editor');
    console.error('   2. Fill in all required values (replace "your_..." placeholders)');
    console.error('   3. Run this script again: bun run scripts/verify-ses.ts');
    process.exit(1);
  }

  console.log('✅ All required environment variables are set\n');
  console.log(`   Region: ${envValidation.present.AWS_REGION}`);
  console.log(`   Access Key ID: ${envValidation.present.AWS_ACCESS_KEY_ID.substring(0, 4)}...${envValidation.present.AWS_ACCESS_KEY_ID.slice(-4)}`);

  if (envValidation.present.SES_FROM_EMAIL) {
    console.log(`   From Email: ${envValidation.present.SES_FROM_EMAIL}`);
  }
  console.log('');

  // Step 3: Verify SES connectivity
  const result = await verifySES();

  // Step 4: Display final result
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (result.success) {
    console.log('                    ✅ VERIFICATION SUCCESSFUL');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\n🎉 Your AWS SES configuration is working correctly!');
    console.log('\n💡 Next steps:');
    console.log('   • Run your application: bun run dev');
    console.log('   • If in sandbox mode, verify recipient email addresses first');
    console.log('   • Consider requesting production access to send to unverified addresses');
  } else {
    console.log('                    ❌ VERIFICATION FAILED');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`\n${result.message}`);
    if (result.details?.error) {
      console.log(`\n   Error details: ${result.details.error}`);
    }
    if (result.details?.suggestion) {
      console.log(`\n   Suggestion: ${result.details.suggestion}`);
    }
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Run the main function
main().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
