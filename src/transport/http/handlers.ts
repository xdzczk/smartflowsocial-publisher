import type { ExecutionContext, Request } from '@cloudflare/workers-types';

import { NostrRelayAdapter } from '../../adapters/nostr/relayAdapter';
import { publishBatch } from '../../core/BatchPublisher';
import { ValidationError } from '../../core/errors';
import { fetchProfile } from '../../core/ProfileEngine';
import { publishSignedEvent } from '../../core/PublishEngine';
import { normalizeRelayUrls } from '../../core/RelayUrl';
import type { SignedEvent } from '../../core/types';
import type { Logger } from '../../observability/logger';
import { ConsoleLogger } from '../../observability/logger';
import { createMetrics } from '../../observability/metrics';
import { aggressivePolicy } from '../../policies/aggressivePolicy';
import { conservativePolicy } from '../../policies/conservativePolicy';
import { defaultPolicy } from '../../policies/defaultPolicy';
import { defaultProfilePolicy } from '../../policies/ProfilePolicy';
import type { Env } from '../../types';
import { validateProfileRequest } from '../../validation/schemas';

import {
  mapErrorToResponse,
  mapPublishOutcomeToResponse,
  parsePublishRequest,
} from './mappers';

const HOUR = 60 * 60;
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB
const INVALID_JSON_MSG = 'Invalid JSON in request body';
const REQUEST_TOO_LARGE_MSG = 'Request body too large:';
const ENDPOINT_PUBLISH = 'publish';
const STATUS_200 = '200';
const STATUS_500 = '500';
const CONTENT_TYPE_JSON = 'application/json';
const HEADER_CONTENT_LENGTH = 'Content-Length';
const HTTP_STATUS_OK = 200;
const PARSE_INT_RADIX = 10;
const METRIC_HTTP_REQUESTS = 'http.requests';
const METRIC_HTTP_RESPONSES = 'http.responses';
const METRIC_INCREMENT_VALUE = 1;

/**
 * Refreshes profile cache in the background
 * @param normalizedPubkey The normalized pubkey
 * @param relayUrls Array of relay URLs to fetch from
 * @param env Environment with KV namespace
 * @param logger Logger instance
 */
async function refreshProfileCache(
  normalizedPubkey: string,
  relayUrls: string[],
  env: Env,
  logger: Logger
): Promise<void> {
  try {
    const relays = relayUrls.map((url) => new NostrRelayAdapter(url));
    const result = await fetchProfile(
      normalizedPubkey,
      relays,
      defaultProfilePolicy,
      logger
    );
    if (result.event) {
      await env.PROFILES.put(normalizedPubkey, JSON.stringify(result.event), {
        metadata: { createdAt: Date.now() },
        expirationTtl: 7 * 24 * HOUR,
      });
    }
  } catch (e) {
    logger.error(`Failed to refresh profile for ${normalizedPubkey}:`, e);
  }
}

/**
 * Selects a publish policy based on query parameter
 */
function selectPolicy(queryParams: URLSearchParams) {
  const policyName = queryParams.get('policy');
  switch (policyName) {
    case 'conservative':
      return conservativePolicy;
    case 'aggressive':
      return aggressivePolicy;
    default:
      return defaultPolicy;
  }
}

/**
 * HTTP handler for publishing events
 * @param request The HTTP request
 * @param _env Environment variables (unused)
 * @param _ctx Execution context (unused)
 * @param correlationId Correlation ID for request tracking
 * @returns HTTP response with publish results
 */
export async function publishHandler(
  request: Request,
  _env: Env,
  _ctx: ExecutionContext,
  correlationId?: string
): Promise<Response> {
  // Parameters kept for API compatibility
  void _env;
  void _ctx;
  const logger = new ConsoleLogger();
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  const metrics = createMetrics(logger);

  try {
    metrics.increment(METRIC_HTTP_REQUESTS, METRIC_INCREMENT_VALUE, { endpoint: ENDPOINT_PUBLISH });
    // Check request size
    const contentLength = request.headers.get(HEADER_CONTENT_LENGTH);
    if (contentLength) {
      const size = parseInt(contentLength, PARSE_INT_RADIX);
      if (size > MAX_REQUEST_SIZE) {
        throw new ValidationError(
          `${REQUEST_TOO_LARGE_MSG} ${size} bytes (max: ${MAX_REQUEST_SIZE} bytes)`,
          'body'
        );
      }
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ValidationError(
          INVALID_JSON_MSG,
          'body',
          { originalError: error.message }
        );
      }
      throw error;
    }

    const { event, relayUrls } = parsePublishRequest(body);

    // Select policy from query params
    const url = new URL(request.url);
    const policy = selectPolicy(url.searchParams);

    // Create relay adapters
    const relays = relayUrls.map((url) => new NostrRelayAdapter(url));

    // Publish using core engine
    // event is already validated as SignedEvent by parsePublishRequest
    const outcome = await publishSignedEvent(
      event,
      relays,
      policy,
      logger,
      metrics
    );

    // Map outcome to HTTP response
    const response = mapPublishOutcomeToResponse(outcome);

    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: ENDPOINT_PUBLISH, status: STATUS_200 });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': CONTENT_TYPE_JSON },
    });
  } catch (error) {
    logger.error('Error in publishHandler:', error);
    const { response, status } = mapErrorToResponse(error);
    // Add correlation ID to error response for traceability
    if (correlationId) {
      response.details = { ...response.details, correlationId };
    }
    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, {
      endpoint: ENDPOINT_PUBLISH,
      status: String(status),
      error: response.code ?? 'unknown',
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': CONTENT_TYPE_JSON },
    });
  }
}

/**
 * HTTP handler for fetching profiles
 * @param request The HTTP request
 * @param env Environment variables (for KV access)
 * @param ctx Execution context (for waitUntil)
 * @param correlationId Correlation ID for request tracking
 * @returns HTTP response with profile data or 202 Accepted
 */
/**
 * Validates request size
 * @param request The HTTP request
 * @returns Error response if too large, null otherwise
 */
function validateRequestSize(request: Request): Response | null {
  const contentLength = request.headers.get('Content-Length');
  if (!contentLength) {
    return null;
  }

  const size = parseInt(contentLength, 10);
  if (size > MAX_REQUEST_SIZE) {
      return new Response(
        JSON.stringify({
          error: `${REQUEST_TOO_LARGE_MSG} ${size} bytes (max: ${MAX_REQUEST_SIZE} bytes)`,
          code: 'VALIDATION_ERROR',
          field: 'body',
        }),
      {
        status: 400,
        headers: { 'Content-Type': CONTENT_TYPE_JSON },
      }
    );
  }

  return null;
}

/**
 * Parses request body with error handling
 * @param request The HTTP request
 * @returns Parsed body or error response
 */
async function parseRequestBody(request: Request): Promise<
  | { success: true; body: unknown }
  | { success: false; response: Response }
> {
  try {
    const body = await request.json();
    return { success: true, body };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        response: new Response(
          JSON.stringify({
            error: INVALID_JSON_MSG,
            code: 'VALIDATION_ERROR',
            field: 'body',
            details: { originalError: error.message },
          }),
          {
            status: 400,
            headers: { 'Content-Type': CONTENT_TYPE_JSON },
          }
        ),
      };
    }
    throw error;
  }
}

export async function profileHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  correlationId?: string
): Promise<Response> {
  const logger = new ConsoleLogger();
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  const metrics = createMetrics(logger);

  try {
    metrics.increment('http.requests', 1, { endpoint: 'profile' });
    // Check request size
    const sizeError = validateRequestSize(request);
    if (sizeError) {
      return sizeError;
    }

    // Parse request body
    const parseResult = await parseRequestBody(request);
    if (!parseResult.success) {
      return parseResult.response;
    }

    const body = parseResult.body;

    // Validate profile request using Valibot
    let validatedRequest: { relays: string[]; pubkey: string };
    try {
      validatedRequest = validateProfileRequest(body);
    } catch (error) {
      if (error instanceof ValidationError) {
        const { response, status } = mapErrorToResponse(error);
        return new Response(JSON.stringify(response), {
          status,
          headers: { 'Content-Type': CONTENT_TYPE_JSON },
        });
      }
      return new Response(JSON.stringify({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
      }), {
        status: 400,
        headers: { 'Content-Type': CONTENT_TYPE_JSON },
      });
    }

    const relayUrls = normalizeRelayUrls(validatedRequest.relays);
    const pubkey = validatedRequest.pubkey;

    if (relayUrls.length === 0 || !pubkey) {
      return new Response(JSON.stringify({
        error: 'No valid relays or missing pubkey',
        code: 'VALIDATION_ERROR',
      }), {
        status: 400,
        headers: { 'Content-Type': CONTENT_TYPE_JSON },
      });
    }

    // Normalize pubkey (handle bech32)
    // Import normalizeToHex from utils (will be moved later)
    const { normalizeToHex } = await import('../../utils');
    const normalizedPubkey = normalizeToHex(pubkey);

    if (!normalizedPubkey) {
      return new Response(JSON.stringify({
        error: 'Invalid pubkey format',
        code: 'VALIDATION_ERROR',
      }), {
        status: 400,
        headers: { 'Content-Type': CONTENT_TYPE_JSON },
      });
    }

    // Cache functions
    const getCache = async (key: string): Promise<{
      value: string | null;
      metadata: { createdAt: number } | null;
    }> => {
      return await env.PROFILES.getWithMetadata(key);
    };

    // Check cache first
    const cacheResult = await getCache(normalizedPubkey);
    if (cacheResult.value) {
      const { value, metadata } = cacheResult;

      // Refresh in background if stale (older than 3 hours)
      if (!metadata || metadata.createdAt + 3 * HOUR * 1000 < Date.now()) {
        ctx.waitUntil(refreshProfileCache(normalizedPubkey, relayUrls, env, logger));
      }

      metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: 'profile', status: STATUS_200, cached: 'true' });
      return new Response(value, {
        status: HTTP_STATUS_OK,
        headers: {
          'content-type': 'application/json;charset=UTF-8',
        },
      });
    }

    // Not in cache - fetch asynchronously
    ctx.waitUntil(refreshProfileCache(normalizedPubkey, relayUrls, env, logger));

    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: 'profile', status: '202', cached: 'false' });
    return new Response(null, {
      status: 202,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    });
  } catch (error) {
    logger.error('Error in profileHandler:', error);
    const errorResponse: { error: string; correlationId?: string } = {
      error: 'Internal Server Error',
    };
    if (correlationId) {
      errorResponse.correlationId = correlationId;
    }
    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: 'profile', status: STATUS_500 });
    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { 'Content-Type': CONTENT_TYPE_JSON },
    });
  }
}

/**
 * Validates batch request structure
 */
function validateBatchRequest(body: unknown): { events: unknown[]; relays: string[] } {
  if (
    !body ||
    typeof body !== 'object' ||
    !('events' in body) ||
    !Array.isArray((body as { events: unknown }).events) ||
    !('relays' in body) ||
    !Array.isArray((body as { relays: unknown }).relays)
  ) {
    throw new ValidationError(
      'Invalid batch request: events and relays must be arrays',
      'body'
    );
  }
  return body as { events: unknown[]; relays: string[] };
}

/**
 * Validates all events in batch
 */
async function validateBatchEvents(events: unknown[]): Promise<SignedEvent[]> {
  const { validateSignedEventSchema } = await import('../../validation/schemas');
  const { validateSignedEvent } = await import('../../core/EventValidator');

  const signedEvents: SignedEvent[] = [];
  for (const event of events) {
    try {
      const validated = validateSignedEventSchema(event);
      signedEvents.push(validateSignedEvent(validated));
    } catch (error) {
      throw new ValidationError(
        `Invalid event in batch: ${error instanceof Error ? error.message : String(error)}`,
        'events'
      );
    }
  }

  if (signedEvents.length === 0) {
    throw new ValidationError('Batch request must contain at least one event', 'events');
  }

  return signedEvents;
}

/**
 * HTTP handler for batch publishing events
 * @param request The HTTP request
 * @param _env Environment variables (unused)
 * @param _ctx Execution context (unused)
 * @param correlationId Correlation ID for request tracking
 * @returns HTTP response with batch publish results
 */
export async function batchPublishHandler(
  request: Request,
  _env: Env,
  _ctx: ExecutionContext,
  correlationId?: string
): Promise<Response> {
  void _env;
  void _ctx;
  const logger = new ConsoleLogger();
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  const metrics = createMetrics(logger);

  try {
    metrics.increment(METRIC_HTTP_REQUESTS, METRIC_INCREMENT_VALUE, { endpoint: 'batch' });

    // Check request size
    const contentLength = request.headers.get(HEADER_CONTENT_LENGTH);
    if (contentLength) {
      const size = parseInt(contentLength, PARSE_INT_RADIX);
      if (size > MAX_REQUEST_SIZE * 10) {
        // Allow 10x size for batch requests
        throw new ValidationError(
          `${REQUEST_TOO_LARGE_MSG} ${size} bytes (max: ${MAX_REQUEST_SIZE * 10} bytes)`,
          'body'
        );
      }
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ValidationError(
          INVALID_JSON_MSG,
          'body',
          { originalError: error.message }
        );
      }
      throw error;
    }

    // Validate batch request structure
    const batchRequest = validateBatchRequest(body);

    // Validate all events
    const signedEvents = await validateBatchEvents(batchRequest.events);

    // Normalize relays
    const relayUrls = normalizeRelayUrls(batchRequest.relays);
    if (relayUrls.length === 0) {
      throw new ValidationError('No valid relays after normalization', 'relays');
    }

    // Select policy
    const url = new URL(request.url);
    const policy = selectPolicy(url.searchParams);

    // Create relay adapters
    const relays = relayUrls.map((url) => new NostrRelayAdapter(url));

    // Publish batch
    const batchResult = await publishBatch(signedEvents, relays, policy, logger, metrics);

    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: 'batch', status: STATUS_200 });

    return new Response(JSON.stringify(batchResult), {
      status: 200,
      headers: { 'Content-Type': CONTENT_TYPE_JSON },
    });
  } catch (error) {
    logger.error('Error in batchPublishHandler:', error);
    const { response, status } = mapErrorToResponse(error);
    if (correlationId) {
      response.details = { ...response.details, correlationId };
    }
    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, {
      endpoint: 'batch',
      status: String(status),
      error: response.code ?? 'unknown',
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': CONTENT_TYPE_JSON },
    });
  }
}
