/**
 * Path Validation Utility for TermiSend
 * Prevents path traversal attacks by validating file paths
 */

import { extname, isAbsolute, normalize, resolve } from 'node:path';

// ============================================================================
// Constants
// ============================================================================

/** Allowed base directories for file operations */
const ALLOWED_DIRECTORIES: string[] = [
  process.cwd(),
  resolve(process.cwd(), 'templates'),
  resolve(process.cwd(), 'uploads'),
  resolve(process.cwd(), 'data'),
];

/** Allowed file extensions for imports */
const ALLOWED_IMPORT_EXTENSIONS = ['.xlsx', '.xls'];

/** Allowed file extensions for templates */
const ALLOWED_TEMPLATE_EXTENSIONS = ['.md', '.markdown', '.txt'];

// ============================================================================
// Validation Result Type
// ============================================================================

export interface PathValidationResult {
  valid: boolean;
  sanitizedPath: string;
  error?: string;
}

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Check if a path contains traversal sequences
 * Rejects paths containing '..' or encoded variants
 *
 * Security: Handles mixed-encoding attacks by decoding up to 3 layers deep.
 * This catches patterns like %2e.%2e/ (single-encoded), %252e%252e%252f (double-encoded),
 * and hex escapes like \x2e. Each layer is decoded and checked for traversal patterns.
 */
function containsTraversal(input: string): boolean {
  // Check for null bytes first (common injection attack)
  if (input.includes('%00')) {
    return true;
  }

  // Decode the input multiple times to handle nested/mixed encoding
  // This catches patterns like %2e.%2e/ or %252e%252e%252f
  let decoded = input;
  const maxDecodeIterations = 3;

  for (let i = 0; i < maxDecodeIterations; i++) {
    try {
      const prev = decoded;
      decoded = decodeURIComponent(decoded);
      // Stop if no more decoding happened
      if (decoded === prev) {
        break;
      }
    } catch {
      // Malformed URI - stop decoding but continue with checks
      break;
    }
  }

  // Replace hex escape sequences like \x2e (which represents '.')
  decoded = decoded.replace(/\\x2e/gi, '.');

  // Normalize slashes for cross-platform checks
  const normalized = decoded.replace(/\\/g, '/');

  // Check for traversal patterns in decoded string
  const traversalPatterns = [
    '../', // Unix traversal
    '..\\', // Windows traversal
    '/..', // Trailing traversal
    '\\..', // Windows trailing
    '..', // Generic
    '....', // Windows alternative
  ];

  return traversalPatterns.some((pattern) => normalized.includes(pattern));
}

/**
 * Validate that a resolved path is within allowed directories
 */
function isWithinAllowedDirectories(resolvedPath: string): boolean {
  const normalizedPath = normalize(resolvedPath).toLowerCase();

  return ALLOWED_DIRECTORIES.some((allowedDir) => {
    const normalizedAllowed = normalize(allowedDir).toLowerCase();
    // Ensure the path starts with the allowed directory
    return (
      normalizedPath.startsWith(normalizedAllowed) &&
      // Ensure it's not just the directory itself with something appended
      (normalizedPath.length === normalizedAllowed.length ||
        normalizedPath[normalizedAllowed.length] === '\\' ||
        normalizedPath[normalizedAllowed.length] === '/')
    );
  });
}

/**
 * Validate file extension
 */
function hasAllowedExtension(input: string, allowedExtensions: string[]): boolean {
  const extension = extname(input).toLowerCase();
  return allowedExtensions.includes(extension);
}

/**
 * Sanitize and resolve a file path
 * Returns null if the path is invalid or outside allowed directories
 */
function resolveAndSanitize(input: string): string | null {
  // Reject empty paths
  if (!input || input.trim().length === 0) {
    return null;
  }

  // Check for traversal attempts before resolution
  if (containsTraversal(input)) {
    return null;
  }

  // Resolve the path (handles relative paths)
  let resolvedPath: string;
  if (isAbsolute(input)) {
    resolvedPath = normalize(input);
  } else {
    resolvedPath = resolve(process.cwd(), input);
  }

  // Final check: ensure resolved path doesn't escape allowed directories
  if (!isWithinAllowedDirectories(resolvedPath)) {
    return null;
  }

  return resolvedPath;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate an import file path (Excel files)
 * @param inputPath - The raw file path from user input
 * @returns ValidationResult with sanitized path or error
 */
export function validateImportPath(inputPath: string): PathValidationResult {
  // Trim whitespace and remove surrounding quotes from input to handle accidental trailing spaces or copied paths
  const trimmedPath = inputPath.trim().replace(/^"+|"+$/g, '');

  // Check for traversal
  if (containsTraversal(trimmedPath)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path contains traversal sequences (..) which are not allowed',
    };
  }

  // Check extension
  if (!hasAllowedExtension(trimmedPath, ALLOWED_IMPORT_EXTENSIONS)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: `Invalid file extension. Allowed: ${ALLOWED_IMPORT_EXTENSIONS.join(', ')}`,
    };
  }

  // Resolve and validate path
  const sanitized = resolveAndSanitize(trimmedPath);
  if (sanitized === null) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path is outside of allowed directories or contains invalid characters',
    };
  }

  return {
    valid: true,
    sanitizedPath: sanitized,
  };
}

/**
 * Validate a template file path (Markdown/text files)
 * @param inputPath - The raw file path from user input
 * @returns ValidationResult with sanitized path or error
 */
export function validateTemplatePath(inputPath: string): PathValidationResult {
  // Trim whitespace and remove surrounding quotes from input
  const trimmedPath = inputPath.trim().replace(/^"+|"+$/g, '');

  // Check for traversal
  if (containsTraversal(trimmedPath)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path contains traversal sequences (..) which are not allowed',
    };
  }

  // Check extension
  if (!hasAllowedExtension(trimmedPath, ALLOWED_TEMPLATE_EXTENSIONS)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: `Invalid file extension. Allowed: ${ALLOWED_TEMPLATE_EXTENSIONS.join(', ')}`,
    };
  }

  // Resolve and validate path
  const sanitized = resolveAndSanitize(trimmedPath);
  if (sanitized === null) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path is outside of allowed directories or contains invalid characters',
    };
  }

  return {
    valid: true,
    sanitizedPath: sanitized,
  };
}

/**
 * Generic path validation for any file type
 * @param inputPath - The raw file path from user input
 * @param allowedExtensions - Array of allowed file extensions
 * @returns ValidationResult with sanitized path or error
 */
export function validateFilePath(
  inputPath: string,
  allowedExtensions: string[]
): PathValidationResult {
  // Trim whitespace and remove surrounding quotes from input
  const trimmedPath = inputPath.trim().replace(/^"+|"+$/g, '');

  // Check for traversal
  if (containsTraversal(trimmedPath)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path contains traversal sequences (..) which are not allowed',
    };
  }

  // Check extension
  if (!hasAllowedExtension(trimmedPath, allowedExtensions)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: `Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`,
    };
  }

  // Resolve and validate path
  const sanitized = resolveAndSanitize(trimmedPath);
  if (sanitized === null) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path is outside of allowed directories or contains invalid characters',
    };
  }

  return {
    valid: true,
    sanitizedPath: sanitized,
  };
}
