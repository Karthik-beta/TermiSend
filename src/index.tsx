/**
 * TermiSend - Main Entry Point
 * A local email outreach CLI with Terminal UI
 */

/** @jsxImportSource react */
import { render } from 'ink';
import { closeConnection, initializeSchema } from './db.js';
import { domainEvents, registerAllAnalyticsHandlers } from './events/index.js';
import App from './ui/index.js';

// ============================================================================
// Application Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    await initializeSchema();

    // Register analytics event handlers
    registerAllAnalyticsHandlers(domainEvents);

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
// Use exitCode instead of process.exit() to allow async cleanup to complete
let isShuttingDown = false;

process.on('SIGINT', () => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  closeConnection()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Error during shutdown');
      console.error(`   Error: ${errorMessage}`);
      console.error('   Note: Data has been preserved');
      process.exitCode = 1;
    });
});

process.on('SIGTERM', () => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  closeConnection()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Error during shutdown');
      console.error(`   Error: ${errorMessage}`);
      console.error('   Note: Data has been preserved');
      process.exitCode = 1;
    });
});

// Start the application
main();
