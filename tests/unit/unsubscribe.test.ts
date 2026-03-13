/**
 * Unit tests for manual unsubscribe service
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockCreateContactSuppression = mock(() => Promise.resolve(true));
const mockGetContactByEmail = mock(() => Promise.resolve(null));
const mockGetContactSuppressionByEmail = mock(() => Promise.resolve(null));
const mockRecordAnalyticsEvent = mock(() => Promise.resolve());
const mockEmitAnalyticsEvent = mock(() => {});

mock.module('../../src/db.js', () => ({
  createContactSuppression: mockCreateContactSuppression,
  getContactByEmail: mockGetContactByEmail,
  getContactSuppressionByEmail: mockGetContactSuppressionByEmail,
  recordAnalyticsEvent: mockRecordAnalyticsEvent,
}));

mock.module('../../src/events/bus.js', () => ({
  emitAnalyticsEvent: mockEmitAnalyticsEvent,
}));

const { unsubscribeEmail } = await import('../../src/unsubscribe.js');

describe('unsubscribeEmail()', () => {
  beforeEach(() => {
    mockCreateContactSuppression.mockClear();
    mockGetContactByEmail.mockClear();
    mockGetContactSuppressionByEmail.mockClear();
    mockRecordAnalyticsEvent.mockClear();
    mockEmitAnalyticsEvent.mockClear();

    mockGetContactSuppressionByEmail.mockResolvedValue(null);
    mockGetContactByEmail.mockResolvedValue(null);
    mockCreateContactSuppression.mockResolvedValue(true);
  });

  it('should create a manual unsubscribe and emit analytics once', async () => {
    mockGetContactByEmail.mockResolvedValue({
      id: 'contact-1',
      email: 'client@example.com',
      companyName: 'Example Co',
      personName: 'Client',
      createdAt: new Date(),
    });

    const result = await unsubscribeEmail('  CLIENT@example.com ');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'created',
        email: 'client@example.com',
        contactId: 'contact-1',
        suppressionType: 'unsubscribe',
      })
    );
    expect(mockCreateContactSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        email: 'client@example.com',
        suppressionType: 'unsubscribe',
      })
    );
    expect(mockRecordAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'contact:suppressed',
        email: 'client@example.com',
        suppressionType: 'unsubscribe',
      })
    );
  });

  it('should return already_suppressed without duplicating analytics', async () => {
    mockGetContactSuppressionByEmail.mockResolvedValue({
      id: 'suppression-1',
      contactId: 'contact-1',
      email: 'client@example.com',
      suppressionType: 'complaint',
      suppressionReason: 'Complaint: abuse',
      sesMessageId: null,
      suppressedAt: new Date(),
    });

    const result = await unsubscribeEmail('client@example.com');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'already_suppressed',
        email: 'client@example.com',
        suppressionType: 'complaint',
      })
    );
    expect(mockCreateContactSuppression).not.toHaveBeenCalled();
    expect(mockRecordAnalyticsEvent).not.toHaveBeenCalled();
    expect(mockEmitAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('should treat a concurrent duplicate insert as already_suppressed', async () => {
    mockCreateContactSuppression.mockResolvedValue(false);
    mockGetContactSuppressionByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'suppression-2',
        contactId: null,
        email: 'client@example.com',
        suppressionType: 'unsubscribe',
        suppressionReason: 'Manual unsubscribe',
        sesMessageId: null,
        suppressedAt: new Date(),
      });

    const result = await unsubscribeEmail('client@example.com');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'already_suppressed',
        email: 'client@example.com',
        suppressionType: 'unsubscribe',
      })
    );
    expect(mockRecordAnalyticsEvent).not.toHaveBeenCalled();
    expect(mockEmitAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('should throw when suppression creation fails and no record exists afterward', async () => {
    mockCreateContactSuppression.mockResolvedValue(false);
    mockGetContactSuppressionByEmail.mockResolvedValue(null);

    await expect(unsubscribeEmail('client@example.com')).rejects.toThrow(
      'Failed to record unsubscribe'
    );
  });

  it('should create analytics without a contact when email is not yet imported', async () => {
    const result = await unsubscribeEmail('prospect@example.com');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'created',
        email: 'prospect@example.com',
      })
    );
    expect(mockCreateContactSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: undefined,
        email: 'prospect@example.com',
      })
    );
    expect(mockRecordAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: undefined,
        payload: expect.objectContaining({
          contactId: undefined,
          email: 'prospect@example.com',
        }),
      })
    );
  });

  it('should reject invalid email input', async () => {
    await expect(unsubscribeEmail('not-an-email')).rejects.toThrow('Invalid email format');
  });
});
