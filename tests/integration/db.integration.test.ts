/**
 * Integration Tests for Database Module
 * Requires test database connection
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { restoreEnv, setMockEnv } from '../helpers/test-utils.js';

// Check if database is available
let dbAvailable = false;

// Database functions - will be loaded dynamically
let db: typeof import('../../src/db.js') | null = null;
let unsubscribeService: typeof import('../../src/unsubscribe.js') | null = null;

describe('Database Integration Tests', () => {
  beforeAll(async () => {
    // Set up test database connection
    restoreEnv();
    setMockEnv({
      DB_HOST: process.env.TEST_DB_HOST || 'localhost',
      DB_PORT: process.env.TEST_DB_PORT || '5432',
      DB_USER: process.env.TEST_DB_USER || 'test',
      DB_PASS: process.env.TEST_DB_PASS || 'test',
      DB_NAME: process.env.TEST_DB_NAME || 'termisend_test',
    });

    // Check if database is available
    try {
      const testSql = postgres({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: Number.parseInt(process.env.TEST_DB_PORT || '5432', 10),
        user: process.env.TEST_DB_USER || 'test',
        password: process.env.TEST_DB_PASS || 'test',
        database: process.env.TEST_DB_NAME || 'termisend_test',
        max: 1,
        connect_timeout: 2,
      });
      await testSql`SELECT 1`;
      await testSql.end();
      dbAvailable = true;

      // Load db module only if database is available
      db = await import('../../src/db.js');
      unsubscribeService = await import('../../src/unsubscribe.js');
      await db.initializeSchema();
    } catch {
      dbAvailable = false;
      console.log('Database not available, skipping integration tests');
    }
  });

  describe('Schema Initialization', () => {
    it('should create contacts table', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      await expect(db.initializeSchema()).resolves.toBeUndefined();
    });

    it('should create audit_logs table', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      await expect(db.initializeSchema()).resolves.toBeUndefined();
    });
  });

  describe('Contact CRUD Operations', () => {
    it('should insert and retrieve contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      const contact = await db.insertContact('Test Co', 'John', `john_${Date.now()}@test.com`);

      expect(contact.companyName).toBe('Test Co');
      expect(contact.personName).toBe('John');
    });

    it('should check contact existence', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      const email = `exist_${Date.now()}@test.com`;
      await db.insertContact('Test Co', 'Test', email);

      const exists = await db.contactExists(email);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      const exists = await db.contactExists(`nonexistent_${Date.now()}@test.com`);

      expect(exists).toBe(false);
    });

  });

  describe('Audit Logging', () => {
    it('should insert audit log entry', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      const log = await db.insertAuditLog('USER_INPUT', { key: 'value' });

      expect(log.eventType).toBe('USER_INPUT');
      expect(log.payload).toHaveProperty('key', 'value');
    });
  });

  describe('Connection Management', () => {
    it('should close connection without error', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      await expect(db.closeConnection()).resolves.toBeUndefined();
    });
  });

  // ============================================================================
  // SES Event Tracking Tests
  // ============================================================================

  describe('SES Event Tracking Schema', () => {
    it('should create ses_event_tracking table', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      // Schema is created during initializeSchema()
      await expect(db.initializeSchema()).resolves.toBeUndefined();

      // Verify table exists by querying
      const testSql = postgres({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: Number.parseInt(process.env.TEST_DB_PORT || '5432', 10),
        user: process.env.TEST_DB_USER || 'test',
        password: process.env.TEST_DB_PASS || 'test',
        database: process.env.TEST_DB_NAME || 'termisend_test',
        max: 1,
      });

      const result = await testSql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'ses_event_tracking'
        );
      `;
      await testSql.end();
      
      expect(result[0].exists).toBe(true);
    });

    it('should create contact_suppressions table', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      await expect(db.initializeSchema()).resolves.toBeUndefined();

      const testSql = postgres({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: Number.parseInt(process.env.TEST_DB_PORT || '5432', 10),
        user: process.env.TEST_DB_USER || 'test',
        password: process.env.TEST_DB_PASS || 'test',
        database: process.env.TEST_DB_NAME || 'termisend_test',
        max: 1,
      });

      const result = await testSql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'contact_suppressions'
        );
      `;
      await testSql.end();
      
      expect(result[0].exists).toBe(true);
    });

    it('should add the email column and unique email/type index to contact_suppressions', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      await expect(db.initializeSchema()).resolves.toBeUndefined();

      const testSql = postgres({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: Number.parseInt(process.env.TEST_DB_PORT || '5432', 10),
        user: process.env.TEST_DB_USER || 'test',
        password: process.env.TEST_DB_PASS || 'test',
        database: process.env.TEST_DB_NAME || 'termisend_test',
        max: 1,
      });

      const [columnResult] = await testSql`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'contact_suppressions'
            AND column_name = 'email'
        ) as exists
      `;

      const [indexResult] = await testSql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'contact_suppressions'
            AND indexname = 'idx_contact_suppressions_email_type_unique'
        ) as exists
      `;

      await testSql.end();

      expect(columnResult.exists).toBe(true);
      expect(indexResult.exists).toBe(true);
    });
  });

  describe('createSESEventTracking()', () => {
    it('should create SES event tracking record', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const eventData = {
        eventType: 'Bounce',
        snsMessageId: `sns-msg-${Date.now()}`,
        sesMessageId: `ses-msg-${Date.now()}`,
        recipientEmail: 'test@example.com',
        sourceEmail: 'sender@example.com',
        eventData: { bounceType: 'Permanent' },
        occurredAt: new Date(),
      };

      await expect(db.createSESEventTracking(eventData)).resolves.toBeUndefined();
    });

    it('should create record with contact and send log IDs', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      // First create a contact
      const contact = await db.insertContact('Test Co', 'Test', `event_${Date.now()}@test.com`);
      
      // Create a send log
      const sendLog = await db.createSendLog(
        contact.id,
        'production',
        'Test Subject',
        'Test body preview...'
      );

      const eventData = {
        eventType: 'Delivery',
        snsMessageId: `sns-msg-${Date.now()}`,
        sesMessageId: `ses-msg-${Date.now()}`,
        contactId: contact.id,
        sendLogId: sendLog.id,
        recipientEmail: contact.email,
        sourceEmail: 'sender@example.com',
        eventData: { timestamp: new Date().toISOString() },
        occurredAt: new Date(),
      };

      await expect(db.createSESEventTracking(eventData)).resolves.toBeUndefined();
    });
  });

  describe('createContactSuppression()', () => {
    it('should create contact suppression record', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      // First create a contact
      const contact = await db.insertContact('Test Co', 'Test', `suppress_${Date.now()}@test.com`);

      const suppressionData = {
        contactId: contact.id,
        email: contact.email,
        suppressionType: 'bounce' as const,
        suppressionReason: 'Hard bounce: General',
        sesMessageId: 'ses-msg-123',
        originalEventData: { bounceType: 'Permanent' },
      };

      await expect(db.createContactSuppression(suppressionData)).resolves.toBe(true);
    });

    it('should handle duplicate suppression gracefully', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `dup_${Date.now()}@test.com`);

      const suppressionData = {
        contactId: contact.id,
        email: contact.email,
        suppressionType: 'bounce' as const,
        suppressionReason: 'Hard bounce: General',
      };

      // Create first suppression
      await db.createContactSuppression(suppressionData);
      
      // Second creation should not throw (ON CONFLICT DO NOTHING)
      await expect(db.createContactSuppression(suppressionData)).resolves.toBe(false);
    });

    it('should create a suppression record for an email without a contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const email = `no_contact_${Date.now()}@test.com`;
      await expect(
        db.createContactSuppression({
          email,
          suppressionType: 'unsubscribe',
          suppressionReason: 'Manual unsubscribe',
        })
      ).resolves.toBe(true);

      const suppression = await db.getContactSuppressionByEmail(email);
      expect(suppression?.contactId).toBeNull();
      expect(suppression?.email).toBe(email);
    });
  });

  describe('getContactSuppression()', () => {
    it('should return suppression record for suppressed contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `get_supp_${Date.now()}@test.com`);
      
      await db.createContactSuppression({
        contactId: contact.id,
        email: contact.email,
        suppressionType: 'complaint',
        suppressionReason: 'Spam complaint',
      });

      const suppression = await db.getContactSuppression(contact.id);

      expect(suppression).not.toBeNull();
      expect(suppression?.suppressionType).toBe('complaint');
      expect(suppression?.suppressionReason).toBe('Spam complaint');
      expect(suppression?.email).toBe(contact.email);
    });

    it('should return null for non-suppressed contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `no_supp_${Date.now()}@test.com`);

      const suppression = await db.getContactSuppression(contact.id);

      expect(suppression).toBeNull();
    });
  });

  describe('isContactSuppressed()', () => {
    it('should return true for suppressed contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `is_supp_${Date.now()}@test.com`);
      
      await db.createContactSuppression({
        contactId: contact.id,
        email: contact.email,
        suppressionType: 'bounce',
        suppressionReason: 'Hard bounce',
      });

      const isSuppressed = await db.isContactSuppressed(contact.id);
      expect(isSuppressed).toBe(true);
    });

    it('should return false for non-suppressed contact', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `is_not_${Date.now()}@test.com`);

      const isSuppressed = await db.isContactSuppressed(contact.id);
      expect(isSuppressed).toBe(false);
    });

    it('should return true for imported contacts that match an email-only suppression', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const email = `email_only_${Date.now()}@test.com`;
      await db.createContactSuppression({
        email,
        suppressionType: 'unsubscribe',
        suppressionReason: 'Manual unsubscribe',
      });

      const contact = await db.insertContact('Test Co', 'Later Import', email);
      const isSuppressed = await db.isContactSuppressed(contact.id);
      expect(isSuppressed).toBe(true);
    });
  });

  describe('getContactSuppressionByEmail()', () => {
    it('should find suppressions by normalized email', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const email = `lookup_${Date.now()}@test.com`;
      await db.createContactSuppression({
        email,
        suppressionType: 'unsubscribe',
        suppressionReason: 'Manual unsubscribe',
      });

      const suppression = await db.getContactSuppressionByEmail(email.toUpperCase());

      expect(suppression).not.toBeNull();
      expect(suppression?.email).toBe(email);
      expect(suppression?.suppressionType).toBe('unsubscribe');
    });
  });

  describe('getContactsWithSuppression()', () => {
    it('should return suppression metadata for blocked contacts', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const email = `read_model_${Date.now()}@test.com`;
      await db.createContactSuppression({
        email,
        suppressionType: 'bounce',
        suppressionReason: 'Bounce: Transient / MailboxFull',
      });

      const contact = await db.insertContact('Read Model Co', 'Blocked Contact', email);
      const contacts = await db.getContactsWithSuppression();
      const matched = contacts.find((candidate) => candidate.id === contact.id);

      expect(matched).not.toBeUndefined();
      expect(matched?.suppressionType).toBe('bounce');
      expect(matched?.suppressionReason).toBe('Bounce: Transient / MailboxFull');
      expect(matched?.suppressedAt).toBeInstanceOf(Date);
    });
  });

  describe('getSendLogByMessageId()', () => {
    it('should find send log by SES message ID', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `log_${Date.now()}@test.com`);
      const messageId = `test-message-id-${Date.now()}`;
      
      const sendLog = await db.createSendLog(
        contact.id,
        'production',
        'Test Subject',
        'Test body preview...'
      );

      // Update send log with message ID
      await db.updateSendLog(sendLog.id, {
        status: 'sent',
        messageId: messageId,
        sentAt: new Date(),
      });

      const found = await db.getSendLogByMessageId(messageId);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(sendLog.id);
      expect(found?.contactId).toBe(contact.id);
      expect(found?.email).toBe(contact.email);
    });

    it('should return null for non-existent message ID', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const found = await db.getSendLogByMessageId('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('unsubscribeEmail()', () => {
    it('should create an idempotent manual unsubscribe and exclude future imports from eligibility', async () => {
      if (!dbAvailable || !db || !unsubscribeService) {
        console.log('Skipping test - database not available');
        return;
      }

      const email = `manual_${Date.now()}@test.com`;
      const first = await unsubscribeService.unsubscribeEmail(email);
      const second = await unsubscribeService.unsubscribeEmail(email.toUpperCase());

      expect(first.status).toBe('created');
      expect(second.status).toBe('already_suppressed');

      const contact = await db.insertContact('Suppressed Co', 'Blocked Person', email);
      const eligibleContacts = await db.getEligibleContacts();
      const eligibleCount = await db.getEligibleContactCount();

      expect(eligibleContacts.some((candidate) => candidate.id === contact.id)).toBe(false);
      expect(eligibleCount).toBeGreaterThanOrEqual(0);
      expect(await db.isContactSuppressed(contact.id)).toBe(true);
    });
  });

  describe('updateSendLogEngagement()', () => {
    it('should update send log with open engagement', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `open_${Date.now()}@test.com`);
      const sendLog = await db.createSendLog(
        contact.id,
        'production',
        'Test Subject',
        'Test body preview...'
      );

      await expect(
        db.updateSendLogEngagement(sendLog.id, 'open', new Date())
      ).resolves.toBeUndefined();
    });

    it('should update send log with click engagement', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }

      const contact = await db.insertContact('Test Co', 'Test', `click_${Date.now()}@test.com`);
      const sendLog = await db.createSendLog(
        contact.id,
        'production',
        'Test Subject',
        'Test body preview...'
      );

      await expect(
        db.updateSendLogEngagement(sendLog.id, 'click', new Date(), { link: 'https://example.com' })
      ).resolves.toBeUndefined();
    });
  });
});
