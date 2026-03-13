import { loadDatabaseEnvironment } from '../src/db-admin.js';

interface CliOptions {
  environment: 'development' | 'production';
  limit: number;
  visibilityTimeoutSeconds: number;
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    environment: 'production',
    limit: 5,
    visibilityTimeoutSeconds: 10,
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
      case '--limit':
        if (!next) {
          throw new Error('Missing value for --limit');
        }
        options.limit = Number.parseInt(next, 10);
        index += 1;
        break;
      case '--visibility-timeout':
        if (!next) {
          throw new Error('Missing value for --visibility-timeout');
        }
        options.visibilityTimeoutSeconds = Number.parseInt(next, 10);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit <= 0 || options.limit > 10) {
    throw new Error('limit must be an integer between 1 and 10');
  }

  if (
    !Number.isFinite(options.visibilityTimeoutSeconds) ||
    options.visibilityTimeoutSeconds < 0 ||
    options.visibilityTimeoutSeconds > 43200
  ) {
    throw new Error('visibility-timeout must be an integer between 0 and 43200');
  }

  return options;
}

function buildMessagePreview(body: string): Record<string, unknown> {
  try {
    const parsedBody = JSON.parse(body) as Record<string, unknown>;

    const preview: Record<string, unknown> = {
      topLevelKeys: Object.keys(parsedBody),
      type: parsedBody.Type,
      topicArn: parsedBody.TopicArn,
      timestamp: parsedBody.Timestamp,
    };

    if (typeof parsedBody.Message === 'string') {
      try {
        const snsMessage = JSON.parse(parsedBody.Message) as Record<string, unknown>;
        preview.snsMessageKeys = Object.keys(snsMessage);
        preview.eventType = snsMessage.eventType;
        preview.mailKeys =
          typeof snsMessage.mail === 'object' && snsMessage.mail !== null
            ? Object.keys(snsMessage.mail as Record<string, unknown>)
            : undefined;
      } catch {
        preview.rawMessagePreview = parsedBody.Message.slice(0, 500);
      }
    }

    return preview;
  } catch {
    return {
      rawBodyPreview: body.slice(0, 500),
    };
  }
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

  const [{ getSQSConfig }, { ReceiveMessageCommand, SQSClient }, { parseSESEventMessage }] =
    await Promise.all([
      import('../src/config.js'),
      import('@aws-sdk/client-sqs'),
      import('../src/ses-events.js'),
    ]);

  const sqsConfig = getSQSConfig();
  if (!sqsConfig) {
    throw new Error('SQS is not configured for this environment');
  }

  const client = new SQSClient({
    region: sqsConfig.region,
    credentials: sqsConfig.credentials,
  });

  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: sqsConfig.queueUrl,
      MaxNumberOfMessages: options.limit,
      VisibilityTimeout: options.visibilityTimeoutSeconds,
      WaitTimeSeconds: 1,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    })
  );

  const messages = response.Messages ?? [];
  console.log(`Received ${messages.length} message(s) from ${sqsConfig.queueUrl}`);

  for (const [index, message] of messages.entries()) {
    const body = message.Body ?? '';
    const parseResult = parseSESEventMessage(body);
    const preview = buildMessagePreview(body);

    console.log('');
    console.log(`Message ${index + 1}`);
    console.log(`  messageId: ${message.MessageId ?? '<missing>'}`);
    console.log(`  receiveCount: ${message.Attributes?.ApproximateReceiveCount ?? '<missing>'}`);
    console.log(`  parseKind: ${parseResult.kind}`);
    if (parseResult.kind !== 'event') {
      console.log(`  parseReason: ${parseResult.reason}`);
    } else {
      console.log(`  eventType: ${parseResult.event.eventType}`);
      console.log(`  sesMessageId: ${parseResult.event.messageId}`);
      console.log(`  recipients: ${parseResult.event.recipients.join(', ')}`);
    }
    console.log(`  preview: ${JSON.stringify(preview)}`);
  }
}

main().catch((error) => {
  console.error('SQS inspection failed');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
