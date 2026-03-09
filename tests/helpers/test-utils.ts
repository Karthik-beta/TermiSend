/**
 * Test Utilities for TermiSend
 * Centralized helpers for test setup, mocking, and cleanup
 */

import { spyOn, type Mock } from 'bun:test';

// ============================================================================
// Environment Variable Helpers
// ============================================================================

/** Original environment variables storage */
const originalEnv: Record<string, string | undefined> = {};

/**
 * Set environment variables for testing
 * @param env - Object containing environment variables to set
 */
export function setMockEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!(key in originalEnv)) {
      originalEnv[key] = process.env[key];
    }
    process.env[key] = value;
  }
}

/**
 * Clear a specific environment variable
 * @param key - Environment variable key to clear
 */
export function clearMockEnv(key: string): void {
  if (!(key in originalEnv)) {
    originalEnv[key] = process.env[key];
  }
  delete process.env[key];
}

/**
 * Restore all environment variables to their original values
 */
export function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Clear the storage
  for (const key of Object.keys(originalEnv)) {
    delete originalEnv[key];
  }
}

/**
 * Clear all environment variables matching a prefix
 * @param prefix - Prefix to match
 */
export function clearEnvByPrefix(prefix: string): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(prefix)) {
      if (!(key in originalEnv)) {
        originalEnv[key] = process.env[key];
      }
      delete process.env[key];
    }
  }
}

// ============================================================================
// Database Mock Setup
// ============================================================================

/** Mock SQL client interface */
export interface MockSqlClient {
  insertContact: Mock<(companyName: string, personName: string, email: string) => Promise<unknown>>;
  getContacts: Mock<(status?: string) => Promise<unknown[]>>;
  getPendingContacts: Mock<() => Promise<unknown[]>>;
  updateContactStatus: Mock<(email: string, status: string) => Promise<void>>;
  contactExists: Mock<(email: string) => Promise<boolean>>;
  insertAuditLog: Mock<(eventType: string, payload: Record<string, unknown>) => Promise<unknown>>;
  initializeSchema: Mock<() => Promise<void>>;
  closeConnection: Mock<() => Promise<void>>;
}

/**
 * Create a mock SQL client for database testing
 * @returns Mock SQL client with jest-style mock functions
 */
export function createMockSqlClient(): MockSqlClient {
  return {
    insertContact: createMockFn(),
    getContacts: createMockFn(),
    getPendingContacts: createMockFn(),
    updateContactStatus: createMockFn(),
    contactExists: createMockFn(),
    insertAuditLog: createMockFn(),
    initializeSchema: createMockFn(),
    closeConnection: createMockFn(),
  };
}

/** Type for mock function */
type MockFn<T extends (...args: unknown[]) => unknown> = Mock<T> & {
  mockResolvedValue: (value: Awaited<ReturnType<T>>) => void;
  mockRejectedValue: (error: Error) => void;
  mockReturnValue: (value: ReturnType<T>) => void;
};

/**
 * Create a jest-style mock function
 * @returns Mock function with bun:test spy
 */
function createMockFn<T extends (...args: unknown[]) => unknown>(): MockFn<T> {
  const impl = () => Promise.resolve(undefined) as ReturnType<T>;
  const spy = spyOn({ fn: impl }, 'fn');

  return Object.assign(spy, {
    mockResolvedValue: (value: Awaited<ReturnType<T>>) => {
      spy.mockImplementation(() => Promise.resolve(value) as ReturnType<T>);
    },
    mockRejectedValue: (error: Error) => {
      spy.mockImplementation(() => Promise.reject(error) as ReturnType<T>);
    },
    mockReturnValue: (value: ReturnType<T>) => {
      spy.mockImplementation(() => value);
    },
  }) as MockFn<T>;
}

// ============================================================================
// Logger Mock Setup
// ============================================================================

/** Mock logger interface */
export interface MockLogger {
  logEvent: Mock<(eventType: string, payload: Record<string, unknown>) => Promise<void>>;
  logUserInput: Mock<(action: string, data: Record<string, unknown>) => Promise<void>>;
  logExcelImportStart: Mock<(filePath: string, totalRows: number) => Promise<void>>;
  logExcelImportRowValid: Mock<(row: number, data: Record<string, unknown>) => Promise<void>>;
  logExcelImportRowInvalid: Mock<(row: number, error: string, data: Record<string, unknown>) => Promise<void>>;
  logExcelImportComplete: Mock<(result: { totalRows: number; successCount: number; failedCount: number }) => Promise<void>>;
  logApiVerifierRequest: Mock<(email: string) => Promise<void>>;
  logApiVerifierResponse: Mock<(email: string, response: Record<string, unknown>) => Promise<void>>;
  logAwsSesRequest: Mock<(email: string, params: Record<string, unknown>) => Promise<void>>;
  logAwsSesResponse: Mock<(email: string, messageId: string) => Promise<void>>;
  logContactUpdated: Mock<(email: string, oldStatus: string, newStatus: string) => Promise<void>>;
  logError: Mock<(context: string, error: Error | string, additionalData?: Record<string, unknown>) => Promise<void>>;
  info: Mock<(message: string, data?: Record<string, unknown>) => Promise<void>>;
  warn: Mock<(message: string, data?: Record<string, unknown>) => Promise<void>>;
}

/**
 * Create a mock logger
 * @returns Mock logger with all methods mocked
 */
export function createMockLogger(): MockLogger {
  return {
    logEvent: createMockFn<(eventType: string, payload: Record<string, unknown>) => Promise<void>>(),
    logUserInput: createMockFn<(action: string, data: Record<string, unknown>) => Promise<void>>(),
    logExcelImportStart: createMockFn<(filePath: string, totalRows: number) => Promise<void>>(),
    logExcelImportRowValid: createMockFn<(row: number, data: Record<string, unknown>) => Promise<void>>(),
    logExcelImportRowInvalid: createMockFn<(row: number, error: string, data: Record<string, unknown>) => Promise<void>>(),
    logExcelImportComplete: createMockFn<(result: { totalRows: number; successCount: number; failedCount: number }) => Promise<void>>(),
    logApiVerifierRequest: createMockFn<(email: string) => Promise<void>>(),
    logApiVerifierResponse: createMockFn<(email: string, response: Record<string, unknown>) => Promise<void>>(),
    logAwsSesRequest: createMockFn<(email: string, params: Record<string, unknown>) => Promise<void>>(),
    logAwsSesResponse: createMockFn<(email: string, messageId: string) => Promise<void>>(),
    logContactUpdated: createMockFn<(email: string, oldStatus: string, newStatus: string) => Promise<void>>(),
    logError: createMockFn<(context: string, error: Error | string, additionalData?: Record<string, unknown>) => Promise<void>>(),
    info: createMockFn<(message: string, data?: Record<string, unknown>) => Promise<void>>(),
    warn: createMockFn<(message: string, data?: Record<string, unknown>) => Promise<void>>(),
  };
}

// ============================================================================
// Console Mock Helpers
// ============================================================================

/** Store original console methods */
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

/**
 * Mock console methods to prevent output during tests
 */
export function mockConsole(): void {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
}

/**
 * Restore original console methods
 */
export function restoreConsole(): void {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
}

// ============================================================================
// Common Test Utilities
// ============================================================================

/**
 * Wait for a specified number of milliseconds
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the delay
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a controlled random number generator for deterministic tests
 * @param values - Array of values to return in sequence
 * @returns Function that returns values from the array sequentially
 */
export function createSeededRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index++;
    return value;
  };
}

/**
 * Generate a unique test ID
 * @returns Unique string ID
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Deep clone an object for test isolation
 * @param obj - Object to clone
 * @returns Deep cloned object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Assert that a promise rejects with a specific error message
 * @param promise - Promise to test
 * @param expectedMessage - Expected error message substring
 */
export async function expectRejectsWith(
  promise: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected promise to reject with "${expectedMessage}" but it resolved`);
  } catch (error) {
    if (error instanceof Error) {
      if (!error.message.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to include "${expectedMessage}" but got "${error.message}"`
        );
      }
    } else {
      throw new Error(`Expected Error instance but got ${typeof error}`);
    }
  }
}

/**
 * Create a temporary file path for testing
 * @param extension - File extension (default: tmp)
 * @returns Temporary file path
 */
export function tempFilePath(extension = 'tmp'): string {
  return `/tmp/test-${generateTestId()}.${extension}`;
}

// ============================================================================
// Date Mock Helpers
// ============================================================================

/** Original Date constructor */
const OriginalDate = Date;

/**
 * Mock Date to return a fixed timestamp
 * @param timestamp - Fixed timestamp to use
 */
export function mockDate(timestamp: number): void {
  global.Date = class extends OriginalDate {
    constructor() {
      super(timestamp);
    }

    static now(): number {
      return timestamp;
    }
  } as unknown as DateConstructor;
}

/**
 * Restore original Date
 */
export function restoreDate(): void {
  global.Date = OriginalDate;
}

// ============================================================================
// Async Test Helpers
// ============================================================================

/**
 * Retry an async operation with exponential backoff
 * @param operation - Operation to retry
 * @param maxRetries - Maximum number of retries
 * @param delayMs - Initial delay in milliseconds
 */
export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        await wait(delayMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Run async operations in parallel with a concurrency limit
 * @param items - Items to process
 * @param operation - Operation to perform on each item
 * @param concurrency - Maximum concurrent operations
 */
export async function parallelLimit<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const [index, item] of items.entries()) {
    const promise = operation(item).then((result) => {
      results[index] = result;
    });
    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex((p) => p === promise), 1);
    }
  }

  await Promise.all(executing);
  return results;
}
