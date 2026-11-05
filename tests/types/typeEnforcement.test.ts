import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/core/errors';
import {
  isSignedEvent,
  isUnsignedEvent,
  validateAndAssertSigned,
  validateSignedEvent,
} from '../../src/core/EventValidator';
import {
  assertSignedEvent,
  assertUnsignedEvent,
  type SignedEvent,
  type UnsignedEvent,
} from '../../src/core/types';
import { createSignedEvent, createUnsignedEvent } from '../utils/fixtures';

const EVENT_NOT_SIGNED = 'Event is not signed';
const EVENT_IS_SIGNED = 'Event is signed';
const TEST_THROW_ON_UNSIGNED = 'should throw on unsigned event';

/**
 * Type tests for compile-time enforcement
 * These tests verify that the type system properly enforces signed/unsigned event types
 */

describe('typeEnforcement', () => {
  describe('Type narrowing with isSignedEvent', () => {
    it('should narrow type to SignedEvent', () => {
      const event = createSignedEvent();

      if (isSignedEvent(event)) {
        // TypeScript should know event is SignedEvent here
        const signed: SignedEvent = event; // Should compile without error
        expect(signed).toBeDefined();
      }
    });

    it('should narrow type to UnsignedEvent', () => {
      const event = createUnsignedEvent();

      if (isUnsignedEvent(event)) {
        // TypeScript should know event is UnsignedEvent here
        const unsigned: UnsignedEvent = event; // Should compile without error
        expect(unsigned).toBeDefined();
      }
    });
  });

  describe('Type assertion with assertSignedEvent', () => {
    it('should assert and narrow type to SignedEvent', () => {
      const event = createSignedEvent();

      assertSignedEvent(event);
      // TypeScript should know event is SignedEvent after assertion
      const signed: SignedEvent = event; // Should compile without error
      expect(signed).toBeDefined();
    });

    it(TEST_THROW_ON_UNSIGNED, () => {
      const event = createUnsignedEvent();

      expect(() => assertSignedEvent(event)).toThrow(EVENT_NOT_SIGNED);
    });
  });

  describe('Type assertion with assertUnsignedEvent', () => {
    it('should assert and narrow type to UnsignedEvent', () => {
      const event = createUnsignedEvent();

      assertUnsignedEvent(event);
      // TypeScript should know event is UnsignedEvent after assertion
      const unsigned: UnsignedEvent = event; // Should compile without error
      expect(unsigned).toBeDefined();
    });

    it('should throw on signed event', () => {
      const event = createSignedEvent();

      expect(() => assertUnsignedEvent(event)).toThrow(EVENT_IS_SIGNED);
    });
  });

  describe('validateSignedEvent type narrowing', () => {
    it('should return SignedEvent type', () => {
      const event = createSignedEvent();
      const validated = validateSignedEvent(event);

      // TypeScript should know validated is SignedEvent
      const signed: SignedEvent = validated; // Should compile without error
      expect(signed).toBeDefined();
    });

    it(TEST_THROW_ON_UNSIGNED, () => {
      const event = createUnsignedEvent();

      expect(() => validateSignedEvent(event)).toThrow(ValidationError);
    });
  });

  describe('validateAndAssertSigned type narrowing', () => {
    it('should return SignedEvent type from Event', () => {
      const event = createSignedEvent();
      const validated = validateAndAssertSigned(event);

      // TypeScript should know validated is SignedEvent
      const signed: SignedEvent = validated; // Should compile without error
      expect(signed).toBeDefined();
    });

    it(TEST_THROW_ON_UNSIGNED, () => {
      const event = createUnsignedEvent();

      // Should throw an error (ValidationError or similar)
      expect(() => validateAndAssertSigned(event)).toThrow();
    });
  });

  describe('Compile-time type safety', () => {
    // These tests verify that TypeScript prevents invalid operations at compile time
    // The actual compilation check happens via TypeScript's type checker

    it('should enforce SignedEvent type in function parameters', () => {
      // This function should only accept SignedEvent
      function publishEvent(event: SignedEvent): void {
        expect(event.sig).toBeDefined();
      }

      const signed = createSignedEvent();
      publishEvent(signed); // Should compile

      // The following should NOT compile (TypeScript error):
      // const unsigned = createUnsignedEvent();
      // publishEvent(unsigned); // Type error: UnsignedEvent is not assignable to SignedEvent
    });

    it('should enforce UnsignedEvent type in function parameters', () => {
      // This function should only accept UnsignedEvent
      function signEvent(event: UnsignedEvent): SignedEvent {
        // Signing logic would go here
        return event as unknown as SignedEvent; // Type assertion for test (via unknown to avoid type error)
      }

      const unsigned = createUnsignedEvent();
      // Type assertion needed because createUnsignedEvent returns Event, not UnsignedEvent
      signEvent(unsigned as UnsignedEvent); // Should compile

      // The following should NOT compile (TypeScript error):
      // const signed = createSignedEvent();
      // signEvent(signed); // Type error: SignedEvent is not assignable to UnsignedEvent
    });
  });
});
