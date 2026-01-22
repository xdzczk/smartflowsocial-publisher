import type { Event } from 'nostr-tools';

import type { PublishOutcome, RelayResult, RelayUrl, SignedEvent } from '../../src/core/types';

/**
 * Creates a valid signed event for testing
 */
 
export function createSignedEvent(overrides?: Partial<Event>): SignedEvent {
  const baseEvent: Event = {
    id: 'test-event-id-1234567890abcdef',
    // eslint-disable-next-line no-secrets/no-secrets
    pubkey: 'test-pubkey-1234567890abcdef1234567890abcdef',
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: 'Test event content',
    tags: [],
    // eslint-disable-next-line no-secrets/no-secrets
    sig: 'test-signature-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    ...overrides,
  };
  return baseEvent as SignedEvent;
}

/**
 * Creates an unsigned event for testing
 */
 
export function createUnsignedEvent(overrides?: Partial<Event>): Event {
  const baseEvent: Event = {
    id: 'test-event-id-1234567890abcdef',
    // eslint-disable-next-line no-secrets/no-secrets
    pubkey: 'test-pubkey-1234567890abcdef1234567890abcdef',
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: 'Test event content',
    tags: [],
    sig: '', // Empty signature = unsigned
    ...overrides,
  };
  return baseEvent;
}

/**
 * Creates a malformed event (missing required fields)
 */
export function createMalformedEvent(): unknown {
  return {
    id: 'test-id',
    // Missing other required fields
  };
}

/**
 * Creates a valid relay URL
 */
export function createRelayUrl(url: string): RelayUrl {
  return url as RelayUrl;
}

/**
 * Creates a relay result for testing
 */
export function createRelayResult(
  relay: string,
  options?: {
    status?: 'success' | 'failure';
    reason?: RelayResult['reason'];
    latencyMs?: number;
    error?: string;
  }
): RelayResult {
  return {
    relay: relay as RelayUrl,
    status: options?.status ?? 'success',
    reason: options?.reason,
    latencyMs: options?.latencyMs ?? 100,
    error: options?.error,
  };
}

/**
 * Creates a publish outcome for testing
 */
export function createPublishOutcome(
  status: 'success' | 'partial' | 'failed',
  relays: RelayResult[]
): PublishOutcome {
  return {
    status,
    relays,
  } as PublishOutcome;
}

/**
 * Sample valid relay URLs
 */
export const VALID_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://relay.nostr.band',
] as const;

/**
 * Sample invalid relay URLs
 */
export const INVALID_RELAY_URLS = [
  'http://not-wss.com',
  'ftp://invalid.com',
  'not-a-url',
  '',
  'wss://',
] as const;

/**
 * Sample events of different kinds
 */
export const SAMPLE_EVENTS = {
  kind1: createSignedEvent({ kind: 1, content: 'Hello nostr!' }),
  kind0: createSignedEvent({
    kind: 0,
    content: JSON.stringify({ name: 'Test User', about: 'Test bio' }),
  }),
  kind3: createSignedEvent({ kind: 3, content: '', tags: [['p', 'pubkey1']] }),
} as const;
