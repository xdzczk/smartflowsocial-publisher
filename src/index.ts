import type { ExecutionContext, ExportedHandler } from '@cloudflare/workers-types';

import { RateLimiter } from './middleware/rateLimiter';
import { ConsoleLogger } from './observability/logger';
import {
  batchPublishHandler,
  profileHandler,
  publishHandler,
} from './transport/http/handlers';
import type { Env } from './types';

const INTERNAL_SERVER_ERROR_MSG = 'Internal Server Error';

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
async function handleHealthCheck(logger: ConsoleLogger): Promise<Response> {
  const { HealthCheckManager } = await import('./core/healthCheck');
  const healthManager = new HealthCheckManager(logger);
  const allHealth = healthManager.getAllHealth();

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
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Routes request to appropriate handler
 */
async function routeRequest(
  pathname: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  correlationId: string,
  logger: ConsoleLogger
): Promise<Response> {
  if (pathname === '/' || pathname === '/publish') {
    try {
      return await publishHandler(request, env, ctx, correlationId);
    } catch (e) {
      logger.error('Error in publishHandler:', e);
      return new Response(INTERNAL_SERVER_ERROR_MSG, { status: 500 });
    }
  }

  if (pathname === '/profile') {
    try {
      return await profileHandler(request, env, ctx, correlationId);
    } catch (e) {
      logger.error('Error in profileHandler:', e);
      return new Response(INTERNAL_SERVER_ERROR_MSG, { status: 500 });
    }
  }

  if (pathname === '/batch') {
    try {
      return await batchPublishHandler(request, env, ctx, correlationId);
    } catch (e) {
      logger.error('Error in batchPublishHandler:', e);
      return new Response(INTERNAL_SERVER_ERROR_MSG, { status: 500 });
    }
  }

  return new Response('Endpoint does not exist', { status: 404 });
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const logger = new ConsoleLogger();
    const correlationId = extractCorrelationId(request);
    logger.setCorrelationId(correlationId);

    const pathname = new URL(request.url).pathname;

    // Rate limiting
    const rateLimitResponse = checkRateLimit(pathname, request, env, logger);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Auth check
    const apiToken = request.headers.get('API-TOKEN');
    if (apiToken !== env.API_TOKEN && env.API_TOKEN) {
      return new Response('INVALID_TOKEN', { status: 403 });
    }

    // Health check endpoint (GET /health)
    if (pathname === '/health' && request.method === 'GET') {
      return await handleHealthCheck(logger);
    }

    // Only POST allowed for other endpoints
    if (request.method !== 'POST') {
      return new Response('Sooner and later you will see great changes made.', { status: 404 });
    }

    // Route to handlers
    return await routeRequest(pathname, request, env, ctx, correlationId, logger);
  },
};

export default handler;
