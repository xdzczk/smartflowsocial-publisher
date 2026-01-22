import type { Event } from 'nostr-tools';

/**
 * Branded type for unsigned events
 * Events without this brand cannot be published
 */
export type UnsignedEvent = Event & { __unsigned: true };

/**
 * Branded type for signed events
 * Only events with this brand can be published
 */
export type SignedEvent = Event & { __signed: true };

/**
 * Branded type for relay URLs
 * Ensures type safety for relay URL strings
 */
export type RelayUrl = string & { __relayUrl: true };

/**
 * Closed enum for relay failure reasons
 * All possible failure modes are explicitly defined
 */
export type RelayFailureReason =
  | 'timeout'
  | 'rejected'
  | 'invalid_event'
  | 'relay_unreachable'
  | 'connection_timeout'
  | 'publish_timeout'
  | 'unknown';

/**
 * Result of publishing to a single relay
 */
export interface RelayResult {
  relay: RelayUrl;
  status: 'success' | 'failure';
  reason?: RelayFailureReason;
  latencyMs: number;
  error?: string;
}

/**
 * Outcome of publishing to multiple relays
 * Discriminated union for explicit handling of all states
 */
export type PublishOutcome =
  | { status: 'success'; relays: RelayResult[] }
  | { status: 'partial'; relays: RelayResult[] }
  | { status: 'failed'; relays: RelayResult[] };

/**
 * Profile fetch result
 */
export interface ProfileResult {
  pubkey: string;
  event: Event | null;
  relays: RelayResult[];
}
