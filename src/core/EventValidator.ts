import type { Event } from 'nostr-tools';

import type { SignedEvent, UnsignedEvent } from './types';

/**
 * Validates that an event has the required fields
 * Does not validate signature - use isSignedEvent for that
 */
export function validateEvent(event: unknown): event is Event {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const e = event as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.pubkey === 'string' &&
    typeof e.kind === 'number' &&
    typeof e.sig === 'string' &&
    typeof e.created_at === 'number' &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags)
  );
}

/**
 * Checks if an event is signed (has a valid signature field)
 * Returns a branded SignedEvent type if valid
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
 * Throws if validation fails
 */
export function validateSignedEvent(event: unknown): SignedEvent {
  if (!validateEvent(event)) {
    throw new Error('Invalid event: must have id, pubkey, kind, sig, created_at, content, and tags fields');
  }

  if (!isSignedEvent(event)) {
    throw new Error('Invalid event: must be signed (have a valid sig field)');
  }

  return event;
}

/**
 * Type guard for unsigned events
 */
export function isUnsignedEvent(event: Event): event is UnsignedEvent {
  return !isSignedEvent(event);
}
