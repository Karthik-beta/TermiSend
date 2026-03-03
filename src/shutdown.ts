/**
 * Shutdown state management for TermiSend
 * Provides a simple, minimal shutdown flag for graceful termination
 */

/** Global shutdown state flag */
let shuttingDown = false;

/**
 * Check if the application is shutting down
 * @returns true if shutdown has been requested
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Set the shutdown flag to initiate graceful termination
 * Called by SIGINT/SIGTERM handlers
 */
export function shutdown(): void {
  shuttingDown = true;
}

/**
 * Throw an error if shutdown has been requested
 * Use this in loops and async operations to exit early
 * @throws Error with message 'Shutdown requested' if shutting down
 */
export function throwIfShuttingDown(): void {
  if (shuttingDown) {
    throw new Error('Shutdown requested');
  }
}

/**
 * Reset shutdown state (for testing purposes only)
 * @internal
 */
// biome-ignore lint/style/useNamingConvention: Double underscore prefix indicates test-only internal function
export function __resetShutdownState(): void {
  shuttingDown = false;
}
