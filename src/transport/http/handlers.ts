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
  createResponseHeaders,
  mapErrorToResponse,
  mapPublishOutcomeToResponse,
  parsePublishRequest,
} from './mappers';

const HOUR = 60 * 60;
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB
const MAX_BATCH_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB for batch requests
const MAX_BATCH_EVENTS = 200; // Maximum events per batch request
const INVALID_JSON_MSG = 'Invalid JSON in request body';
const REQUEST_TOO_LARGE_MSG = 'Request body too large:';
const ENDPOINT_PUBLISH = 'publish';
const STATUS_200 = '200';
const STATUS_500 = '500';
const CONTENT_TYPE_JSON = 'application/json';
const HTTP_STATUS_OK = 200;
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
  env: Env,
  _ctx: ExecutionContext,
  correlationId?: string
): Promise<Response> {
  // Parameters kept for API compatibility
  void _ctx;
  const startTime = Date.now();
  const logger = new ConsoleLogger();
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  const metrics = await createMetrics(logger, env);

  try {
    metrics.increment(METRIC_HTTP_REQUESTS, METRIC_INCREMENT_VALUE, { endpoint: ENDPOINT_PUBLISH });
    
    // Validate request size and read body
    const sizeCheck = await validateAndReadRequestBody(request, MAX_REQUEST_SIZE);
    if (!sizeCheck.success) {
      const headers = createResponseHeaders(correlationId, startTime, {
        'Content-Type': CONTENT_TYPE_JSON,
      });
      return new Response(sizeCheck.response.body, {
        status: sizeCheck.response.status,
        headers,
      });
    }

    // Parse request body from validated text
    let body: unknown;
    try {
      body = JSON.parse(sizeCheck.bodyText);
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

    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers,
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
    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers,
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
 * Validates request size by reading body as text
 * This is more reliable than Content-Length header which can be spoofed
 * @param request The HTTP request
 * @param maxSize Maximum allowed size in bytes
 * @returns Object with body text if valid, or error response
 */
async function validateAndReadRequestBody(
  request: Request,
  maxSize: number
): Promise<
  | { success: true; bodyText: string }
  | { success: false; response: Response }
> {
  // Clone request to read body without consuming original
  const clonedRequest = request.clone();
  const bodyText = await clonedRequest.text();
  const size = new TextEncoder().encode(bodyText).length;

  if (size > maxSize) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: `${REQUEST_TOO_LARGE_MSG} ${size} bytes (max: ${maxSize} bytes)`,
          code: 'VALIDATION_ERROR',
          field: 'body',
        }),
        {
          status: 400,
          headers: { 'Content-Type': CONTENT_TYPE_JSON },
        }
      ),
    };
  }

  return { success: true, bodyText };
}

/**
 * Validates and normalizes profile request
 * Extracted to reduce cognitive complexity
 */
async function validateAndNormalizeProfileRequest(
  body: unknown,
  correlationId: string | undefined,
  startTime: number
): Promise<
  | { success: true; relayUrls: string[]; normalizedPubkey: string }
  | { success: false; response: Response }
> {
  // Validate profile request using Valibot
  let validatedRequest: { relays: string[]; pubkey: string };
  try {
    validatedRequest = validateProfileRequest(body);
  } catch (error) {
    const { response, status } = mapErrorToResponse(
      error instanceof ValidationError
        ? error
        : new ValidationError('Invalid request', 'body')
    );
    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });
    return {
      success: false,
      response: new Response(JSON.stringify(response), { status, headers }),
    };
  }

  const relayUrls = normalizeRelayUrls(validatedRequest.relays);
  const pubkey = validatedRequest.pubkey;

  if (relayUrls.length === 0 || !pubkey) {
    const { response, status } = mapErrorToResponse(
      new ValidationError('No valid relays or missing pubkey', 'body')
    );
    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });
    return {
      success: false,
      response: new Response(JSON.stringify(response), { status, headers }),
    };
  }

  // Normalize pubkey (handle bech32)
  const { normalizeToHex } = await import('../../utils');
  const normalizedPubkey = normalizeToHex(pubkey);

  if (!normalizedPubkey) {
    const { response, status } = mapErrorToResponse(
      new ValidationError('Invalid pubkey format', 'pubkey')
    );
    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });
    return {
      success: false,
      response: new Response(JSON.stringify(response), { status, headers }),
    };
  }

  return { success: true, relayUrls, normalizedPubkey };
}


export async function profileHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  correlationId?: string
): Promise<Response> {
  const startTime = Date.now();
  const logger = new ConsoleLogger();
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  const metrics = await createMetrics(logger, env);

  try {
    metrics.increment('http.requests', 1, { endpoint: 'profile' });
    
    // Validate request size and read body
    const sizeCheck = await validateAndReadRequestBody(request, MAX_REQUEST_SIZE);
    if (!sizeCheck.success) {
      const headers = createResponseHeaders(correlationId, startTime, {
        'Content-Type': CONTENT_TYPE_JSON,
      });
      return new Response(sizeCheck.response.body, {
        status: sizeCheck.response.status,
        headers,
      });
    }

    // Parse request body from validated text
    let body: unknown;
    try {
      body = JSON.parse(sizeCheck.bodyText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const { response, status } = mapErrorToResponse(
          new ValidationError(INVALID_JSON_MSG, 'body', {
            originalError: error instanceof Error ? error.message : String(error),
          })
        );
        const headers = createResponseHeaders(correlationId, startTime, {
          'Content-Type': CONTENT_TYPE_JSON,
        });
        return new Response(JSON.stringify(response), {
          status,
          headers,
        });
      }
      throw error;
    }

    // Validate and normalize profile request
    const validationResult = await validateAndNormalizeProfileRequest(body, correlationId, startTime);
    if (!validationResult.success) {
      return validationResult.response;
    }

    const { relayUrls, normalizedPubkey } = validationResult;

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
      const headers = createResponseHeaders(correlationId, startTime, {
        'content-type': 'application/json;charset=UTF-8',
      });
      return new Response(value, {
        status: HTTP_STATUS_OK,
        headers,
      });
    }

    // Not in cache - fetch asynchronously
    ctx.waitUntil(refreshProfileCache(normalizedPubkey, relayUrls, env, logger));

    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: 'profile', status: '202', cached: 'false' });
    const headers = createResponseHeaders(correlationId, startTime, {
      'content-type': 'application/json;charset=UTF-8',
    });
    return new Response(null, {
      status: 202,
      headers,
    });
  } catch (error) {
    logger.error('Error in profileHandler:', error);
    const { response, status } = mapErrorToResponse(error);
    if (correlationId) {
      response.details = { ...response.details, correlationId };
    }
    metrics.increment(METRIC_HTTP_RESPONSES, METRIC_INCREMENT_VALUE, { endpoint: 'profile', status: STATUS_500 });
    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers,
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

  const events = (body as { events: unknown[] }).events;
  if (events.length > MAX_BATCH_EVENTS) {
    throw new ValidationError(
      `Maximum ${MAX_BATCH_EVENTS} events per batch request, received ${events.length}`,
      'events'
    );
  }

  if (events.length === 0) {
    throw new ValidationError('Batch request must contain at least one event', 'events');
  }

  return body as { events: unknown[]; relays: string[] };
}

/**
 * Validates all events in batch
 * Note: Batch size limit is checked in validateBatchRequest
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
  env: Env,
  _ctx: ExecutionContext,
  correlationId?: string
): Promise<Response> {
  void _ctx;
  const startTime = Date.now();
  const logger = new ConsoleLogger();
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  const metrics = await createMetrics(logger, env);

  try {
    metrics.increment(METRIC_HTTP_REQUESTS, METRIC_INCREMENT_VALUE, { endpoint: 'batch' });

    // Validate request size and read body (10MB limit for batch)
    const sizeCheck = await validateAndReadRequestBody(request, MAX_BATCH_REQUEST_SIZE);
    if (!sizeCheck.success) {
      const headers = createResponseHeaders(correlationId, startTime, {
        'Content-Type': CONTENT_TYPE_JSON,
      });
      return new Response(sizeCheck.response.body, {
        status: sizeCheck.response.status,
        headers,
      });
    }

    // Parse request body from validated text
    let body: unknown;
    try {
      body = JSON.parse(sizeCheck.bodyText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ValidationError(
          INVALID_JSON_MSG,
          'body',
          { originalError: error instanceof Error ? error.message : String(error) }
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

    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });

    return new Response(JSON.stringify(batchResult), {
      status: 200,
      headers,
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
    const headers = createResponseHeaders(correlationId, startTime, {
      'Content-Type': CONTENT_TYPE_JSON,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers,
    });
  }
}
