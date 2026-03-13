import { loadDatabaseEnvironment } from '../src/db-admin.js';

interface CliOptions {
  environment: 'development' | 'production';
  maxPolls: number;
  maxEmptyPolls: number;
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    environment: 'production',
    maxPolls: 50,
    maxEmptyPolls: 2,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case '--env':
        if (next !== 'development' && next !== 'production') {
          throw new Error('Use --env development or --env production');
        }
        options.environment = next;
        index += 1;
        break;
      case '--max-polls':
        if (!next) {
          throw new Error('Missing value for --max-polls');
        }
        options.maxPolls = Number.parseInt(next, 10);
        index += 1;
        break;
      case '--max-empty-polls':
        if (!next) {
          throw new Error('Missing value for --max-empty-polls');
        }
        options.maxEmptyPolls = Number.parseInt(next, 10);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxPolls) || options.maxPolls <= 0) {
    throw new Error('max-polls must be a positive integer');
  }
  if (!Number.isFinite(options.maxEmptyPolls) || options.maxEmptyPolls <= 0) {
    throw new Error('max-empty-polls must be a positive integer');
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  process.env.NODE_ENV = options.environment;
  const loadedEnvironment = loadDatabaseEnvironment(options.environment);
  for (const [key, value] of Object.entries(loadedEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  const [{ getSQSConfig }, { closeConnection }, { deleteMessage, pollMessages, processMessage }] =
    await Promise.all([
      import('../src/config.js'),
      import('../src/db.js'),
      import('../src/sqs-consumer.js'),
    ]);

  const sqsConfig = getSQSConfig();
  if (!sqsConfig) {
    throw new Error('SQS is not configured for this environment');
  }

  let totalPolled = 0;
  let totalProcessed = 0;
  let totalDeleted = 0;
  let totalFailed = 0;
  let emptyPolls = 0;

  console.log(`Pulling SQS SES events for ${options.environment}...`);
  console.log(`Queue: ${sqsConfig.queueUrl}`);
  console.log(`Database: ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);

  try {
    for (let pollNumber = 1; pollNumber <= options.maxPolls; pollNumber += 1) {
      const messages = await pollMessages();
      totalPolled += messages.length;

      if (messages.length === 0) {
        emptyPolls += 1;
        console.log(`Poll ${pollNumber}: empty (${emptyPolls}/${options.maxEmptyPolls})`);
        if (emptyPolls >= options.maxEmptyPolls) {
          break;
        }
        continue;
      }

      emptyPolls = 0;
      console.log(`Poll ${pollNumber}: received ${messages.length} message(s)`);

      for (const message of messages) {
        const result = await processMessage(message);

        if (result.success) {
          totalProcessed += 1;
          await deleteMessage(message.receiptHandle);
          totalDeleted += 1;
          continue;
        }

        if (result.nonRetryable) {
          totalFailed += 1;
          console.log(
            `  dropping: ${message.messageId} :: ${result.error || 'non-retryable processing failure'}`
          );
          await deleteMessage(message.receiptHandle);
          totalDeleted += 1;
          continue;
        }

        totalFailed += 1;
        console.log(
          `  failed: ${message.messageId} :: ${result.error || 'unknown processing failure'}`
        );
      }
    }
  } finally {
    await closeConnection();
  }

  console.log('');
  console.log('Summary');
  console.log(`  polled: ${totalPolled}`);
  console.log(`  processed: ${totalProcessed}`);
  console.log(`  deleted: ${totalDeleted}`);
  console.log(`  failed: ${totalFailed}`);
}

main().catch((error) => {
  console.error('SQS pull failed');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
