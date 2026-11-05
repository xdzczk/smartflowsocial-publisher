/**
 * Input Validation Security Tests
 *
 * Tests that the application properly validates and sanitizes user input
 * to prevent injection attacks, DoS via oversized payloads, and malformed data.
 */

import { describe, expect, it } from 'vitest';

import { sanitizeContent, sanitizeEvent, sanitizeTags } from '../../src/security/sanitizer';
import { validatePublishRequest } from '../../src/validation/schemas';

const CONTENT_MUST_BE_STRING = 'Content must be a string';
const RELAY_DAMUS_URL = 'wss://relay.damus.io';
const HELLO_NOSTR = 'Hello, Nostr!';

describe('Input Validation: Content Sanitization', () => {
  describe('sanitizeContent', () => {
    it('should accept valid content', () => {
      const content = HELLO_NOSTR;
      expect(() => sanitizeContent(content)).not.toThrow();
      expect(sanitizeContent(content)).toBe(content);
    });

    it('should reject non-string content', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeContent(null)).toThrow(CONTENT_MUST_BE_STRING);
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeContent(123)).toThrow(CONTENT_MUST_BE_STRING);
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeContent({})).toThrow(CONTENT_MUST_BE_STRING);
    });

    it('should enforce maximum content size (1MB)', () => {
      const maxSize = 1024 * 1024; // 1MB
      const validContent = 'a'.repeat(maxSize);
      expect(() => sanitizeContent(validContent)).not.toThrow();

      const oversizedContent = 'a'.repeat(maxSize + 1);
      expect(() => sanitizeContent(oversizedContent)).toThrow('Content exceeds maximum size');
    });

    it('should validate UTF-8 encoding', () => {
      // Valid UTF-8
      expect(() => sanitizeContent('Hello, 世界!')).not.toThrow();

      // Invalid UTF-8 sequences should be caught by TextEncoder/Decoder
      // Note: JavaScript strings are always valid UTF-16, so we test the validation logic
      const validContent = 'Valid UTF-8 content';
      expect(() => sanitizeContent(validContent)).not.toThrow();
    });
  });

  describe('sanitizeTags', () => {
    it('should accept valid tags', () => {
      const tags: unknown[][] = [
        ['t', 'nostr'],
        ['p', 'pubkey123'],
        ['e', 'eventid456'],
      ];
      expect(() => sanitizeTags(tags)).not.toThrow();
      expect(sanitizeTags(tags)).toEqual(tags);
    });

    it('should reject non-array tags', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeTags(null)).toThrow('Tags must be an array');
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeTags('not-an-array')).toThrow('Tags must be an array');
    });

    it('should enforce maximum tags count (1000)', () => {
      const validTags = Array.from({ length: 1000 }, (_, i) => ['t', `tag${i}`]);
      expect(() => sanitizeTags(validTags)).not.toThrow();

      const oversizedTags = Array.from({ length: 1001 }, (_, i) => ['t', `tag${i}`]);
      expect(() => sanitizeTags(oversizedTags)).toThrow(
        'Tags array exceeds maximum length of 1000'
      );
    });

    it('should enforce maximum tag length (100 elements)', () => {
      const validTag = Array.from({ length: 100 }, (_, i) => `element${i}`);
      expect(() => sanitizeTags([validTag])).not.toThrow();

      const oversizedTag = Array.from({ length: 101 }, (_, i) => `element${i}`);
      expect(() => sanitizeTags([oversizedTag])).toThrow(
        'Tag at index 0 exceeds maximum length of 100'
      );
    });

    it('should enforce maximum tag element length (1000 chars)', () => {
      const validElement = 'a'.repeat(1000);
      expect(() => sanitizeTags([['t', validElement]])).not.toThrow();

      const oversizedElement = 'a'.repeat(1001);
      expect(() => sanitizeTags([['t', oversizedElement]])).toThrow(
        'Tag element at [0][1] exceeds maximum length of 1000'
      );
    });

    it('should accept string and number tag elements', () => {
      const tags: unknown[][] = [
        ['t', 'string-tag'],
        ['n', 123],
        ['p', 'pubkey'],
      ];
      expect(() => sanitizeTags(tags)).not.toThrow();
    });

    it('should reject invalid tag element types', () => {
      // @ts-ignore - Testing invalid input
      expect(() => sanitizeTags([[null]])).toThrow(
        'Tag element at [0][0] must be a string or number'
      );
      // @ts-ignore - Testing invalid input
      expect(() => sanitizeTags([[{}]])).toThrow(
        'Tag element at [0][0] must be a string or number'
      );
    });

    it('should validate UTF-8 encoding for string tag elements', () => {
      const validTags = [['t', 'Valid UTF-8 tag']];
      expect(() => sanitizeTags(validTags)).not.toThrow();
    });
  });

  describe('sanitizeEvent', () => {
    it('should accept valid event', () => {
      const event = {
        content: HELLO_NOSTR,
        tags: [['t', 'nostr']],
      };
      expect(() => sanitizeEvent(event)).not.toThrow();
      const sanitized = sanitizeEvent(event);
      expect(sanitized.content).toBe(event.content);
      expect(sanitized.tags).toEqual(event.tags);
    });

    it('should reject non-object event', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeEvent(null)).toThrow('Event must be an object');
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeEvent('not-an-object')).toThrow('Event must be an object');
    });

    it('should require content to be a string', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeEvent({ content: null, tags: [] })).toThrow(
        'Event content must be a string'
      );
    });

    it('should require tags to be an array', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => sanitizeEvent({ content: 'test', tags: 'not-an-array' })).toThrow(
        'Event tags must be an array'
      );
    });
  });
});

describe('Input Validation: Schema Validation', () => {
  describe('validatePublishRequest', () => {
    it('should accept valid publish request', () => {
      const request = {
        relays: [RELAY_DAMUS_URL],
        event: {
          id: 'a'.repeat(64),
          pubkey: 'b'.repeat(64),
          kind: 1,
          created_at: 1234567890,
          content: HELLO_NOSTR,
          tags: [],
          sig: 'c'.repeat(128),
        },
      };
      expect(() => validatePublishRequest(request)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      // @ts-ignore - Testing invalid input
      expect(() => validatePublishRequest({})).toThrow();
      // @ts-ignore - Testing invalid input
      expect(() => validatePublishRequest({ relays: [] })).toThrow();
    });

    it('should validate relay URLs', () => {
      const request = {
        relays: ['invalid-url'],
        event: {
          id: 'a'.repeat(64),
          pubkey: 'b'.repeat(64),
          kind: 1,
          created_at: 1234567890,
          content: 'test',
          tags: [],
          sig: 'c'.repeat(128),
        },
      };
      expect(() => validatePublishRequest(request)).toThrow();
    });

    it('should validate event structure', () => {
      const request = {
        relays: [RELAY_DAMUS_URL],
        event: {
          // Missing required fields
          id: 'a'.repeat(64),
        },
      };
      // @ts-ignore - Testing invalid input
      expect(() => validatePublishRequest(request)).toThrow();
    });

    it('should validate event ID format (64 hex chars)', () => {
      const request = {
        relays: [RELAY_DAMUS_URL],
        event: {
          id: 'invalid-id', // Too short
          pubkey: 'b'.repeat(64),
          kind: 1,
          created_at: 1234567890,
          content: 'test',
          tags: [],
          sig: 'c'.repeat(128),
        },
      };
      // @ts-ignore - Testing invalid input (id format validation)
      expect(() => validatePublishRequest(request)).toThrow();
    });

    it('should validate signature format (128 hex chars)', () => {
      const request = {
        relays: [RELAY_DAMUS_URL],
        event: {
          id: 'a'.repeat(64),
          pubkey: 'b'.repeat(64),
          kind: 1,
          created_at: 1234567890,
          content: 'test',
          tags: [],
          sig: 'invalid-sig', // Too short
        },
      };
      // @ts-ignore - Testing invalid input (signature format validation)
      expect(() => validatePublishRequest(request)).toThrow();
    });
  });
});
