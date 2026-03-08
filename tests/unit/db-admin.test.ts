import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import {
  buildPgDumpArgs,
  buildPgRestoreArgs,
  createBackupFilePath,
  ensureBackupSafety,
  ensureRestoreSafety,
  formatBackupTimestamp,
  getDatabaseConnectionConfig,
  loadDatabaseEnvironment,
  parseBackupCliArgs,
  parseRestoreCliArgs,
} from '../../src/db-admin.js';

describe('DB Admin Helpers', () => {
  describe('parseBackupCliArgs()', () => {
    it('parses backup options and defaults to development', () => {
      const options = parseBackupCliArgs(['--output-dir', './snapshots', '--backup-name', 'prod-copy']);

      expect(options.environment).toBe('development');
      expect(options.outputDir).toBe('./snapshots');
      expect(options.backupName).toBe('prod-copy');
      expect(options.confirmProductionBackup).toBe(false);
    });

    it('parses production backup confirmation', () => {
      const options = parseBackupCliArgs([
        '--env',
        'production',
        '--confirm-production-backup',
      ]);

      expect(options.environment).toBe('production');
      expect(options.confirmProductionBackup).toBe(true);
    });
  });

  describe('parseRestoreCliArgs()', () => {
    it('parses restore confirmations', () => {
      const options = parseRestoreCliArgs([
        '--env',
        'production',
        '--input',
        './backups/postgres/prod.dump',
        '--confirm-restore',
        '--confirm-production-restore',
      ]);

      expect(options.environment).toBe('production');
      expect(options.inputPath).toBe('./backups/postgres/prod.dump');
      expect(options.confirmRestore).toBe(true);
      expect(options.confirmProductionRestore).toBe(true);
    });
  });

  describe('safety guards', () => {
    it('blocks production backup without explicit confirmation', () => {
      expect(() =>
        ensureBackupSafety({
          environment: 'production',
          confirmProductionBackup: false,
          help: false,
        })
      ).toThrow('Production backup requires --confirm-production-backup');
    });

    it('blocks restore without confirm flags', () => {
      expect(() =>
        ensureRestoreSafety({
          environment: 'development',
          confirmRestore: false,
          confirmProductionRestore: false,
          help: false,
        })
      ).toThrow('Restore requires --confirm-restore');
    });
  });

  describe('database config helpers', () => {
    it('prefers the selected env file over ambient DB variables', () => {
      const originalDbName = process.env.DB_NAME;
      const originalNodeEnv = process.env.NODE_ENV;

      process.env.DB_NAME = 'termisend-test';
      process.env.NODE_ENV = 'development';

      const environment = loadDatabaseEnvironment('production');

      expect(environment.DB_NAME).not.toBe('termisend-test');
      expect(environment.NODE_ENV).toBe('production');

      if (originalDbName === undefined) {
        delete process.env.DB_NAME;
      } else {
        process.env.DB_NAME = originalDbName;
      }

      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('builds a valid database config from environment values', () => {
      const config = getDatabaseConnectionConfig({
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'postgres',
        DB_PASS: 'secret',
        DB_NAME: 'termisend_prod',
      });

      expect(config).toEqual({
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'secret',
        database: 'termisend_prod',
      });
    });

    it('creates dump and restore commands with postgres flags', () => {
      const config = {
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'secret',
        database: 'termisend_prod',
      };

      const backupPath = path.resolve('/tmp', 'termisend.dump');
      const dumpArgs = buildPgDumpArgs(config, backupPath);
      const restoreArgs = buildPgRestoreArgs(config, backupPath);

      expect(dumpArgs).toContain('--format=custom');
      expect(dumpArgs).toContain(backupPath);
      expect(restoreArgs).toContain('--clean');
      expect(restoreArgs).toContain('--single-transaction');
      expect(restoreArgs).toContain(backupPath);
    });

    it('adds a .dump extension when generating backup paths', () => {
      const backupPath = createBackupFilePath('/tmp/backups', 'termisend_prod', 'nightly-prod');

      expect(backupPath).toBe(path.join('/tmp/backups', 'nightly-prod.dump'));
    });

    it('formats backup timestamps in Indian Standard Time', () => {
      const timestamp = formatBackupTimestamp(new Date('2026-03-08T14:48:37.940Z'));

      expect(timestamp).toBe('2026-03-08T20-18-37-IST');
    });

    it('uses Indian Standard Time in generated backup filenames', () => {
      const backupPath = createBackupFilePath(
        '/tmp/backups',
        'termisend_prod',
        undefined,
        new Date('2026-03-08T14:48:37.940Z')
      );

      expect(backupPath).toBe(
        path.join('/tmp/backups', 'termisend_prod-2026-03-08T20-18-37-IST.dump')
      );
    });
  });
});
