import type { Event } from 'nostr-tools';

import { validateSignedEvent } from '../../core/EventValidator';
import { normalizeRelayUrls } from '../../core/RelayUrl';
import type { PublishOutcome, RelayResult } from '../../core/types';

// HTTP-level types (transport layer)
export interface PublishRequest {
  relays: string[];
  event: Event;
  correlationId?: string;
  returnPerRelayResults?: boolean;
}

export interface RelayPublishResult {
  relay: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface PublishResponse {
  results: RelayPublishResult[];
}

export interface ErrorResponse {
  error: string;
}

/**
 * Parses and validates a publish request from HTTP body
 */
export function parsePublishRequest(body: unknown): {
  event: Event;
  relayUrls: string[];
} {
  // Validate body structure
  if (
    !body ||
    typeof body !== 'object' ||
    !('relays' in body) ||
    !Array.isArray((body as { relays: unknown }).relays) ||
    !('event' in body) ||
    !(body as { event: unknown }).event
  ) {
    throw new Error('Invalid request: relays must be an array and event must be an object');
  }

  const publishRequest = body as PublishRequest;
  const event = publishRequest.event;

  // Validate event is signed
  validateSignedEvent(event);

  // Normalize relays
  let relayUrls: string[];
  try {
    relayUrls = normalizeRelayUrls(publishRequest.relays);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Invalid relays array'
    );
  }

  if (relayUrls.length === 0) {
    throw new Error('No valid relays after normalization');
  }

  return { event, relayUrls };
}

/**
 * Maps a PublishOutcome to HTTP PublishResponse
 */
export function mapPublishOutcomeToResponse(outcome: PublishOutcome): PublishResponse {
  const results: RelayPublishResult[] = outcome.relays.map((relayResult: RelayResult) => ({
    relay: relayResult.relay,
    ok: relayResult.status === 'success',
    latencyMs: relayResult.latencyMs,
    error: relayResult.error,
  }));

  return { results };
}

/**
 * Maps an error to HTTP ErrorResponse
 */
export function mapErrorToResponse(error: unknown): ErrorResponse {
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: String(error) };
}
