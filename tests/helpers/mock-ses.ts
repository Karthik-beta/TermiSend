/**
 * SES Mock Helper
 * Provides a mockable SES client for testing
 */

/**
 * SES Error Types for simulation
 */
export enum SESErrorType {
  THROTTLING = 'ThrottlingException',
  MESSAGE_REJECTED = 'MessageRejected',
  DOMAIN_NOT_VERIFIED = 'MailFromDomainNotVerified',
  NETWORK_TIMEOUT = 'NetworkTimeout',
  QUOTA_EXCEEDED = 'QuotaExceeded',
  GENERAL_ERROR = 'GeneralError',
}

/**
 * SES Error for testing
 */
export class MockSESError extends Error {
  constructor(
    public readonly code: SESErrorType,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = code;
  }
}

/**
 * Mock SES send function type
 */
export type MockSESSend = (command: unknown) => Promise<{ MessageId?: string }>;

/**
 * Failure configuration
 */
export interface FailureConfig {
  type: SESErrorType;
  message: string;
  retryable: boolean;
  delayMs?: number;
}

/**
 * Global mock SES state that persists within a test file
 */
const mockSESState: {
  sendImplementation: MockSESSend;
  callCount: number;
  calls: unknown[];
  failureSequence: FailureConfig[];
  currentFailureIndex: number;
} = {
  sendImplementation: () => Promise.resolve({ MessageId: 'test-message-id-12345' }),
  callCount: 0,
  calls: [],
  failureSequence: [],
  currentFailureIndex: 0,
};

/**
 * Get the current mock SES send implementation
 * @returns The mock implementation function
 */
export function getMockSESSend(): MockSESSend {
  return mockSESState.sendImplementation;
}

/**
 * Set the mock implementation for SES send
 * @param implementation - The mock implementation
 */
export function setMockSESSend(implementation: MockSESSend): void {
  mockSESState.sendImplementation = implementation;
}

/**
 * Reset the mock SES state to defaults
 */
export function resetMockSESState(): void {
  mockSESState.sendImplementation = () => Promise.resolve({ MessageId: 'test-message-id-12345' });
  mockSESState.callCount = 0;
  mockSESState.calls = [];
  mockSESState.failureSequence = [];
  mockSESState.currentFailureIndex = 0;
}

/**
 * Set a sequence of failures to simulate
 * @param failures - Array of failure configurations
 */
export function setFailureSequence(failures: FailureConfig[]): void {
  mockSESState.failureSequence = failures;
  mockSESState.currentFailureIndex = 0;

  // Override send implementation to use failure sequence
  mockSESState.sendImplementation = async (command: unknown) => {
    const failure = mockSESState.failureSequence[mockSESState.currentFailureIndex];

    if (failure) {
      mockSESState.currentFailureIndex++;

      // Simulate network delay if specified
      if (failure.delayMs && failure.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, failure.delayMs));
      }

      throw new MockSESError(failure.type, failure.message, failure.retryable);
    }

    return { MessageId: 'test-message-id-12345' };
  };
}

/**
 * Simulate ThrottlingException (rate limited by AWS)
 * @param delayMs - Optional delay to simulate network latency
 */
export function simulateThrottlingException(delayMs = 0): void {
  setFailureSequence([
    {
      type: SESErrorType.THROTTLING,
      message: 'Rate exceeded',
      retryable: true,
      delayMs,
    },
  ]);
}

/**
 * Simulate MessageRejected (content policy violation)
 * @param delayMs - Optional delay to simulate network latency
 */
export function simulateMessageRejected(delayMs = 0): void {
  setFailureSequence([
    {
      type: SESErrorType.MESSAGE_REJECTED,
      message: 'Message content rejected by policy',
      retryable: false,
      delayMs,
    },
  ]);
}

/**
 * Simulate MailFromDomainNotVerified (configuration error)
 * @param delayMs - Optional delay to simulate network latency
 */
export function simulateDomainNotVerified(delayMs = 0): void {
  setFailureSequence([
    {
      type: SESErrorType.DOMAIN_NOT_VERIFIED,
      message: 'Email address not verified',
      retryable: false,
      delayMs,
    },
  ]);
}

/**
 * Simulate Network Timeout
 * @param timeoutMs - Duration of the timeout
 */
export function simulateNetworkTimeout(timeoutMs = 5000): void {
  setFailureSequence([
    {
      type: SESErrorType.NETWORK_TIMEOUT,
      message: 'Connection timed out',
      retryable: true,
      delayMs: timeoutMs,
    },
  ]);
}

/**
 * Simulate Quota Exceeded
 * @param delayMs - Optional delay to simulate network latency
 */
export function simulateQuotaExceeded(delayMs = 0): void {
  setFailureSequence([
    {
      type: SESErrorType.QUOTA_EXCEEDED,
      message: 'Daily sending quota exceeded',
      retryable: false,
      delayMs,
    },
  ]);
}

/**
 * Simulate a sequence of transient failures followed by success
 * @param failureCount - Number of transient failures before success
 */
export function simulateTransientFailures(failureCount: number): void {
  const failures: FailureConfig[] = Array.from({ length: failureCount }, () => ({
    type: SESErrorType.THROTTLING,
    message: 'Rate exceeded',
    retryable: true,
  }));

  setFailureSequence(failures);
}

/**
 * Get a mock SES client that uses the mock state
 * This client can be passed to __test.setSesClient() in ses.ts
 */
export function getMockSESClient(): { send: (command: unknown) => Promise<{ MessageId?: string }> } {
  return {
    send: async (command: unknown): Promise<{ MessageId?: string }> => {
      mockSESState.callCount++;
      mockSESState.calls.push(command);
      return mockSESState.sendImplementation(command);
    }
  };
}

/**
 * Get the current failure sequence index
 * @returns Current index in failure sequence
 */
export function getFailureSequenceIndex(): number {
  return mockSESState.currentFailureIndex;
}

/**
 * Get the number of times send was called
 * @returns Call count
 */
export function getMockSESCallCount(): number {
  return mockSESState.callCount;
}

/**
 * Get the calls made to the mock
 * @returns Array of calls
 */
export function getMockSESCalls(): unknown[] {
  return mockSESState.calls;
}

/**
 * Create a mockable SESClient class
 * This class can be used to replace the real SESClient in tests
 */
export class MockableSESClient {
  async send(command: unknown): Promise<{ MessageId?: string }> {
    mockSESState.callCount++;
    mockSESState.calls.push(command);
    return mockSESState.sendImplementation(command);
  }
}

/**
 * Track if we're in test mode
 */
let testMode = false;

/**
 * Enable test mode for SES
 */
export function enableSESTestMode(): void {
  testMode = true;
  resetMockSESState();
}

/**
 * Check if SES test mode is enabled
 * @returns True if in test mode
 */
export function isSESTestMode(): boolean {
  return testMode;
}
