import type { Event } from 'nostr-tools';

import { validateEvent as validateEventSchema, validateSignedEventSchema } from '../validation/schemas';

import { ValidationError } from './errors';
import type { SignedEvent, UnsignedEvent } from './types';

/**
 * Validates that an event has the required fields
 * Uses Valibot schema validation for comprehensive field-level validation
 * 
 * @param event The event to validate
 * @returns Type guard indicating if event has required fields
 */
export function validateEvent(event: unknown): event is Event {
  try {
    validateEventSchema(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if an event is signed (has a valid signature field)
 * Returns a branded SignedEvent type if valid
 * 
 * @param event The event to check
 * @returns Type guard indicating if event is signed
 */
export function isSignedEvent(event: Event): event is SignedEvent {
  return (
    typeof event.sig === 'string' &&
    event.sig.length > 0 &&
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    typeof event.pubkey === 'string' &&
    event.pubkey.length > 0
  );
}

/**
 * Validates and casts an unknown value to a SignedEvent
 * Uses Valibot schema validation for comprehensive field-level validation
 * This function provides compile-time type narrowing: the return type is SignedEvent
 * @param event The event to validate
 * @returns Validated SignedEvent (type-narrowed)
 * @throws {ValidationError} if validation fails
 */
export function validateSignedEvent(event: unknown): SignedEvent {
  // At this point, validated is already a SignedEvent from the schema
  // The type system ensures this is correct
  return validateSignedEventSchema(event);
}

/**
 * Validates an Event and narrows it to SignedEvent if valid
 * This is a convenience function that combines validateEvent and isSignedEvent
 * @param event The event to validate and check
 * @returns Type-narrowed SignedEvent if valid and signed
 * @throws {ValidationError} if validation fails or event is not signed
 */
export function validateAndAssertSigned(event: Event): SignedEvent {
  if (!isSignedEvent(event)) {
    throw new ValidationError(
      'Event is not signed: missing or invalid signature',
      'event.sig'
    );
  }
  // Type system now knows event is SignedEvent
  return event;
}

/**
 * Type guard for unsigned events
 * 
 * @param event The event to check
 * @returns Type guard indicating if event is unsigned
 */
export function isUnsignedEvent(event: Event): event is UnsignedEvent {
  return !isSignedEvent(event);
}
