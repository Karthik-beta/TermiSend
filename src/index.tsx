/**
 * TermiSend - Main Entry Point
 * A local email outreach CLI with Terminal UI
 */

/** @jsxImportSource react */
import { render } from 'ink';
import { isSQSConsumerEnabled } from './config.js';
import { closeConnection, initializeSchema } from './db.js';
import { logger } from './logger.js';
import { shutdown } from './shutdown.js';
import { startConsumer, stopConsumer } from './sqs-consumer.js';
import App from './ui/index.js';

// ============================================================================
// Application Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    await initializeSchema();

    // Start SQS consumer if enabled
    if (isSQSConsumerEnabled()) {
      try {
        // Start consumer in the background - don't await the infinite loop
        startConsumer().catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn('SQS consumer encountered an error', { error: errorMessage });
        });
        await logger.info('SQS consumer started for SES event processing');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await logger.warn('SQS consumer failed to start', { error: errorMessage });
        // Continue without SQS consumer - it's optional
      }
    }

    // Render the Ink UI
    const { waitUntilExit } = render(<App />);

    // Wait for the UI to exit
    await waitUntilExit();

    // Clean up database connection
    await closeConnection();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to start TermiSend');
    console.error(`   Error: ${errorMessage}`);
    console.error('   Check:');
    console.error('     1. DATABASE_URL in .env file');
    console.error('     2. PostgreSQL is running');
    console.error('     3. AWS credentials are configured');
    process.exit(1);
  }
}

// ============================================================================
// Run Application
// ============================================================================

// Handle graceful shutdown
let isShuttingDown = false;

async function handleShutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  // Set global shutdown flag to stop all loops
  shutdown();

  // Stop SQS consumer gracefully
  try {
    await stopConsumer();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error stopping SQS consumer: ${errorMessage}`);
  }

  // Force exit after brief grace period (don't wait indefinitely)
  setTimeout(() => {
    process.exit(0);
  }, 3000);

  // Attempt graceful cleanup
  closeConnection().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error during shutdown');
    console.error(`   Error: ${errorMessage}`);
    console.error('   Note: Data has been preserved');
    process.exitCode = 1;
  });
}

process.on('SIGINT', () => {
  handleShutdown().catch(() => {
    // Ignore shutdown errors - process is terminating anyway
  });
});
process.on('SIGTERM', () => {
  handleShutdown().catch(() => {
    // Ignore shutdown errors - process is terminating anyway
  });
});

// Start the application
main();
