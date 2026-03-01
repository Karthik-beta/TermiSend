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
 */
function containsTraversal(input: string): boolean {
  // Check for common traversal patterns
  const traversalPatterns = [
    '..',
    '%2e%2e', // URL encoded ..
    '%2E%2E', // URL encoded .. (uppercase)
    '....', // Windows alternative
  ];

  // Normalize slashes for cross-platform checks
  const normalized = input.replace(/\\/g, '/');

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
  // Check for traversal
  if (containsTraversal(inputPath)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path contains traversal sequences (..) which are not allowed',
    };
  }

  // Check extension
  if (!hasAllowedExtension(inputPath, ALLOWED_IMPORT_EXTENSIONS)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: `Invalid file extension. Allowed: ${ALLOWED_IMPORT_EXTENSIONS.join(', ')}`,
    };
  }

  // Resolve and validate path
  const sanitized = resolveAndSanitize(inputPath);
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
  // Check for traversal
  if (containsTraversal(inputPath)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path contains traversal sequences (..) which are not allowed',
    };
  }

  // Check extension
  if (!hasAllowedExtension(inputPath, ALLOWED_TEMPLATE_EXTENSIONS)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: `Invalid file extension. Allowed: ${ALLOWED_TEMPLATE_EXTENSIONS.join(', ')}`,
    };
  }

  // Resolve and validate path
  const sanitized = resolveAndSanitize(inputPath);
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
  // Check for traversal
  if (containsTraversal(inputPath)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: 'Path contains traversal sequences (..) which are not allowed',
    };
  }

  // Check extension
  if (!hasAllowedExtension(inputPath, allowedExtensions)) {
    return {
      valid: false,
      sanitizedPath: '',
      error: `Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`,
    };
  }

  // Resolve and validate path
  const sanitized = resolveAndSanitize(inputPath);
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
