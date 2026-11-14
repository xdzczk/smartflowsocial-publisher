import type { ExecutionContext, ExportedHandler } from '@cloudflare/workers-types';

import { validateEnvironment } from './config/env';
import { addCorsHeaders, getCorsConfig, handleCorsPreflight } from './middleware/cors';
import { RateLimiter } from './middleware/rateLimiter';
import { ConsoleLogger } from './observability/logger';
import { authorizePublisherRequest } from './security/access';
import { batchPublishHandler, profileHandler, publishHandler } from './transport/http/handlers';
import type { Env } from './types';

/**
 * Extracts correlation ID from request headers or generates a new one
 * @param request The incoming request
 * @returns Correlation ID string
 */
function extractCorrelationId(request: Request): string {
  // Check for correlation ID in headers (common patterns)
  const headerId =
    request.headers.get('X-Correlation-ID') ??
    request.headers.get('X-Request-ID') ??
    request.headers.get('Correlation-ID') ??
    request.headers.get('Request-ID') ??
    null;

  if (headerId) {
    return headerId;
  }

  // Generate a simple correlation ID if not provided
  // In production, you might want to use a UUID library
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Handles rate limiting check
 */
function checkRateLimit(
  pathname: string,
  request: Request,
  env: Env,
  logger: ConsoleLogger
): Response | null {
  if (pathname === '/health') {
    return null;
  }

  const rateLimitRequests = parseInt(env.RATE_LIMIT_REQUESTS ?? '100', 10);
  const rateLimitWindowMs = parseInt(env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
  const rateLimiter = new RateLimiter(rateLimitRequests, rateLimitWindowMs, logger);

  // Extract client identifier (IP address or API token)
  const apiToken = request.headers.get('API-TOKEN');
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const identifier = apiToken ?? clientIp;

  const rateLimitResult = rateLimiter.check(identifier);
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: rateLimitResult.retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimitResult.retryAfter ?? 60),
        },
      }
    );
  }

  return null;
}

/**
 * Handles health check endpoint
 */
async function handleHealthCheck(logger: ConsoleLogger, correlationId?: string): Promise<Response> {
  const { HealthCheckManager } = await import('./core/healthCheck');
  const healthManager = new HealthCheckManager(logger);
  const allHealth = healthManager.getAllHealth();

  const healthResponseHeaders = new Headers({ 'Content-Type': 'application/json' });
  if (correlationId) {
    healthResponseHeaders.set('X-Request-ID', correlationId);
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      relays: allHealth.map((h) => ({
        relay: h.relayUrl,
        healthy: h.healthy,
        lastChecked: h.lastChecked,
        consecutiveFailures: h.consecutiveFailures,
      })),
    }),
    {
      status: 200,
      headers: healthResponseHeaders,
    }
  );
}

/**
 * Routes request to appropriate handler
 */
/**
 * Creates error response with standard headers
 */
async function createErrorResponse(
  error: unknown,
  correlationId: string,
  startTime: number
): Promise<Response> {
  const { createResponseHeaders, mapErrorToResponse } = await import('./transport/http/mappers');
  const { response, status } = mapErrorToResponse(error);
  const headers = createResponseHeaders(correlationId, startTime, {
    'Content-Type': 'application/json',
  });
  return new Response(JSON.stringify(response), { status, headers });
}

async function routeRequest(
  pathname: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  correlationId: string,
  logger: ConsoleLogger
): Promise<Response> {
  const startTime = Date.now();

  if (pathname === '/' || pathname === '/publish') {
    try {
      return await publishHandler(request, env, ctx, correlationId);
    } catch (e) {
      logger.error('Error in publishHandler:', e);
      return await createErrorResponse(e, correlationId, startTime);
    }
  }

  if (pathname === '/profile') {
    try {
      return await profileHandler(request, env, ctx, correlationId);
    } catch (e) {
      logger.error('Error in profileHandler:', e);
      return await createErrorResponse(e, correlationId, startTime);
    }
  }

  if (pathname === '/batch') {
    try {
      return await batchPublishHandler(request, env, ctx, correlationId);
    } catch (e) {
      logger.error('Error in batchPublishHandler:', e);
      return await createErrorResponse(e, correlationId, startTime);
    }
  }

  const { createResponseHeaders } = await import('./transport/http/mappers');
  const headers = createResponseHeaders(correlationId, startTime);
  return new Response('Endpoint does not exist', { status: 404, headers });
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const logger = new ConsoleLogger();
    const correlationId = extractCorrelationId(request);
    logger.setCorrelationId(correlationId);

    // Validate environment on first request (lazy initialization)
    // In production, this would be done at worker startup, but Workers don't have a startup hook
    try {
      validateEnvironment(env, logger);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Environment validation failed: ${errorMessage}`, { error });
      return new Response(
        JSON.stringify({
          error: 'Server configuration error',
          code: 'CONFIGURATION_ERROR',
          details: { message: errorMessage },
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const pathname = new URL(request.url).pathname;
    const corsConfig = getCorsConfig(env);

    // Handle CORS preflight
    const corsPreflight = handleCorsPreflight(request, corsConfig);
    if (corsPreflight) {
      return corsPreflight;
    }

    // Rate limiting
    const rateLimitResponse = checkRateLimit(pathname, request, env, logger);
    if (rateLimitResponse) {
      return addCorsHeaders(request, rateLimitResponse, corsConfig);
    }

    const authResponse = authorizePublisherRequest(request, env, pathname);
    if (authResponse) {
      return addCorsHeaders(request, authResponse, corsConfig);
    }

    // Health check endpoint (GET /health)
    if (pathname === '/health' && request.method === 'GET') {
      const healthResponse = await handleHealthCheck(logger, correlationId);
      return addCorsHeaders(request, healthResponse, corsConfig);
    }

    // Only POST allowed for other endpoints
    if (request.method !== 'POST') {
      const notFoundResponse = new Response('Sooner and later you will see great changes made.', {
        status: 404,
      });
      return addCorsHeaders(request, notFoundResponse, corsConfig);
    }

    // Route to handlers
    const response = await routeRequest(pathname, request, env, ctx, correlationId, logger);
    return addCorsHeaders(request, response, corsConfig);
  },
};

export default handler;
