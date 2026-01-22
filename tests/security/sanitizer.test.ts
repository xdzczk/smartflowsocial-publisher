import { describe, expect, it } from 'vitest';

import {
  encodeHTMLEntities,
  sanitizeContent,
  sanitizeEvent,
  sanitizeTags,
} from '../../src/security/sanitizer';

const CONTENT_MUST_BE_STRING = 'Content must be a string';
const TAGS_MUST_BE_ARRAY = 'Tags must be an array';
const EVENT_MUST_BE_OBJECT = 'Event must be an object';
const HELLO_WORLD = 'Hello, world!';
const EXCEEDS_MAX_LENGTH = 'exceeds maximum length';

describe('sanitizer', () => {
  describe('sanitizeContent', () => {
    it('should accept valid content', () => {
      const content = HELLO_WORLD;
      const result = sanitizeContent(content);
      expect(result).toBe(content);
    });

    it('should reject non-string content', () => {
      expect(() => sanitizeContent(null as unknown as string)).toThrow(CONTENT_MUST_BE_STRING);
      expect(() => sanitizeContent(123 as unknown as string)).toThrow(CONTENT_MUST_BE_STRING);
      expect(() => sanitizeContent({} as unknown as string)).toThrow(CONTENT_MUST_BE_STRING);
    });

    it('should reject content exceeding size limit', () => {
      const largeContent = 'a'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      expect(() => sanitizeContent(largeContent)).toThrow('exceeds maximum size');
    });

    it('should accept content at size limit', () => {
      const content = 'a'.repeat(1024 * 1024); // Exactly 1MB
      const result = sanitizeContent(content);
      expect(result).toBe(content);
    });

    it('should validate UTF-8 encoding', () => {
      // Valid UTF-8
      const validUTF8 = 'Hello, 世界! 🌍';
      const result = sanitizeContent(validUTF8);
      expect(result).toBe(validUTF8);
    });

    it('should handle empty string', () => {
      const result = sanitizeContent('');
      expect(result).toBe('');
    });

    it('should handle special characters', () => {
      const content = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const result = sanitizeContent(content);
      expect(result).toBe(content);
    });

    it('should handle unicode characters', () => {
      const content = 'Unicode: 你好 مرحبا Здравствуй';
      const result = sanitizeContent(content);
      expect(result).toBe(content);
    });
  });

  describe('sanitizeTags', () => {
    it('should accept valid tags', () => {
      const tags = [
        ['p', 'pubkey1'],
        ['e', 'event-id'],
        ['t', 'hashtag'],
      ];
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should reject non-array tags', () => {
      expect(() => sanitizeTags(null as unknown as unknown[][])).toThrow(TAGS_MUST_BE_ARRAY);
      expect(() => sanitizeTags('string' as unknown as unknown[][])).toThrow(TAGS_MUST_BE_ARRAY);
      expect(() => sanitizeTags({} as unknown as unknown[][])).toThrow(TAGS_MUST_BE_ARRAY);
    });

    it('should reject tags exceeding maximum count', () => {
      const tags = Array(1001).fill(['p', 'pubkey']);
      expect(() => sanitizeTags(tags)).toThrow(EXCEEDS_MAX_LENGTH);
    });

    it('should accept tags at maximum count', () => {
      const tags = Array(1000).fill(['p', 'pubkey']);
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should reject non-array tag elements', () => {
      const tags = ['p', 'pubkey'] as unknown as unknown[][];
      expect(() => sanitizeTags(tags)).toThrow('must be an array');
    });

    it('should reject tags exceeding maximum length', () => {
      const tag = Array(101).fill('value');
      const tags = [tag];
      expect(() => sanitizeTags(tags)).toThrow(EXCEEDS_MAX_LENGTH);
    });

    it('should accept tags at maximum length', () => {
      const tag = Array(100).fill('value');
      const tags = [tag];
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should reject invalid tag element types', () => {
      const tags = [['p', {}]] as unknown as unknown[][];
      expect(() => sanitizeTags(tags)).toThrow('must be a string or number');
    });

    it('should accept string tag elements', () => {
      const tags = [['p', 'pubkey1'], ['e', 'event-id']];
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should accept number tag elements', () => {
      const tags = [['expiration', 1234567890], ['p', 'pubkey']];
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should accept mixed string and number tag elements', () => {
      const tags = [['p', 'pubkey1'], ['expiration', 1234567890]];
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should reject tag elements exceeding maximum length', () => {
      const longValue = 'a'.repeat(1001);
      const tags = [['p', longValue]];
      expect(() => sanitizeTags(tags)).toThrow(EXCEEDS_MAX_LENGTH);
    });

    it('should validate UTF-8 encoding for string tag elements', () => {
      const tags = [['p', 'pubkey1'], ['content', 'Hello, 世界!']];
      const result = sanitizeTags(tags);
      expect(result).toEqual(tags);
    });

    it('should provide helpful error messages with indices', () => {
      const tags = [
        ['p', 'pubkey1'],
        ['invalid', {}], // Invalid at index 1
      ] as unknown as unknown[][];
      
      expect(() => sanitizeTags(tags)).toThrow(/\[1\]/);
    });
  });

  describe('sanitizeEvent', () => {
    it('should accept valid event', () => {
      const event = {
        content: HELLO_WORLD,
        tags: [['p', 'pubkey1']],
      };
      const result = sanitizeEvent(event);
      expect(result).toEqual(event);
    });

    it('should reject non-object event', () => {
      expect(() => sanitizeEvent(null as unknown as { content: string; tags: unknown[][] })).toThrow(EVENT_MUST_BE_OBJECT);
      expect(() => sanitizeEvent('string' as unknown as { content: string; tags: unknown[][] })).toThrow(EVENT_MUST_BE_OBJECT);
    });

    it('should reject event with non-string content', () => {
      const event = {
        content: 123,
        tags: [],
      } as unknown as { content: string; tags: unknown[][] };
      expect(() => sanitizeEvent(event)).toThrow('Event content must be a string');
    });

    it('should reject event with non-array tags', () => {
      const event = {
        content: 'Hello',
        tags: 'not-an-array',
      } as unknown as { content: string; tags: unknown[][] };
      expect(() => sanitizeEvent(event)).toThrow('Event tags must be an array');
    });

    it('should sanitize both content and tags', () => {
      const event = {
        content: HELLO_WORLD,
        tags: [['p', 'pubkey1'], ['e', 'event-id']],
      };
      const result = sanitizeEvent(event);
      expect(result.content).toBe(event.content);
      expect(result.tags).toEqual(event.tags);
    });

    it('should propagate content validation errors', () => {
      const largeContent = 'a'.repeat(1024 * 1024 + 1);
      const event = {
        content: largeContent,
        tags: [],
      };
      expect(() => sanitizeEvent(event)).toThrow('exceeds maximum size');
    });

    it('should propagate tag validation errors', () => {
      const event = {
        content: 'Hello',
        tags: Array(1001).fill(['p', 'pubkey']),
      };
      expect(() => sanitizeEvent(event)).toThrow('exceeds maximum length');
    });
  });

  describe('encodeHTMLEntities', () => {
    it('should encode HTML entities', () => {
      expect(encodeHTMLEntities('&')).toBe('&amp;');
      expect(encodeHTMLEntities('<')).toBe('&lt;');
      expect(encodeHTMLEntities('>')).toBe('&gt;');
      expect(encodeHTMLEntities('"')).toBe('&quot;');
      expect(encodeHTMLEntities("'")).toBe('&#39;');
      expect(encodeHTMLEntities('/')).toBe('&#x2F;');
    });

    it('should encode multiple entities', () => {
      expect(encodeHTMLEntities('<script>alert("XSS")</script>')).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;'
      );
    });

    it('should not encode safe characters', () => {
      const safe = `${HELLO_WORLD} 123`;
      expect(encodeHTMLEntities(safe)).toBe(safe);
    });

    it('should handle empty string', () => {
      expect(encodeHTMLEntities('')).toBe('');
    });

    it('should handle unicode characters', () => {
      const unicode = 'Hello, 世界! 🌍';
      // Unicode characters should not be encoded
      expect(encodeHTMLEntities(unicode)).toBe(unicode);
    });

    it('should handle mixed content', () => {
      const mixed = 'Hello <world> & "friends"';
      expect(encodeHTMLEntities(mixed)).toBe('Hello &lt;world&gt; &amp; &quot;friends&quot;');
    });
  });
});
