import type { Event } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';

import { ValidationError } from '../core/errors';

/**
 * Rejects events whose id or schnorr signature does not match the payload.
 * Format checks alone are not enough: a 128-character hex string is not a signature.
 */
export function assertEventSignature(event: Event): void {
  let valid = false;
  try {
    valid = verifyEvent(event);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new ValidationError('Event signature is invalid', 'event.sig');
  }
}
