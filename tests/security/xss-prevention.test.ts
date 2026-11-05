/**
 * XSS Prevention Security Tests
 *
 * Tests that the application properly sanitizes content
 * to prevent cross-site scripting (XSS) attacks.
 */

import { describe, expect, it } from 'vitest';

import { encodeHTMLEntities, sanitizeContent } from '../../src/security/sanitizer';

describe('XSS Prevention: Content Sanitization', () => {
  describe('sanitizeContent', () => {
    it('should accept plain text content', () => {
      const content = 'Hello, this is plain text';
      expect(() => sanitizeContent(content)).not.toThrow();
      expect(sanitizeContent(content)).toBe(content);
    });

    it('should accept content with special characters', () => {
      const content = 'Hello, @user! #hashtag $price';
      expect(() => sanitizeContent(content)).not.toThrow();
    });

    it('should validate UTF-8 encoding', () => {
      const content = 'Valid UTF-8: 世界 🌍';
      expect(() => sanitizeContent(content)).not.toThrow();
    });

    it('should enforce size limits to prevent DoS', () => {
      const maxSize = 1024 * 1024; // 1MB
      const oversizedContent = 'x'.repeat(maxSize + 1);
      expect(() => sanitizeContent(oversizedContent)).toThrow('Content exceeds maximum size');
    });
  });

  describe('encodeHTMLEntities', () => {
    it('should encode HTML entities', () => {
      const content = '<script>alert("XSS")</script>';
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toContain('&lt;');
      expect(encoded).toContain('&gt;');
      expect(encoded).not.toContain('<script>');
    });

    it('should encode ampersand', () => {
      const content = 'A & B';
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toBe('A &amp; B');
    });

    it('should encode quotes', () => {
      const content = 'He said "Hello"';
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toContain('&quot;');
    });

    it('should encode single quotes', () => {
      const content = "It's a test";
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toContain('&#39;');
    });

    it('should encode forward slash', () => {
      const content = '</script>';
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toContain('&#x2F;');
    });

    it('should not encode safe characters', () => {
      const content = 'Hello, World!';
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toBe(content);
    });

    it('should prevent script tag injection', () => {
      const xssAttempts = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror="alert(1)">',
        '<svg onload="alert(1)">',
        'javascript:alert("XSS")',
        '<iframe src="javascript:alert(1)"></iframe>',
      ];

      xssAttempts.forEach((attempt) => {
        const encoded = encodeHTMLEntities(attempt);
        expect(encoded).not.toContain('<');
        expect(encoded).not.toContain('>');
        expect(encoded).not.toContain('"');
      });
    });

    it('should handle mixed content', () => {
      const content = 'Hello <script>alert("XSS")</script> World';
      const encoded = encodeHTMLEntities(content);
      expect(encoded).toContain('&lt;script&gt;');
      expect(encoded).toContain('&lt;&#x2F;script&gt;');
      expect(encoded).toContain('Hello');
      expect(encoded).toContain('World');
    });
  });

  describe('XSS Attack Vectors', () => {
    it('should prevent script tag injection', () => {
      const malicious = '<script>document.cookie</script>';
      const encoded = encodeHTMLEntities(malicious);
      expect(encoded).not.toContain('<script>');
      expect(encoded).toContain('&lt;script&gt;');
    });

    it('should prevent event handler injection', () => {
      const malicious = '<img src=x onerror="alert(1)">';
      const encoded = encodeHTMLEntities(malicious);
      expect(encoded).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
      expect(encoded).not.toContain('<');
    });

    it('should prevent javascript: protocol injection', () => {
      const malicious = '<a href="javascript:alert(1)">Click</a>';
      const encoded = encodeHTMLEntities(malicious);
      expect(encoded).toBe('&lt;a href=&quot;javascript:alert(1)&quot;&gt;Click&lt;&#x2F;a&gt;');
      expect(encoded).not.toContain('<');
    });

    it('should prevent iframe injection', () => {
      const malicious = '<iframe src="evil.com"></iframe>';
      const encoded = encodeHTMLEntities(malicious);
      expect(encoded).toContain('&lt;iframe');
      expect(encoded).toContain('&gt;');
    });

    it('should prevent style injection', () => {
      const malicious = '<div style="background: url(javascript:alert(1))">';
      const encoded = encodeHTMLEntities(malicious);
      expect(encoded).toContain('&lt;div');
      expect(encoded).toContain('&quot;');
    });
  });
});
