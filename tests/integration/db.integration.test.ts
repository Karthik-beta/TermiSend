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
      expect(contact.status).toBe('pending');
    });

    it('should update contact status', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      const contact = await db.insertContact('Test Co', 'Jane', `jane_${Date.now()}@test.com`);

      await db.updateContactStatus(contact.email, 'sent');

      const contacts = await db.getContacts('sent');
      const updated = contacts.find((c) => c.email === contact.email);
      expect(updated?.status).toBe('sent');
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

    it('should get pending contacts', async () => {
      if (!dbAvailable || !db) {
        console.log('Skipping test - database not available');
        return;
      }
      const email = `pending_${Date.now()}@test.com`;
      await db.insertContact('Test Co', 'Pending', email);

      const pending = await db.getPendingContacts();

      expect(pending.length).toBeGreaterThan(0);
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
});
