import { accessSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

export type DatabaseEnvironment = 'development' | 'production';

export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface BackupCliOptions {
  environment: DatabaseEnvironment;
  outputDir?: string;
  backupName?: string;
  confirmProductionBackup: boolean;
  help: boolean;
}

export interface RestoreCliOptions {
  environment: DatabaseEnvironment;
  inputPath?: string;
  confirmRestore: boolean;
  confirmProductionRestore: boolean;
  help: boolean;
}

const DEFAULT_BACKUP_DIRECTORY = path.resolve(process.cwd(), 'backups', 'postgres');
const IST_TIMEZONE = 'Asia/Kolkata';

function getEnvFilePath(environment: DatabaseEnvironment): string {
  return path.resolve(
    process.cwd(),
    environment === 'production' ? '.env.production' : '.env.development'
  );
}

function getFlagValue(args: string[], index: number): string {
  const value = args[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${args[index]}`);
  }

  return value;
}

export function parseBackupCliArgs(args: string[]): BackupCliOptions {
  const options: BackupCliOptions = {
    environment: 'development',
    confirmProductionBackup: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--env':
        options.environment = parseEnvironment(getFlagValue(args, index));
        index += 1;
        break;
      case '--output-dir':
        options.outputDir = getFlagValue(args, index);
        index += 1;
        break;
      case '--backup-name':
        options.backupName = getFlagValue(args, index);
        index += 1;
        break;
      case '--confirm-production-backup':
        options.confirmProductionBackup = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function parseRestoreCliArgs(args: string[]): RestoreCliOptions {
  const options: RestoreCliOptions = {
    environment: 'development',
    confirmRestore: false,
    confirmProductionRestore: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--env':
        options.environment = parseEnvironment(getFlagValue(args, index));
        index += 1;
        break;
      case '--input':
        options.inputPath = getFlagValue(args, index);
        index += 1;
        break;
      case '--confirm-restore':
        options.confirmRestore = true;
        break;
      case '--confirm-production-restore':
        options.confirmProductionRestore = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function parseEnvironment(value: string): DatabaseEnvironment {
  if (value !== 'development' && value !== 'production') {
    throw new Error(`Invalid environment "${value}". Use "development" or "production".`);
  }

  return value;
}

export function loadDatabaseEnvironment(
  environment: DatabaseEnvironment
): Record<string, string | undefined> {
  const envFilePath = getEnvFilePath(environment);
  let fileValues: Record<string, string> = {};

  if (existsSync(envFilePath)) {
    fileValues = parse(readFileSync(envFilePath, 'utf-8'));
  }

  const mergedEnvironment: Record<string, string | undefined> = {
    ...process.env,
    ...fileValues,
  };

  mergedEnvironment.NODE_ENV = environment;

  return mergedEnvironment;
}

export function getDatabaseConnectionConfig(
  environment: Record<string, string | undefined>
): DatabaseConnectionConfig {
  const host = environment.DB_HOST?.trim();
  const user = environment.DB_USER?.trim();
  const password = environment.DB_PASS;
  const database = environment.DB_NAME?.trim() || 'termisend';
  const portValue = environment.DB_PORT?.trim() || '5432';
  const port = Number.parseInt(portValue, 10);

  if (!host) {
    throw new Error('DB_HOST is required.');
  }
  if (!user) {
    throw new Error('DB_USER is required.');
  }
  if (!password) {
    throw new Error('DB_PASS is required.');
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid DB_PORT value "${portValue}".`);
  }

  return {
    host,
    port,
    user,
    password,
    database,
  };
}

export function ensureBackupDirectory(
  outputDir: string | undefined,
  environment: Record<string, string | undefined>
): string {
  const resolvedDirectory = path.resolve(
    outputDir?.trim() || environment.DB_BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIRECTORY
  );

  mkdirSync(resolvedDirectory, { recursive: true });
  accessSync(resolvedDirectory);

  return resolvedDirectory;
}

export function createBackupFilePath(
  outputDirectory: string,
  databaseName: string,
  backupName?: string,
  date: Date = new Date()
): string {
  const timestamp = formatBackupTimestamp(date);
  const fileName = backupName?.trim() || `${databaseName}-${timestamp}.dump`;
  const normalizedFileName = fileName.endsWith('.dump') ? fileName : `${fileName}.dump`;

  return path.join(outputDirectory, normalizedFileName);
}

export function formatBackupTimestamp(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}-${values.minute}-${values.second}-IST`;
}

export function resolveRestoreInputPath(inputPath: string | undefined): string {
  if (!inputPath?.trim()) {
    throw new Error('Restore input is required. Pass --input <path-to-backup.dump>.');
  }

  const resolvedPath = path.resolve(inputPath);
  accessSync(resolvedPath);

  return resolvedPath;
}

export function ensureBackupSafety(options: BackupCliOptions): void {
  if (options.environment === 'production' && !options.confirmProductionBackup) {
    throw new Error(
      'Production backup requires --confirm-production-backup to avoid accidental runs.'
    );
  }
}

export function ensureRestoreSafety(options: RestoreCliOptions): void {
  if (!options.confirmRestore) {
    throw new Error('Restore requires --confirm-restore because it is destructive.');
  }

  if (options.environment === 'production' && !options.confirmProductionRestore) {
    throw new Error(
      'Production restore requires --confirm-production-restore to avoid accidental data loss.'
    );
  }
}

export function findRequiredBinary(command: 'pg_dump' | 'pg_restore'): string {
  const binaryPath = Bun.which(command);

  if (!binaryPath) {
    throw new Error(
      `${command} was not found on PATH. Install PostgreSQL client tools and try again.`
    );
  }

  return binaryPath;
}

export function buildPgDumpArgs(
  config: DatabaseConnectionConfig,
  backupFilePath: string
): string[] {
  return [
    '--format=custom',
    '--verbose',
    '--no-owner',
    '--no-privileges',
    '--host',
    config.host,
    '--port',
    String(config.port),
    '--username',
    config.user,
    '--file',
    backupFilePath,
    config.database,
  ];
}

export function buildPgRestoreArgs(config: DatabaseConnectionConfig, inputPath: string): string[] {
  return [
    '--verbose',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--single-transaction',
    '--exit-on-error',
    '--host',
    config.host,
    '--port',
    String(config.port),
    '--username',
    config.user,
    '--dbname',
    config.database,
    inputPath,
  ];
}

export function createPgProcessEnv(
  config: DatabaseConnectionConfig
): Record<string, string | undefined> {
  const processEnvironment: Record<string, string | undefined> = {
    ...process.env,
  };

  processEnvironment.PGPASSWORD = config.password;

  return processEnvironment;
}
