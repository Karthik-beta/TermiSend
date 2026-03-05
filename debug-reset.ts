/**
 * Debug script to trace the database reset execution path
 */

console.log('=== Debug Script Starting ===');
console.log('process.argv:', process.argv);
console.log('process.argv.slice(2):', process.argv.slice(2));
console.log('');

// Simulate what db.ts does
const args = process.argv.slice(2);
console.log('args[0]:', args[0]);
console.log('args.includes("--confirm-reset"):', args.includes('--confirm-reset'));
console.log('process.argv.includes("--confirm-reset"):', process.argv.includes('--confirm-reset'));
console.log('');

// Check if the hasResetConfirmation logic works
function hasResetConfirmation(): boolean {
  const hasCliFlag = process.argv.includes('--confirm-reset') || process.argv.includes('-y');
  const hasEnvVar = process.env.ALLOW_DEV_RESET === 'true';
  console.log('  hasCliFlag:', hasCliFlag);
  console.log('  hasEnvVar:', hasEnvVar);
  return hasCliFlag || hasEnvVar;
}

console.log('hasResetConfirmation():', hasResetConfirmation());
console.log('');

// Simulate the exact check in db.ts
console.log('=== Checking exact condition from db.ts ===');
if (args[0] === 'reset') {
  console.log('✓ args[0] === "reset" is TRUE');
  
  if (!hasResetConfirmation()) {
    console.log('✗ Confirmation check failed - this should not happen with --confirm-reset');
  } else {
    console.log('✓ Confirmation check passed');
    console.log('');
    console.log('⚠️  WARNING: Database reset will DELETE ALL DATA!');
    console.log('This is where the warning displays...');
    console.log('');
    console.log('Now the try block should execute with SQL queries...');
  }
} else {
  console.log('✗ args[0] !== "reset" - command not recognized');
}

console.log('');
console.log('=== Debug Script Complete ===');
