/**
 * Unit Tests for Path Validator Utility
 * Verifies that file paths are correctly validated and traversal is blocked
 */

import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import {
  validateImportPath,
  validateTemplatePath,
  validateFilePath,
} from '../../src/path-validator.js';

describe('Path Validator Utility', () => {
  describe('validateImportPath()', () => {
    it('should validate a correct relative path to an Excel file', () => {
      const path = 'data/test-valid.xlsx';
      const result = validateImportPath(path);
      expect(result.valid).toBe(true);
      expect(result.sanitizedPath).toBe(resolve(process.cwd(), path));
    });

    it('should reject a path with ../ traversal', () => {
      const path = 'data/../../../etc/passwd';
      const result = validateImportPath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject Windows-style traversal sequences', () => {
      const path = 'data\\....\\....\\windows\\system32\\config\\sam';
      const result = validateImportPath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject URL-encoded traversal sequences', () => {
      const path = 'data/%2e%2e/%2e%2e/secret.txt';
      const result = validateImportPath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject an absolute path outside allowed directories', () => {
      const path = resolve('/tmp/outside.xlsx');
      const result = validateImportPath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('outside');
    });

    it('should reject invalid file extensions for imports', () => {
      const path = 'data/test.txt';
      const result = validateImportPath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('extension');
    });
  });

  describe('validateTemplatePath()', () => {
    it('should validate a correct relative path to a template', () => {
      const path = 'templates/sample-template.md';
      const result = validateTemplatePath(path);
      expect(result.valid).toBe(true);
      expect(result.sanitizedPath).toBe(resolve(process.cwd(), path));
    });

    it('should reject traversal attempts in templates', () => {
      const path = 'templates/../../config.ts';
      const result = validateTemplatePath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject invalid file extensions for templates', () => {
      const path = 'templates/image.png';
      const result = validateTemplatePath(path);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('extension');
    });
  });

  describe('validateFilePath()', () => {
    it('should validate any allowed extension', () => {
      const path = 'data/test.json';
      const result = validateFilePath(path, ['.json']);
      expect(result.valid).toBe(true);
      expect(result.sanitizedPath).toBe(resolve(process.cwd(), path));
    });

    it('should reject traversal in generic file paths', () => {
      const path = 'data/..\\..\\etc/shadow';
      const result = validateFilePath(path, ['.shadow']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });
  });
});
