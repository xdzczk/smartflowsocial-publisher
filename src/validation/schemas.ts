import type { Event } from 'nostr-tools';
import * as v from 'valibot';

import { ValidationError } from '../core/errors';
import type { SignedEvent } from '../core/types';

/**
 * Validates a hex string of specific length
 */
function hexString(length: number) {
  return v.pipe(
    v.string(),
    v.regex(new RegExp(`^[0-9a-fA-F]{${length}}$`), `Must be ${length}-character hex string`)
  );
}

/**
 * Validates a 64-character hex string (for event IDs and pubkeys)
 */
const hex64 = hexString(64);

/**
 * Validates a Nostr event tag (array of strings)
 */
const tagSchema = v.array(v.string());

/**
 * Validates Nostr event structure
 */
export const EventSchema = v.object({
  id: hex64,
  pubkey: hex64,
  kind: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65535)),
  sig: v.string(),
  created_at: v.pipe(v.number(), v.integer(), v.minValue(0)),
  content: v.string(),
  tags: v.array(tagSchema),
});

/**
 * Validates a signed event (event with non-empty signature and IDs)
 * Validates EventSchema first, then checks that id, pubkey, and sig are non-empty
 */
export const SignedEventSchema = v.pipe(
  EventSchema,
  v.custom((event) => {
    const e = event as Event;
    return (
      typeof e.id === 'string' &&
      e.id.length > 0 &&
      typeof e.pubkey === 'string' &&
      e.pubkey.length > 0 &&
      typeof e.sig === 'string' &&
      e.sig.length > 0
    );
  }, 'Event must have non-empty id, pubkey, and sig fields')
);

/**
 * Validates a relay URL (wss:// scheme required)
 */
export const RelayUrlSchema = v.pipe(
  v.string(),
  v.url('Must be a valid URL'),
  v.custom((url) => {
    const urlStr = url as string;
    try {
      const urlObj = new URL(urlStr);
      // Allow wss://, ws://, https://, http:// - will be normalized to wss://
      return (
        urlObj.protocol === 'wss:' ||
        urlObj.protocol === 'ws:' ||
        urlObj.protocol === 'https:' ||
        urlObj.protocol === 'http:'
      );
    } catch {
      return false;
    }
  }, 'Must use wss://, ws://, https://, or http:// scheme')
);

/**
 * Validates a publish request body
 */
export const PublishRequestSchema = v.object({
  relays: v.array(RelayUrlSchema, 'relays must be an array of valid relay URLs'),
  event: EventSchema,
  correlationId: v.optional(v.string()),
  returnPerRelayResults: v.optional(v.boolean()),
});

/**
 * Validates a profile request body
 */
export const ProfileRequestSchema = v.object({
  relays: v.array(RelayUrlSchema, 'relays must be an array of valid relay URLs'),
  pubkey: v.pipe(v.string(), v.minLength(1)),
});

/**
 * Validates an event using EventSchema
 * @param event The event to validate
 * @returns Validated Event
 * @throws {ValidationError} if validation fails
 */
export function validateEvent(event: unknown): Event {
  try {
    return v.parse(EventSchema, event);
  } catch (error) {
    if (error instanceof v.ValiError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path?.map((p: { key: unknown }) => String(p.key)).join('.') ?? 'root';
        return `${path}: ${issue.message}`;
      });
      throw new ValidationError(
        `Invalid event: ${issues.join(', ')}`,
        'event',
        { valibotIssues: error.issues }
      );
    }
    throw new ValidationError('Invalid event format', 'event');
  }
}

/**
 * Validates a signed event using SignedEventSchema
 * @param event The event to validate
 * @returns Validated SignedEvent
 * @throws {ValidationError} if validation fails
 */
export function validateSignedEventSchema(event: unknown): SignedEvent {
  try {
    const validated = v.parse(SignedEventSchema, event) as Event;
    // Additional check for signature format (128-char hex)
    if (!/^[0-9a-fA-F]{128}$/.test(validated.sig)) {
      throw new ValidationError(
        'Invalid signature: must be 128-character hex string',
        'event.sig'
      );
    }
    return validated as SignedEvent;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    if (error instanceof v.ValiError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path?.map((p: { key: unknown }) => String(p.key)).join('.') ?? 'root';
        return `${path}: ${issue.message}`;
      });
      throw new ValidationError(
        `Invalid signed event: ${issues.join(', ')}`,
        'event',
        { valibotIssues: error.issues }
      );
    }
    throw new ValidationError('Invalid signed event format', 'event');
  }
}

/**
 * Validates a publish request
 * @param body The request body to validate
 * @returns Validated publish request
 * @throws {ValidationError} if validation fails
 */
export function validatePublishRequest(body: unknown): {
  relays: string[];
  event: Event;
  correlationId?: string;
} {
  try {
    const validated = v.parse(PublishRequestSchema, body);
    return {
      relays: validated.relays,
      event: validated.event,
      correlationId: validated.correlationId,
    };
  } catch (error) {
    if (error instanceof v.ValiError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path?.map((p: { key: unknown }) => String(p.key)).join('.') ?? 'root';
        return `${path}: ${issue.message}`;
      });
      // Determine field from first issue path
      // If path starts with 'relays', use 'relays' as the field (handles 'relays', 'relays.0', etc.)
      const firstIssue = error.issues[0];
      const fieldPath = firstIssue?.path?.map((p: { key: unknown }) => String(p.key)).join('.');
      const field = fieldPath?.startsWith('relays') ? 'relays' : 'body';
      throw new ValidationError(
        `Invalid publish request: ${issues.join(', ')}`,
        field,
        { valibotIssues: error.issues }
      );
    }
    throw new ValidationError('Invalid request format', 'body');
  }
}

/**
 * Validates a profile request
 * @param body The request body to validate
 * @returns Validated profile request
 * @throws {ValidationError} if validation fails
 */
export function validateProfileRequest(body: unknown): {
  relays: string[];
  pubkey: string;
} {
  try {
    const validated = v.parse(ProfileRequestSchema, body);
    return {
      relays: validated.relays,
      pubkey: validated.pubkey,
    };
  } catch (error) {
    if (error instanceof v.ValiError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path?.map((p: { key: unknown }) => String(p.key)).join('.') ?? 'root';
        return `${path}: ${issue.message}`;
      });
      throw new ValidationError(
        `Invalid profile request: ${issues.join(', ')}`,
        'body',
        { valibotIssues: error.issues }
      );
    }
    throw new ValidationError('Invalid request format', 'body');
  }
}

/**
 * Validates a relay URL
 * @param url The URL to validate
 * @returns Validated relay URL
 * @throws {ValidationError} if validation fails
 */
export function validateRelayUrl(url: unknown): string {
  try {
    return v.parse(RelayUrlSchema, url);
  } catch (error) {
    if (error instanceof v.ValiError) {
      const issues = error.issues.map((issue) => issue.message).join(', ');
      throw new ValidationError(`Invalid relay URL: ${issues}`, 'relay', {
        url: String(url),
      });
    }
    throw new ValidationError('Invalid relay URL format', 'relay', { url: String(url) });
  }
}
