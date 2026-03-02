/**
 * Unit Tests for Database Reset Function
 * Tests guardrails and safety mechanisms
 */

import { beforeEach, describe, expect, it, mock, type Mock, afterEach } from 'bun:test';
import { resetEnvCacheForTesting } from '../../src/config.js';

// ============================================================================
// Module Mocks - Must be defined before importing the module under test
// ============================================================================

// Create a mock sql function that can be controlled in tests
const mockSqlFn = Object.assign(
  mock((strings: TemplateStringsArray, ...values: unknown[]) => {
    return Promise.resolve<unknown[]>([]);
  }) as Mock<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>,
  {
    json: (data: unknown) => JSON.stringify(data),
    end: () => Promise.resolve(),
  }
);

// Mock the postgres module
mock.module('postgres', () => {
  return {
    default: () => mockSqlFn,
    __esModule: true,
  };
});

// Mock console.warn and console.error to capture warnings
let warnings: string[] = [];
let errors: string[] = [];

const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  warnings = [];
  errors = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  // Reset environment cache
  resetEnvCacheForTesting();
});

afterEach(() => {
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Now import the db module after mocking
const { resetDatabase, resetSqlClient } = await import('../../src/db.js');

// ============================================================================
// Test Setup
// ============================================================================

const originalEnv = { ...process.env };
const originalArgv = process.argv;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.argv = [...originalArgv];
  resetEnvCacheForTesting();
  resetSqlClient();
});

afterEach(() => {
  process.env = { ...originalEnv };
  process.argv = [...originalArgv];
  resetEnvCacheForTesting();
  resetSqlClient();
});

// Clean up process state for flag-based tests
afterEach(() => {
  process.argv = process.argv.filter(arg => !arg.startsWith('-'));
  delete process.env.NODE_ENV;
  delete process.env.DB_NAME;
  delete process.env.ALLOW_DEV_RESET;
});

// ============================================================================
// Database Reset Tests
// ============================================================================

describe('resetDatabase()', () => {
  describe('Guardrail: Production Environment', () => {
    it('should throw error when NODE_ENV is production', async () => {
      process.env.NODE_ENV = 'production';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Cannot reset database in production environment'
      );
    });

    it('should throw error when NODE_ENV is "production"', async () => {
      process.env.NODE_ENV = 'production';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Cannot reset database in production environment'
      );
    });
  });

  describe('Guardrail: Production Database Name', () => {
    it('should throw error when DB_NAME contains "prod"', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_prod';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Detected production database name'
      );
    });

    it('should throw error when DB_NAME contains "production"', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_production';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Detected production database name'
      );
    });

    it('should throw error when DB_NAME is exactly "production"', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'production';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Detected production database name'
      );
    });
  });

  describe('Guardrail: Confirmation Required', () => {
    it('should throw error when no confirmation provided', async () => {
      process.env.NODE_ENV = 'development';
      // No --confirm-reset flag
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Confirmation required'
      );
    });

    it('should throw error when ALLOW_DEV_RESET is not set', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOW_DEV_RESET;
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Confirmation required'
      );
    });

    it('should throw error when ALLOW_DEV_RESET is "false"', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_DEV_RESET = 'false';
      resetEnvCacheForTesting();

      await expect(resetDatabase()).rejects.toThrow(
        'Confirmation required'
      );
    });
  });

  describe('Valid Reset in Development', () => {
    it('should succeed with --confirm-reset flag', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_dev';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await resetDatabase();

      expect(result.success).toBe(true);
      expect(result.message).toContain('reset successfully');
    });

    it('should succeed with ALLOW_DEV_RESET=true env var', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_dev';
      process.env.ALLOW_DEV_RESET = 'true';
      resetEnvCacheForTesting();

      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await resetDatabase();

      expect(result.success).toBe(true);
      expect(result.message).toContain('reset successfully');
    });

    it('should succeed with -y flag (shorthand)', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_dev';
      process.argv.push('-y');
      resetEnvCacheForTesting();

      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      const result = await resetDatabase();

      expect(result.success).toBe(true);
    });

    it('should log warning before resetting', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_dev';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      await resetDatabase();

      expect(warnings.some((w) => w.includes('WARNING'))).toBe(true);
      expect(warnings.some((w) => w.includes('DELETE ALL DATA'))).toBe(true);
    });

    it('should execute TRUNCATE CASCADE query', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_dev';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      let queryExecuted = '';
      mockSqlFn.mockImplementation((strings: TemplateStringsArray) => {
        queryExecuted = strings.join('');
        return Promise.resolve([]);
      });

      await resetDatabase();

      expect(queryExecuted).toContain('TRUNCATE TABLE');
      expect(queryExecuted).toContain('contacts');
      expect(queryExecuted).toContain('audit_logs');
      expect(queryExecuted).toContain('email_verifier_credits');
      expect(queryExecuted).toContain('RESTART IDENTITY');
      expect(queryExecuted).toContain('CASCADE');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DB_NAME = 'termisend_dev';
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      mockSqlFn.mockImplementation(() => Promise.reject(new Error('Connection failed')));

      await expect(resetDatabase()).rejects.toThrow(
        'Database reset failed'
      );
    });
  });
});

describe('Security: Impossible to accidentally reset production', () => {
  const testCases = [
    { env: 'production', dbName: 'termisend', shouldFail: true },
    { env: 'production', dbName: 'termisend_prod', shouldFail: true },
    { env: 'production', dbName: 'termisend_dev', shouldFail: true },
    { env: 'development', dbName: 'termisend_prod', shouldFail: true },
    { env: 'development', dbName: 'production', shouldFail: true },
    { env: 'development', dbName: 'termisend_dev', shouldFail: false },
    { env: 'development', dbName: 'termisend', shouldFail: false },
    { env: undefined, dbName: 'termisend', shouldFail: false }, // NODE_ENV not set defaults to dev
  ];

  testCases.forEach(({ env, dbName, shouldFail }) => {
    const envDesc = env === undefined ? 'NODE_ENV not set' : `NODE_ENV=${env}`;
    const dbDesc = `DB_NAME=${dbName}`;
    const withConfirmation = '--confirm-reset';

    it(`${shouldFail ? 'should FAIL' : 'should succeed'} with ${envDesc}, ${dbDesc}, ${withConfirmation}`, async () => {
      process.env.NODE_ENV = env;
      process.env.DB_NAME = dbName;
      process.argv.push('--confirm-reset');
      resetEnvCacheForTesting();

      mockSqlFn.mockImplementation(() => Promise.resolve([]));

      if (shouldFail) {
        await expect(resetDatabase()).rejects.toThrow();
      } else {
        const result = await resetDatabase();
        expect(result.success).toBe(true);
      }
    });
  });
});
