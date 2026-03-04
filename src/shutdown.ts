/**
 * Shutdown state management for TermiSend
 * Provides a simple, minimal shutdown flag for graceful termination
 *
 * SHUTDOWN FLOW DOCUMENTATION:
 * =============================
 *
 * 1. INITIATION:
 *    - SIGINT (Ctrl+C) or SIGTERM signals trigger shutdown handlers in src/index.tsx
 *    - The shutdown() function sets shuttingDown = true
 *    - A 5-second grace period allows ongoing operations to complete
 *
 * 2. DETECTION:
 *    - Long-running operations should check isShuttingDown() periodically
 *    - OR use throwIfShuttingDown() to exit early with an error
 *
 * 3. CURRENT USAGE LOCATIONS:
 *    - src/throttle.ts: Checks before/after delays and during execution loops
 *    - src/mailer.ts: Checks in verifyContactEmail() before and after verification
 *    - src/index.tsx: Signal handlers initiate shutdown
 *
 * 4. BEST PRACTICES:
 *    - Add throwIfShuttingDown() at the start of async operations that take time
 *    - Add throwIfShuttingDown() after await calls that may pause execution
 *    - Let errors bubble up - the top-level handler will catch and log them
 *    - Don't add cleanup logic here - this is just a state flag
 *
 * 5. DESIGN RATIONALE:
 *    - Simple boolean flag (no complex state machine needed)
 *    - Minimal overhead (just a function call check)
 *    - Throws errors to exit early (consistent error handling)
 *    - No async/await complexity (synchronous state changes only)
 */

/** Global shutdown state flag */
let shuttingDown = false;

/** AbortController for canceling pending delays */
let shutdownController: AbortController = new AbortController();

/**
 * Get the shutdown abort signal for canceling delays
 * @returns AbortSignal that triggers when shutdown is requested
 */
export function getShutdownSignal(): AbortSignal {
  return shutdownController.signal;
}

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
  shutdownController.abort();
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
  shutdownController = new AbortController();
}
