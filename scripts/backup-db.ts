import {
  buildPgDumpArgs,
  createBackupFilePath,
  createPgProcessEnv,
  ensureBackupDirectory,
  ensureBackupSafety,
  findRequiredBinary,
  getDatabaseConnectionConfig,
  loadDatabaseEnvironment,
  parseBackupCliArgs,
} from '../src/db-admin.js';

function printHelp(): void {
  console.log('Usage: bun run scripts/backup-db.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --env <development|production>   Environment file to load (default: development)');
  console.log('  --output-dir <path>              Folder to store the backup file');
  console.log('  --backup-name <name>             Optional backup filename (.dump added automatically)');
  console.log('  --confirm-production-backup      Required when --env production is used');
  console.log('  --help, -h                       Show this help message');
}

async function main(): Promise<void> {
  const options = parseBackupCliArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  ensureBackupSafety(options);

  const environment = loadDatabaseEnvironment(options.environment);
  const dbConfig = getDatabaseConnectionConfig(environment);
  const outputDirectory = ensureBackupDirectory(options.outputDir, environment);
  const backupFilePath = createBackupFilePath(outputDirectory, dbConfig.database, options.backupName);
  const pgDumpBinary = findRequiredBinary('pg_dump');

  console.log(`Starting ${options.environment} database backup...`);
  console.log(`Database: ${dbConfig.database}`);
  console.log(`Target: ${backupFilePath}`);

  const processHandle = Bun.spawn({
    cmd: [pgDumpBinary, ...buildPgDumpArgs(dbConfig, backupFilePath)],
    env: createPgProcessEnv(dbConfig),
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await processHandle.exited;

  if (exitCode !== 0) {
    throw new Error(`pg_dump failed with exit code ${exitCode}.`);
  }

  console.log('');
  console.log(`Backup completed successfully: ${backupFilePath}`);
}

main().catch((error) => {
  console.error('Backup failed');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
