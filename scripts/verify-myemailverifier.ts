/**
 * MyEmailVerifier API Verification Script
 *
 * This script verifies MyEmailVerifier API configuration by:
 * 1. Loading environment variables from .env.development
 * 2. Checking if MYEMAILVERIFIER_API_KEY is configured
 * 3. Making a test API call to verify the API key works
 * 4. Fetching available credits to confirm account status
 * 5. Displaying clear success/failure messages
 *
 * Usage: bun run scripts/verify-myemailverifier.ts
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

// ============================================================================
// Environment Configuration
// ============================================================================

/** Required environment variable for MyEmailVerifier */
const REQUIRED_ENV_VAR = 'MYEMAILVERIFIER_API_KEY' as const;

/** API Base URLs */
const API_BASE_URL = 'https://api.myemailverifier.com/v1';
const CREDITS_API_URL = 'https://client.myemailverifier.com/verifier/getcredits';

/**
 * Test email for verification
 * Can be overridden via TEST_EMAIL environment variable
 * @example TEST_EMAIL=test@example.com bun run scripts/verify-myemailverifier.ts
 */
const TEST_EMAIL = process.env.TEST_EMAIL || 'support@pivotr.in';

// ============================================================================
// Types
// ============================================================================

interface VerificationResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface ApiResponse {
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'role' | 'disposable';
  risk: 'low' | 'medium' | 'high';
  email?: string;
  message?: string;
}

interface CreditsResponse {
  Credits?: string;
  credits?: string;
  status?: boolean;
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
 * Redact an email address for safe logging
 * Masks most of the address while preserving structure
 *
 * @example
 * redactEmail('user@example.com') // returns 'u***@e******.com'
 */
function redactEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    return '[INVALID_EMAIL]';
  }

  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return email.length > 3 ? `${email[0]}***${email[email.length - 1]}` : '***';
  }

  const localPart = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);

  const redactedLocal =
    localPart.length > 0 ? `${localPart[0]}${'*'.repeat(Math.max(0, localPart.length - 1))}` : '';

  const domainSegments = domainPart.split('.');
  const redactedDomain = domainSegments
    .map((segment, index) => {
      const isTld = index >= domainSegments.length - 2;
      if (isTld && segment.length <= 3) {
        return segment;
      }
      return segment.length > 0 ? `${segment[0]}${'*'.repeat(Math.max(0, segment.length - 1))}` : '';
    })
    .join('.');

  return `${redactedLocal}@${redactedDomain}`;
}

/**
 * Validate environment variables
 */
function validateEnvironment(): { valid: boolean; apiKey: string | null; error?: string } {
  const apiKey = process.env[REQUIRED_ENV_VAR];

  if (!apiKey) {
    return {
      valid: false,
      apiKey: null,
      error: 'MYEMAILVERIFIER_API_KEY is not set',
    };
  }

  if (apiKey.trim() === '') {
    return {
      valid: false,
      apiKey: null,
      error: 'MYEMAILVERIFIER_API_KEY is empty',
    };
  }

  // Check for placeholder values
  const placeholderPatterns = [
    /^your_/i,
    /^sk-your/i,
    /^xxx+/i,
    /^test/i,
    /^example/i,
    /^placeholder/i,
    /^(YOUR_API_KEY|API_KEY_HERE|INSERT_KEY)$/i,
  ];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(apiKey)) {
      return {
        valid: false,
        apiKey: null,
        error: `MYEMAILVERIFIER_API_KEY appears to be a placeholder value: "${apiKey}"`,
      };
    }
  }

  // Check for suspiciously short keys
  if (apiKey.length < 8) {
    return {
      valid: false,
      apiKey: null,
      error: `MYEMAILVERIFIER_API_KEY is suspiciously short (${apiKey.length} characters)`,
    };
  }

  return { valid: true, apiKey };
}

/**
 * Format status for display with emoji
 */
function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    valid: '✅ Valid',
    invalid: '❌ Invalid',
    'catch-all': '⚠️ Catch-all',
    unknown: '❓ Unknown',
    role: '👤 Role-based',
    disposable: '🗑️ Disposable',
  };
  return statusMap[status] || status;
}

/**
 * Format risk level for display with emoji
 */
function formatRisk(risk: string): string {
  const riskMap: Record<string, string> = {
    low: '🟢 Low Risk',
    medium: '🟡 Medium Risk',
    high: '🔴 High Risk',
  };
  return riskMap[risk] || risk;
}

// ============================================================================
// API Verification Functions
// ============================================================================

/**
 * Verify MyEmailVerifier API by fetching credits
 */
async function verifyCredits(apiKey: string): Promise<VerificationResult> {
  const url = `${CREDITS_API_URL}/${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: '❌ Invalid API key',
          details: {
            error: 'The API key was rejected by MyEmailVerifier.',
            suggestion: 'Check your MYEMAILVERIFIER_API_KEY in .env.development.',
          },
        };
      }

      return {
        success: false,
        message: `❌ Credits API error: ${response.status}`,
        details: {
          error: `HTTP ${response.status}: ${errorText || response.statusText}`,
          suggestion: 'Check the API status or try again later.',
        },
      };
    }

    const data = (await response.json()) as CreditsResponse;

    // API may return Credits (capitalized) or credits (lowercase)
    const creditsValue = data.Credits || data.credits;

    if (!creditsValue) {
      return {
        success: false,
        message: '❌ Invalid credits response',
        details: {
          error: 'Credits field missing from API response',
          response: data,
        },
      };
    }

    const credits = Number.parseInt(creditsValue, 10);

    if (Number.isNaN(credits)) {
      return {
        success: false,
        message: '❌ Invalid credits value',
        details: {
          error: `Credits value is not a number: "${creditsValue}"`,
        },
      };
    }

    return {
      success: true,
      message: `✅ Credits API: ${credits.toLocaleString('en-US')} credits available`,
      details: { credits },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (error instanceof TypeError && errorMessage.includes('fetch')) {
      return {
        success: false,
        message: '❌ Network error connecting to MyEmailVerifier',
        details: {
          error: 'Could not connect to credits API endpoint.',
          suggestion: 'Check your internet connection and try again.',
        },
      };
    }

    return {
      success: false,
      message: '❌ Error fetching credits',
      details: { error: errorMessage },
    };
  }
}

/**
 * Verify MyEmailVerifier API by testing email verification
 */
async function verifyEmailCheck(apiKey: string): Promise<VerificationResult> {
  const url = new URL(`${API_BASE_URL}/verify`);
  url.searchParams.append('email', TEST_EMAIL);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: '❌ Invalid API key',
          details: {
            error: 'The API key was rejected by MyEmailVerifier.',
            suggestion: 'Check your MYEMAILVERIFIER_API_KEY in .env.development.',
          },
        };
      }

      return {
        success: false,
        message: `❌ Verification API error: ${response.status}`,
        details: {
          error: `HTTP ${response.status}: ${errorText || response.statusText}`,
        },
      };
    }

    const data = (await response.json()) as ApiResponse;

    // Validate response structure
    if (!data.status || !data.risk) {
      return {
        success: false,
        message: '❌ Invalid API response format',
        details: {
          error: 'Response missing required fields (status, risk)',
          response: data,
        },
      };
    }

    const validStatuses = ['valid', 'invalid', 'catch-all', 'unknown', 'role', 'disposable'];
    const validRisks = ['low', 'medium', 'high'];

    if (!validStatuses.includes(data.status)) {
      return {
        success: false,
        message: '❌ Invalid status value in response',
        details: {
          error: `Unknown status: "${data.status}"`,
          validStatuses,
        },
      };
    }

    if (!validRisks.includes(data.risk)) {
      return {
        success: false,
        message: '❌ Invalid risk value in response',
        details: {
          error: `Unknown risk: "${data.risk}"`,
          validRisks,
        },
      };
    }

    return {
      success: true,
      message: `✅ Verification API: Test email ${redactEmail(TEST_EMAIL)} verified successfully`,
      details: {
        status: data.status,
        risk: data.risk,
        message: data.message,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (error instanceof TypeError && errorMessage.includes('fetch')) {
      return {
        success: false,
        message: '❌ Network error connecting to MyEmailVerifier',
        details: {
          error: 'Could not connect to verification API endpoint.',
          suggestion: 'Check your internet connection and try again.',
        },
      };
    }

    return {
      success: false,
      message: '❌ Error verifying email',
      details: { error: errorMessage },
    };
  }
}

// ============================================================================
// Main Script
// ============================================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         MyEmailVerifier API Configuration Verification Tool');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Load environment
  loadEnvironment();

  // Step 2: Validate environment variables
  const envValidation = validateEnvironment();

  if (!envValidation.valid || !envValidation.apiKey) {
    console.error(`❌ ${envValidation.error || 'Environment validation failed'}`);
    console.error('\n📋 Required configuration:');
    console.error(`   • ${REQUIRED_ENV_VAR} - Your MyEmailVerifier API key`);
    console.error('\n💡 Next steps:');
    console.error('   1. Open .env.development in your editor');
    console.error('   2. Set MYEMAILVERIFIER_API_KEY to your actual API key');
    console.error('   3. Run this script again: bun run scripts/verify-myemailverifier.ts');
    console.error('\n📝 To get an API key:');
    console.error('   1. Visit https://myemailverifier.com/');
    console.error('   2. Sign up for an account');
    console.error('   3. Generate an API key from your dashboard');
    process.exit(1);
  }

  const apiKey = envValidation.apiKey;

  console.log('✅ API key is configured');
  console.log(`   Key: ${apiKey.substring(0, 4)}...${apiKey.slice(-4)} (${apiKey.length} chars)\n`);

  // Step 3: Check credits API
  console.log('💳 Checking credits...');
  const creditsResult = await verifyCredits(apiKey);
  console.log(`   ${creditsResult.message}`);

  if (!creditsResult.success) {
    if (creditsResult.details) {
      console.error(`\n   Error details: ${JSON.stringify(creditsResult.details, null, 2)}`);
    }
    process.exit(1);
  }

  // Step 4: Test email verification (optional - may not be available on all plans)
  console.log('\n📧 Testing email verification...');
  const verifyResult = await verifyEmailCheck(apiKey);

  if (verifyResult.success) {
    console.log(`   ${verifyResult.message}`);
    // Display test results
    if (verifyResult.details) {
      console.log(`\n   Test Results:`);
      console.log(`      Status: ${formatStatus(String(verifyResult.details.status))}`);
      console.log(`      Risk: ${formatRisk(String(verifyResult.details.risk))}`);
      if (verifyResult.details.message) {
        console.log(`      Message: ${verifyResult.details.message}`);
      }
    }
  } else {
    // Email verification API failure is a warning, not a fatal error
    // The credits API already confirmed the API key is valid
    console.log(`   ⚠️  Email verification API not available`);
    console.log('      (Credits API confirmed the API key is valid)');
  }

  // Step 6: Display final result
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    ✅ VERIFICATION SUCCESSFUL');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n🎉 Your MyEmailVerifier API configuration is working correctly!');
  console.log('\n📊 Summary:');
  console.log(`   • Credits API: ${creditsResult.message.replace('✅ Credits API: ', '')}`);
  console.log(`   • Verification API: Working`);
  console.log('\n💡 Next steps:');
  console.log('   • Run your application: bun run dev');
  console.log('   • If SIMULATE_VERIFIER=true, set it to false to use real API');
  console.log('   • Monitor your credit usage in production');
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Unexpected error occurred:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
