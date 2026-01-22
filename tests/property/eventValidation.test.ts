import { describe, expect, it } from 'vitest';

import { isSignedEvent, isUnsignedEvent, validateEvent, validateSignedEvent } from '../../src/core/EventValidator';
import { createSignedEvent, createUnsignedEvent } from '../utils/fixtures';

describe('Event Validation Properties', () => {
  describe('validateEvent properties', () => {
    it('should be idempotent for valid events', () => {
      const event = createSignedEvent();
      const first = validateEvent(event);
      const second = validateEvent(event);
      expect(first).toBe(second);
      expect(first).toBe(true);
    });

    it('should always return false for invalid structures', () => {
      const invalidInputs = [null, undefined, 'string', 123, [], {}];
      invalidInputs.forEach((input) => {
        expect(validateEvent(input)).toBe(false);
      });
    });

    it('should validate any valid event structure', () => {
      const events = [
        createSignedEvent({ kind: 1 }),
        createSignedEvent({ kind: 0 }),
        createSignedEvent({ kind: 3 }),
        createSignedEvent({ kind: 4 }),
      ];

      events.forEach((event) => {
        expect(validateEvent(event)).toBe(true);
      });
    });
  });

  describe('isSignedEvent properties', () => {
    it('should always return true for signed events', () => {
      const signedEvents = [
        createSignedEvent(),
        createSignedEvent({ kind: 0 }),
        createSignedEvent({ kind: 3 }),
      ];

      signedEvents.forEach((event) => {
        expect(isSignedEvent(event)).toBe(true);
      });
    });

    it('should always return false for unsigned events', () => {
      const unsignedEvents = [
        createUnsignedEvent(),
        createUnsignedEvent({ kind: 0 }),
      ];

      unsignedEvents.forEach((event) => {
        expect(isSignedEvent(event)).toBe(false);
      });
    });

    it('should be complementary to isUnsignedEvent', () => {
      const events = [
        createSignedEvent(),
        createUnsignedEvent(),
        createSignedEvent({ kind: 0 }),
      ];

      events.forEach((event) => {
        if (isSignedEvent(event)) {
          expect(isUnsignedEvent(event)).toBe(false);
        } else {
          expect(isUnsignedEvent(event)).toBe(true);
        }
      });
    });
  });

  describe('validateSignedEvent properties', () => {
    it('should round-trip: validate → isSignedEvent → validateSignedEvent', () => {
      const event = createSignedEvent();
      
      // Step 1: validate
      expect(validateEvent(event)).toBe(true);
      
      // Step 2: isSignedEvent
      expect(isSignedEvent(event)).toBe(true);
      
      // Step 3: validateSignedEvent (should not throw)
      expect(() => validateSignedEvent(event)).not.toThrow();
    });

    it('should throw for any unsigned event', () => {
      const unsignedEvent = createUnsignedEvent();
      expect(() => validateSignedEvent(unsignedEvent)).toThrow();
    });

    it('should throw for any invalid event', () => {
      const invalidInputs = [null, undefined, {}, { id: 'test' }];
      invalidInputs.forEach((input) => {
        expect(() => validateSignedEvent(input)).toThrow();
      });
    });
  });
});
