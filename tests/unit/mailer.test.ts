/**
 * Unit Tests for Mailer Module
 * Tests email template processing and campaign functionality
 */

import { describe, expect, it } from 'bun:test';
import {
  extractSubject,
  generatePlainText,
  parseSpintax,
  processTemplate,
  renderMarkdown,
} from '../../src/mailer.js';
import { createMockContact } from '../helpers/mock-factories.js';

describe('Mailer Module', () => {
  describe('parseSpintax()', () => {
    it('should select random option from spintax', () => {
      const text = '{Hello|Hi|Hey}';
      const result = parseSpintax(text);

      expect(['Hello', 'Hi', 'Hey']).toContain(result);
    });

    it('should handle nested spintax', () => {
      const text = '{Hello {there|friend}|Hi}';
      const result = parseSpintax(text);

      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('{');
      expect(result).not.toContain('}');
    });

    it('should handle multiple spintax groups', () => {
      const text = '{A|B} and {C|D}';
      const result = parseSpintax(text);

      expect(result).not.toContain('{');
      expect(result).toContain(' and ');
    });

    it('should return original text when no spintax present', () => {
      const text = 'Hello world';
      const result = parseSpintax(text);

      expect(result).toBe('Hello world');
    });

    it('should handle empty spintax', () => {
      const text = '{option1|}';
      const result = parseSpintax(text);

      expect(['option1', '']).toContain(result);
    });

    it('should prevent infinite loops with max iterations', () => {
      const text = '{{{deeply nested}}}';
      const result = parseSpintax(text);

      expect(result).toBeDefined();
    });
  });

  describe('extractSubject()', () => {
    it('should extract H1 heading as subject', () => {
      const template = '# Welcome Email\n\nThis is the body.';
      const result = extractSubject(template);

      expect(result.subject).toBe('Welcome Email');
      expect(result.body).toBe('This is the body.');
    });

    it('should use first line as subject when no H1', () => {
      const template = 'Subject Line\n\nBody content';
      const result = extractSubject(template);

      expect(result.subject).toBe('Subject Line');
      expect(result.body).toBe('Body content');
    });

    it('should handle empty template', () => {
      const template = '';
      const result = extractSubject(template);

      expect(result.subject).toBe('');
      expect(result.body).toBe('');
    });

    it('should handle H1 with extra whitespace', () => {
      const template = '#   Subject with Spaces   \n\nBody';
      const result = extractSubject(template);

      expect(result.subject).toBe('Subject with Spaces');
    });
  });

  describe('processTemplate()', () => {
    it('should replace Name placeholder', () => {
      const template = 'Hello [Name]';
      const contact = createMockContact({ personName: 'John' });
      const result = processTemplate(template, contact);

      expect(result).toContain('Hello John');
    });

    it('should replace Company-Name placeholder', () => {
      const template = 'Welcome to [Company-Name]';
      const contact = createMockContact({ companyName: 'Acme Corp' });
      const result = processTemplate(template, contact);

      expect(result).toContain('Welcome to Acme Corp');
    });

    it('should process spintax in template', () => {
      const template = '{Hello|Hi} [Name]';
      const contact = createMockContact({ personName: 'Jane' });
      const result = processTemplate(template, contact);

      expect(result).not.toContain('{');
      expect(result).toContain('Jane');
    });

    it('should replace all placeholders', () => {
      const template = '[Name] from [Company-Name]';
      const contact = createMockContact({
        personName: 'Alice',
        companyName: 'TechCo',
      });
      const result = processTemplate(template, contact);

      expect(result).toContain('Alice');
      expect(result).toContain('TechCo');
    });
  });

  describe('renderMarkdown()', () => {
    it('should render markdown to HTML', async () => {
      const markdown = '# Heading\n\nParagraph text';
      const result = await renderMarkdown(markdown);

      expect(result).toContain('<h1');
      expect(result).toContain('Heading');
      expect(result).toContain('<p>');
    });

    it('should include minimal inline styles instead of style block', async () => {
      const markdown = '# Test';
      const result = await renderMarkdown(markdown);

      // Should NOT contain a <style> block (promotional signal)
      expect(result).not.toContain('<style');
      // Should have minimal inline styling on body
      expect(result).toContain('font-family: sans-serif');
    });

    it('should handle bold text', async () => {
      const markdown = '**bold** text';
      const result = await renderMarkdown(markdown);

      expect(result).toContain('<strong>');
    });

    it('should handle links', async () => {
      const markdown = '[link](https://example.com)';
      const result = await renderMarkdown(markdown);

      expect(result).toContain('<a href="https://example.com">');
    });
  });

  describe('generatePlainText()', () => {
    it('should remove markdown syntax', () => {
      const markdown = '# Heading\n\n**bold** text';
      const result = generatePlainText(markdown);

      expect(result).not.toContain('#');
      expect(result).not.toContain('**');
      expect(result).toContain('Heading');
      expect(result).toContain('bold');
    });

    it('should convert links to plain format', () => {
      const markdown = '[link](https://example.com)';
      const result = generatePlainText(markdown);

      expect(result).toContain('link (https://example.com)');
    });

    it('should handle lists', () => {
      const markdown = '- Item 1\n- Item 2';
      const result = generatePlainText(markdown);

      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
    });

    it('should remove code blocks', () => {
      const markdown = 'Some text\n\n```\ncode\n```\n\nMore text';
      const result = generatePlainText(markdown);

      expect(result).toContain('Some text');
      expect(result).toContain('More text');
    });
  });

});
