/**
 * Unit Tests for Email Verifier Module
 * Tests MyEmailVerifier API integration with mocked fetch and Zod validation
 */

import { describe, expect, it } from 'bun:test';
import {
  getVerificationStatusDescription,
  isEmailSafe,
} from '../../src/verifier.js';
import { validateEmailVerificationResponse } from '../../src/utils/security.js';
import type { EmailVerificationResponse } from '../../src/types.js';
import {
  createCatchAllVerificationResponse,
  createDisposableVerificationResponse,
  createInvalidVerificationResponse,
  createRoleVerificationResponse,
  createUnknownVerificationResponse,
  createValidVerificationResponse,
} from '../helpers/mock-factories.js';

describe('Verifier Module', () => {
  describe('isEmailSafe()', () => {
    it('should return true for valid emails with low risk', () => {
      // Arrange
      const result = createValidVerificationResponse();

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(true);
    });

    it('should return false for invalid emails', () => {
      // Arrange
      const result = createInvalidVerificationResponse();

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });

    it('should return true for catch-all with low risk', () => {
      // Arrange
      const result = createCatchAllVerificationResponse({ risk: 'low' });

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(true);
    });

    it('should return true for catch-all with medium risk', () => {
      // Arrange
      const result = createCatchAllVerificationResponse({ risk: 'medium' });

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(true);
    });

    it('should return false for catch-all with high risk', () => {
      // Arrange
      const result = createCatchAllVerificationResponse({ risk: 'high' });

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });

    it('should return false for valid emails with medium risk', () => {
      // Arrange
      const result = createValidVerificationResponse({ risk: 'medium' });

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });

    it('should return false for valid emails with high risk', () => {
      // Arrange
      const result = createValidVerificationResponse({ risk: 'high' });

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });

    it('should return false for disposable emails', () => {
      // Arrange
      const result = createDisposableVerificationResponse();

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });

    it('should return false for role-based emails', () => {
      // Arrange
      const result = createRoleVerificationResponse();

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });

    it('should return false for unknown status', () => {
      // Arrange
      const result = createUnknownVerificationResponse();

      // Act
      const isSafe = isEmailSafe(result);

      // Assert
      expect(isSafe).toBe(false);
    });
  });

  describe('getVerificationStatusDescription()', () => {
    it('should return description for valid email', () => {
      // Arrange
      const result = createValidVerificationResponse();

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Valid email address');
      expect(description).toContain('Low risk');
    });

    it('should return description for invalid email', () => {
      // Arrange
      const result = createInvalidVerificationResponse();

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Invalid email address');
      expect(description).toContain('High risk');
    });

    it('should return description for catch-all email', () => {
      // Arrange
      const result = createCatchAllVerificationResponse();

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Catch-all domain');
    });

    it('should return description for disposable email', () => {
      // Arrange
      const result = createDisposableVerificationResponse();

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Disposable email address');
    });

    it('should return description for role-based email', () => {
      // Arrange
      const result = createRoleVerificationResponse();

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Role-based email');
    });

    it('should return description for unknown status', () => {
      // Arrange
      const result = createUnknownVerificationResponse();

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Unable to verify email');
    });

    it('should handle unknown status gracefully', () => {
      // Arrange
      const result: EmailVerificationResponse = {
        status: 'unknown_status' as EmailVerificationResponse['status'],
        risk: 'unknown_risk' as EmailVerificationResponse['risk'],
      };

      // Act
      const description = getVerificationStatusDescription(result);

      // Assert
      expect(description).toContain('Unknown status');
      expect(description).toContain('Unknown risk');
    });
  });

  // ============================================================================
  // ZOD VALIDATION TESTS (HIGH)
  // ============================================================================
  describe('Zod Schema Validation', () => {
    describe('Valid API Responses Pass Validation', () => {
      it('should validate complete valid response', () => {
        const response = {
          status: 'valid' as const,
          risk: 'low' as const,
          email: 'test@example.com',
          message: 'Email is valid',
        };

        const result = validateEmailVerificationResponse(response);

        expect(result.status).toBe('valid');
        expect(result.risk).toBe('low');
        expect(result.email).toBe('test@example.com');
        expect(result.message).toBe('Email is valid');
      });

      it('should validate response with only required fields', () => {
        const response = {
          status: 'valid' as const,
          risk: 'low' as const,
        };

        const result = validateEmailVerificationResponse(response);

        expect(result.status).toBe('valid');
        expect(result.risk).toBe('low');
      });

      it('should validate all valid status values', () => {
        const validStatuses: Array<'valid' | 'invalid' | 'catch-all' | 'unknown' | 'role' | 'disposable'> =
          ['valid', 'invalid', 'catch-all', 'unknown', 'role', 'disposable'];

        for (const status of validStatuses) {
          const response = { status, risk: 'low' as const };
          const result = validateEmailVerificationResponse(response);
          expect(result.status).toBe(status);
        }
      });

      it('should validate all valid risk values', () => {
        const validRisks: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

        for (const risk of validRisks) {
          const response = { status: 'valid' as const, risk };
          const result = validateEmailVerificationResponse(response);
          expect(result.risk).toBe(risk);
        }
      });

      it('should validate response with optional email field', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          email: 'user@domain.com',
        };

        const result = validateEmailVerificationResponse(response);

        expect(result.email).toBe('user@domain.com');
      });

      it('should validate response with optional message field', () => {
        const response = {
          status: 'invalid',
          risk: 'high',
          message: 'Domain does not exist',
        };

        const result = validateEmailVerificationResponse(response);

        expect(result.message).toBe('Domain does not exist');
      });
    });

    describe('Missing Fields Throw Validation Errors', () => {
      it('should throw error when status is missing', () => {
        const response = {
          risk: 'low',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error when risk is missing', () => {
        const response = {
          status: 'valid',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error when both required fields are missing', () => {
        const response = {};

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error for null response', () => {
        expect(() => validateEmailVerificationResponse(null)).toThrow();
      });

      it('should throw error for undefined response', () => {
        expect(() => validateEmailVerificationResponse(undefined)).toThrow();
      });

      it('should throw error for array instead of object', () => {
        const response = ['valid', 'low'];

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });
    });

    describe('Invalid Field Values Throw Validation Errors', () => {
      it('should throw error for invalid status value', () => {
        const response = {
          status: 'not-a-valid-status',
          risk: 'low',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error for invalid risk value', () => {
        const response = {
          status: 'valid',
          risk: 'not-a-risk',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error for numeric status', () => {
        const response = {
          status: 123,
          risk: 'low',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error for boolean risk', () => {
        const response = {
          status: 'valid',
          risk: true,
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should throw error for invalid email format', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          email: 'not-an-email',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });
    });

    describe('Extra Fields Are Handled Gracefully', () => {
      it('should reject extra fields in strict mode', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          extraField: 'should not be allowed',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should reject multiple extra fields', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          extra1: 'value1',
          extra2: 'value2',
          extra3: 'value3',
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should reject nested extra objects', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          nested: { key: 'value' },
        };

        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });
    });

    describe('Malformed JSON Throws Proper Errors', () => {
      it('should throw error for string input', () => {
        expect(() => validateEmailVerificationResponse('not an object')).toThrow();
      });

      it('should throw error for number input', () => {
        expect(() => validateEmailVerificationResponse(123)).toThrow();
      });

      it('should throw error for boolean input', () => {
        expect(() => validateEmailVerificationResponse(true)).toThrow();
      });

      it('should throw error for empty string', () => {
        expect(() => validateEmailVerificationResponse('')).toThrow();
      });
    });

    describe('Edge Cases and Boundary Values', () => {
      it('should handle empty optional fields', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          email: '',
          message: '',
        };

        // Empty strings are not valid for optional email field (must be valid email)
        expect(() => validateEmailVerificationResponse(response)).toThrow();
      });

      it('should handle very long message field', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          message: 'a'.repeat(10000),
        };

        const result = validateEmailVerificationResponse(response);
        expect(result.message).toBe('a'.repeat(10000));
      });

      it('should handle special characters in message', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          message: 'Special chars: <>&"\'',
        };

        const result = validateEmailVerificationResponse(response);
        expect(result.message).toBe('Special chars: <>&"\'');
      });

      it('should handle unicode in message', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          message: 'Unicode: 你好世界 🌍',
        };

        const result = validateEmailVerificationResponse(response);
        expect(result.message).toBe('Unicode: 你好世界 🌍');
      });

      it('should handle complex email addresses', () => {
        const response = {
          status: 'valid',
          risk: 'low',
          email: 'user+tag.sub@example.co.uk',
        };

        const result = validateEmailVerificationResponse(response);
        expect(result.email).toBe('user+tag.sub@example.co.uk');
      });
    });

    describe('Error Message Quality', () => {
      it('should include field name in error message', () => {
        const response = { status: 'valid' }; // missing risk

        let caughtError: Error | undefined;
        try {
          validateEmailVerificationResponse(response);
        } catch (error) {
          caughtError = error as Error;
        }

        expect(caughtError).toBeDefined();
        const message = caughtError?.message || '';
        expect(message).toContain('risk');
        expect(message.toLowerCase()).toContain('invalid option');
      });

      it('should include invalid value info in error message', () => {
        const response = {
          status: 'invalid-status',
          risk: 'low',
        };

        let caughtError: Error | undefined;
        try {
          validateEmailVerificationResponse(response);
        } catch (error) {
          caughtError = error as Error;
        }

        expect(caughtError).toBeDefined();
        const message = caughtError?.message || '';
        expect(message.toLowerCase()).toContain('status');
        expect(message.toLowerCase()).toContain('invalid');
      });

      it('should list all validation errors for multiple issues', () => {
        const response = {
          status: 'bad',
          risk: 'bad',
        };

        let caughtError: Error | undefined;
        try {
          validateEmailVerificationResponse(response);
        } catch (error) {
          caughtError = error as Error;
        }

        expect(caughtError).toBeDefined();
        const message = caughtError?.message || '';
        // Error should mention validation failed
        expect(message.toLowerCase()).toContain('validation');
      });
    });
  });

});
