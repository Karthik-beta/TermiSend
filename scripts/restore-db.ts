import {
  buildPgRestoreArgs,
  createPgProcessEnv,
  ensureRestoreSafety,
  findRequiredBinary,
  getDatabaseConnectionConfig,
  loadDatabaseEnvironment,
  parseRestoreCliArgs,
  resolveRestoreInputPath,
} from '../src/db-admin.js';

function printHelp(): void {
  console.log('Usage: bun run scripts/restore-db.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --env <development|production>    Environment file to load (default: development)');
  console.log('  --input <path>                    Backup file created by backup-db.ts');
  console.log('  --confirm-restore                 Required for every restore run');
  console.log('  --confirm-production-restore      Required when --env production is used');
  console.log('  --help, -h                        Show this help message');
}

async function main(): Promise<void> {
  const options = parseRestoreCliArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  ensureRestoreSafety(options);

  const environment = loadDatabaseEnvironment(options.environment);
  const dbConfig = getDatabaseConnectionConfig(environment);
  const inputPath = resolveRestoreInputPath(options.inputPath);
  const pgRestoreBinary = findRequiredBinary('pg_restore');

  console.log(`Starting ${options.environment} database restore...`);
  console.log(`Database: ${dbConfig.database}`);
  console.log(`Source: ${inputPath}`);
  console.log('Existing database objects will be dropped before restore.');

  const processHandle = Bun.spawn({
    cmd: [pgRestoreBinary, ...buildPgRestoreArgs(dbConfig, inputPath)],
    env: createPgProcessEnv(dbConfig),
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await processHandle.exited;

  if (exitCode !== 0) {
    throw new Error(`pg_restore failed with exit code ${exitCode}.`);
  }

  console.log('');
  console.log(`Restore completed successfully from ${inputPath}`);
}

main().catch((error) => {
  console.error('Restore failed');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
