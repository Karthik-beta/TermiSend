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

// ============================================================================
// SES Analytics Mock Helpers
// ============================================================================

/**
 * Mock response for GetSendQuota API
 */
export interface MockGetSendQuotaResponse {
  Max24HourSend?: number;
  MaxSendRate?: number;
  SentLast24Hours?: number;
}

/**
 * Mock send data point for GetSendStatistics
 */
export interface MockSendDataPoint {
  Timestamp: Date;
  DeliveryAttempts: number;
  Bounces: number;
  Complaints: number;
  Rejects: number;
}

/**
 * Mock response for GetSendStatistics API
 */
export interface MockGetSendStatisticsResponse {
  SendDataPoints: MockSendDataPoint[];
}

/**
 * Mock verification attributes for identities
 */
export interface MockVerificationAttributes {
  [identity: string]: {
    VerificationStatus: 'Pending' | 'Success' | 'Failed' | 'TemporaryFailure' | 'NotStarted';
  };
}

/**
 * Mock response for GetIdentityVerificationAttributes API
 */
export interface MockGetIdentityVerificationAttributesResponse {
  VerificationAttributes: MockVerificationAttributes;
}

/**
 * Default mock GetSendQuota response
 */
export const defaultMockQuotaResponse: MockGetSendQuotaResponse = {
  Max24HourSend: 1000,
  MaxSendRate: 14,
  SentLast24Hours: 100,
};

/**
 * Default mock GetSendStatistics response
 */
export const defaultMockStatisticsResponse: MockGetSendStatisticsResponse = {
  SendDataPoints: [
    {
      Timestamp: new Date(),
      DeliveryAttempts: 100,
      Bounces: 5,
      Complaints: 1,
      Rejects: 2,
    },
  ],
};

/**
 * Default mock identity list
 */
export const defaultMockIdentities: string[] = ['test@example.com', 'example.com'];

/**
 * Default mock verification attributes
 */
export const defaultMockVerificationAttributes: MockVerificationAttributes = {
  'test@example.com': { VerificationStatus: 'Success' },
  'example.com': { VerificationStatus: 'Pending' },
};

/**
 * Create a mock GetSendQuota response
 * @param overrides - Properties to override
 * @returns Mock response
 */
export function createMockGetSendQuotaResponse(
  overrides: Partial<MockGetSendQuotaResponse> = {}
): MockGetSendQuotaResponse {
  return {
    ...defaultMockQuotaResponse,
    ...overrides,
  };
}

/**
 * Create mock send statistics data points
 * @param count - Number of data points to create
 * @returns Array of mock data points
 */
export function createMockSendDataPoints(count: number = 2): MockSendDataPoint[] {
  const points: MockSendDataPoint[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    points.push({
      Timestamp: new Date(now.getTime() - i * 15 * 60 * 1000), // 15 min intervals
      DeliveryAttempts: 100 - i * 10,
      Bounces: 5 - i,
      Complaints: i % 2,
      Rejects: 2,
    });
  }

  return points;
}

/**
 * Create a mock GetSendStatistics response
 * @param dataPoints - Custom data points (uses default if not provided)
 * @returns Mock response
 */
export function createMockGetSendStatisticsResponse(
  dataPoints?: MockSendDataPoint[]
): MockGetSendStatisticsResponse {
  return {
    SendDataPoints: dataPoints ?? createMockSendDataPoints(),
  };
}

/**
 * Create mock identity statuses
 * @param identities - Array of identity strings
 * @returns Mock verification attributes
 */
export function createMockVerificationAttributes(
  identities: string[] = defaultMockIdentities
): MockVerificationAttributes {
  const attributes: MockVerificationAttributes = {};
  const statuses: Array<'Pending' | 'Success' | 'Failed' | 'TemporaryFailure' | 'NotStarted'> = [
    'Success',
    'Pending',
    'Failed',
    'Success',
  ];

  for (let i = 0; i < identities.length; i++) {
    attributes[identities[i]] = {
      VerificationStatus: statuses[i % statuses.length],
    };
  }

  return attributes;
}

/**
 * SES Analytics Mock State
 */
const analyticsMockState: {
  quotaResponse: MockGetSendQuotaResponse;
  statisticsResponse: MockGetSendStatisticsResponse;
  identities: string[];
  verificationAttributes: MockVerificationAttributes;
  callCount: {
    getSendQuota: number;
    getSendStatistics: number;
    listIdentities: number;
    getIdentityVerificationAttributes: number;
  };
} = {
  quotaResponse: defaultMockQuotaResponse,
  statisticsResponse: defaultMockStatisticsResponse,
  identities: defaultMockIdentities,
  verificationAttributes: defaultMockVerificationAttributes,
  callCount: {
    getSendQuota: 0,
    getSendStatistics: 0,
    listIdentities: 0,
    getIdentityVerificationAttributes: 0,
  },
};

/**
 * Reset SES analytics mock state
 */
export function resetAnalyticsMockState(): void {
  analyticsMockState.quotaResponse = defaultMockQuotaResponse;
  analyticsMockState.statisticsResponse = defaultMockStatisticsResponse;
  analyticsMockState.identities = defaultMockIdentities;
  analyticsMockState.verificationAttributes = defaultMockVerificationAttributes;
  analyticsMockState.callCount = {
    getSendQuota: 0,
    getSendStatistics: 0,
    listIdentities: 0,
    getIdentityVerificationAttributes: 0,
  };
}

/**
 * Set mock GetSendQuota response
 * @param response - Response to return
 */
export function setMockQuotaResponse(response: MockGetSendQuotaResponse): void {
  analyticsMockState.quotaResponse = response;
}

/**
 * Set mock GetSendStatistics response
 * @param response - Response to return
 */
export function setMockStatisticsResponse(response: MockGetSendStatisticsResponse): void {
  analyticsMockState.statisticsResponse = response;
}

/**
 * Set mock identities list
 * @param identities - Array of identity strings
 */
export function setMockIdentities(identities: string[]): void {
  analyticsMockState.identities = identities;
}

/**
 * Set mock verification attributes
 * @param attributes - Verification attributes by identity
 */
export function setMockVerificationAttributes(attributes: MockVerificationAttributes): void {
  analyticsMockState.verificationAttributes = attributes;
}

/**
 * Get analytics mock call counts
 * @returns Call counts for each analytics API
 */
export function getAnalyticsCallCounts(): {
  getSendQuota: number;
  getSendStatistics: number;
  listIdentities: number;
  getIdentityVerificationAttributes: number;
} {
  return { ...analyticsMockState.callCount };
}

/**
 * Get a mock SES client that supports analytics APIs
 * Enhanced version that handles both sending and analytics commands
 */
export function getMockSESAnalyticsClient(): {
  send: (command: unknown) => Promise<unknown>;
} {
  return {
    send: async (command: unknown): Promise<unknown> => {
      const commandName = (command as { constructor?: { name?: string } })?.constructor?.name || '';

      switch (commandName) {
        case 'GetSendQuotaCommand': {
          analyticsMockState.callCount.getSendQuota++;
          return analyticsMockState.quotaResponse;
        }
        case 'GetSendStatisticsCommand': {
          analyticsMockState.callCount.getSendStatistics++;
          return analyticsMockState.statisticsResponse;
        }
        case 'ListIdentitiesCommand': {
          analyticsMockState.callCount.listIdentities++;
          return { Identities: analyticsMockState.identities };
        }
        case 'GetIdentityVerificationAttributesCommand': {
          analyticsMockState.callCount.getIdentityVerificationAttributes++;
          const cmd = command as { Identities?: string[] };
          const requestedIdentities = cmd.Identities || analyticsMockState.identities;
          const filteredAttributes: MockVerificationAttributes = {};

          for (const identity of requestedIdentities) {
            if (analyticsMockState.verificationAttributes[identity]) {
              filteredAttributes[identity] = analyticsMockState.verificationAttributes[identity];
            }
          }

          return { VerificationAttributes: filteredAttributes };
        }
        default: {
          // Fall back to standard mock implementation
          mockSESState.callCount++;
          mockSESState.calls.push(command);
          return mockSESState.sendImplementation(command);
        }
      }
    },
  };
}
