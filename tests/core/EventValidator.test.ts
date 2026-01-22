import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/core/errors';
import {
  isSignedEvent,
  isUnsignedEvent,
  validateEvent,
  validateSignedEvent,
} from '../../src/core/EventValidator';
import { createMalformedEvent, createSignedEvent, createUnsignedEvent } from '../utils/fixtures';

describe('EventValidator', () => {
  describe('validateEvent', () => {
    it('should validate a complete event', () => {
      const event = createSignedEvent();
      expect(validateEvent(event)).toBe(true);
    });

    it('should reject null', () => {
      expect(validateEvent(null)).toBe(false);
    });

    it('should reject undefined', () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(validateEvent(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(validateEvent('string')).toBe(false);
      expect(validateEvent(123)).toBe(false);
      expect(validateEvent([])).toBe(false);
    });

    it('should reject events missing id', () => {
      const event = createSignedEvent();
      delete (event as { id?: string }).id;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events missing pubkey', () => {
      const event = createSignedEvent();
      delete (event as { pubkey?: string }).pubkey;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events missing kind', () => {
      const event = createSignedEvent();
      delete (event as { kind?: number }).kind;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events missing sig', () => {
      const event = createSignedEvent();
      delete (event as { sig?: string }).sig;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events missing created_at', () => {
      const event = createSignedEvent();
      delete (event as { created_at?: number }).created_at;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events missing content', () => {
      const event = createSignedEvent();
      delete (event as { content?: string }).content;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events missing tags', () => {
      const event = createSignedEvent();
      delete (event as { tags?: string[][] }).tags;
      expect(validateEvent(event)).toBe(false);
    });

    it('should reject events with wrong types', () => {
      expect(validateEvent({ id: 123 })).toBe(false);
      expect(validateEvent({ id: 'test', pubkey: 123 })).toBe(false);
      expect(validateEvent({ id: 'test', pubkey: 'test', kind: '1' })).toBe(false);
    });

    it('should reject malformed events', () => {
      expect(validateEvent(createMalformedEvent())).toBe(false);
    });
  });

  describe('isSignedEvent', () => {
    it('should identify signed events', () => {
      const event = createSignedEvent();
      expect(isSignedEvent(event)).toBe(true);
    });

    it('should reject unsigned events', () => {
      const event = createUnsignedEvent();
      expect(isSignedEvent(event)).toBe(false);
    });

    it('should reject events with empty sig', () => {
      const event = createSignedEvent({ sig: '' });
      expect(isSignedEvent(event)).toBe(false);
    });

    it('should reject events with empty id', () => {
      const event = createSignedEvent({ id: '' });
      expect(isSignedEvent(event)).toBe(false);
    });

    it('should reject events with empty pubkey', () => {
      const event = createSignedEvent({ pubkey: '' });
      expect(isSignedEvent(event)).toBe(false);
    });
  });

  describe('isUnsignedEvent', () => {
    it('should identify unsigned events', () => {
      const event = createUnsignedEvent();
      expect(isUnsignedEvent(event)).toBe(true);
    });

    it('should reject signed events', () => {
      const event = createSignedEvent();
      expect(isUnsignedEvent(event)).toBe(false);
    });
  });

  describe('validateSignedEvent', () => {
    it('should return signed event for valid input', () => {
      const event = createSignedEvent();
      const result = validateSignedEvent(event);
      // Valibot validation may return a new object, so check properties instead of reference
      expect(result).toMatchObject(event);
      // Type check: result should be SignedEvent
      expect(result).toHaveProperty('sig');
      expect(result.id).toBe(event.id);
      expect(result.pubkey).toBe(event.pubkey);
    });

    it('should throw on invalid event', () => {
      expect(() => validateSignedEvent(null)).toThrow(ValidationError);
      expect(() => validateSignedEvent(createMalformedEvent())).toThrow(ValidationError);
    });

    it('should throw on unsigned event', () => {
      const event = createUnsignedEvent();
      expect(() => validateSignedEvent(event)).toThrow(ValidationError);
    });

    it('should throw on event with empty sig', () => {
      const event = createSignedEvent({ sig: '' });
      expect(() => validateSignedEvent(event)).toThrow(ValidationError);
    });
  });
});
