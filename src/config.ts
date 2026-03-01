/**
 * Configuration module for TermiSend
 * Centralized environment variable loading and configuration using dotenv
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// ============================================================================
// Environment Configuration
// ============================================================================

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';

/**
 * Load environment variables from the appropriate .env file
 * Uses dotenv for robust parsing
 * @returns Record of environment variables
 */
export function loadEnv(): Record<string, string> {
  try {
    // Check if env file exists first
    const envPath = resolve(process.cwd(), envFile);
    readFileSync(envPath, 'utf-8');

    // Load using dotenv
    const result = config({ path: envPath });

    if (result.error) {
      console.warn(`Warning: Could not load ${envFile}:`, result.error.message);
      return {};
    }

    // Return parsed environment variables
    return result.parsed || {};
  } catch {
    // File doesn't exist or can't be read
    return {};
  }
}

// Cache for loaded environment
let cachedEnv: Record<string, string> | null = null;

/**
 * Get environment variables with caching
 * @returns Record of environment variables (cached after first call)
 */
export function getEnv(): Record<string, string> {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}

/**
 * Clear the environment cache (useful for testing)
 */
export function clearEnvCache(): void {
  cachedEnv = null;
}
