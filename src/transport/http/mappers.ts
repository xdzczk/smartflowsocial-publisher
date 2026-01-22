import type { Event } from 'nostr-tools';

import {
  AppError,
  RelayError,
  TimeoutError,
  ValidationError,
} from '../../core/errors';
import { validateSignedEvent } from '../../core/EventValidator';
import { normalizeRelayUrls } from '../../core/RelayUrl';
import type { PublishOutcome, RelayResult, SignedEvent } from '../../core/types';
import { sanitizeEvent } from '../../security/sanitizer';
import { validatePublishRequest } from '../../validation/schemas';

// HTTP-level types (transport layer)
export interface PublishRequest {
  relays: string[];
  event: Event;
  correlationId?: string;
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
  code?: string;
  field?: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}

/**
 * Parses and validates a publish request from HTTP body
 * Uses Valibot schema validation for comprehensive validation
 * @returns Validated signed event and normalized relay URLs
 * @throws {ValidationError} if request is invalid
 */
export function parsePublishRequest(body: unknown): {
  event: SignedEvent;
  relayUrls: string[];
} {
  // Validate request structure using Valibot
  const validated = validatePublishRequest(body);

  // Sanitize event content and tags
  const sanitized = sanitizeEvent({
    content: validated.event.content,
    tags: validated.event.tags,
  });

  // Merge sanitized content back into event
  const sanitizedEvent = {
    ...validated.event,
    content: sanitized.content,
    tags: sanitized.tags,
  };

  // Validate event is signed - this returns SignedEvent
  const signedEvent = validateSignedEvent(sanitizedEvent);

  // Normalize relays - this can throw ValidationError with field 'relays'
  let relayUrls: string[];
  try {
    relayUrls = normalizeRelayUrls(validated.relays);
  } catch (error) {
    // Re-throw ValidationError as-is, preserving field name from normalizeRelayUrls
    if (error instanceof ValidationError) {
      throw error; // normalizeRelayUrls already sets field to 'relays'
    }
    throw new ValidationError(
      error instanceof Error ? error.message : 'Invalid relays array',
      'relays'
    );
  }

  if (relayUrls.length === 0) {
    throw new ValidationError('No valid relays after normalization', 'relays');
  }

  return { event: signedEvent, relayUrls };
}

/**
 * Maps a PublishOutcome to HTTP PublishResponse
 * 
 * @param outcome The publish outcome from the core engine
 * @returns HTTP response structure with per-relay results
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
 * Maps an error to HTTP ErrorResponse with enhanced structure
 * @param error The error to map
 * @returns HTTP error response with status code
 */
/**
 * Builds error response for AppError instances
 */
function buildAppErrorResponse(error: AppError): ErrorResponse {
  const response: ErrorResponse = {
    error: error.message,
    code: error.code,
  };

  if (error instanceof ValidationError) {
    if (error.field) {
      response.field = error.field;
    }
    if (error.suggestion) {
      response.suggestion = error.suggestion;
    }
  }

  if (error instanceof RelayError) {
    response.details = {
      relay: error.relay,
      reason: error.reason,
    };
  }

  if (error instanceof TimeoutError && error.timeoutMs) {
    response.details = {
      timeoutMs: error.timeoutMs,
    };
  }

  if (error.details) {
    response.details = { ...response.details, ...error.details };
  }

  return response;
}

export function mapErrorToResponse(error: unknown): {
  response: ErrorResponse;
  status: number;
} {
  if (error instanceof AppError) {
    return {
      response: buildAppErrorResponse(error),
      status: error.httpStatus,
    };
  }

  if (error instanceof Error) {
    return {
      response: {
        error: error.message,
        code: 'INTERNAL_ERROR',
      },
      status: 500,
    };
  }

  return {
    response: {
      error: String(error),
      code: 'UNKNOWN_ERROR',
    },
    status: 500,
  };
}

/**
 * Creates standard response headers including request ID and response time
 * @param correlationId Request correlation ID
 * @param startTime Request start time in milliseconds
 * @param additionalHeaders Optional additional headers to include
 * @returns Headers object with standard headers
 */
export function createResponseHeaders(
  correlationId?: string,
  startTime?: number,
  additionalHeaders?: Record<string, string>
): Headers {
  const headers = new Headers(additionalHeaders);

  if (correlationId) {
    headers.set('X-Request-ID', correlationId);
  }

  if (startTime !== undefined) {
    const responseTime = Date.now() - startTime;
    headers.set('X-Response-Time', `${responseTime}ms`);
  }

  return headers;
}
