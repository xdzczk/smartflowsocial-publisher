import type { Env } from '../types';

/**
 * CORS configuration
 */
interface CorsConfig {
  enabled: boolean;
  allowedOrigins: Set<string>;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

/**
 * Parses CORS configuration from environment variables
 * @param env Environment variables
 * @returns CORS configuration
 */
function parseCorsConfig(env: Env): CorsConfig {
  const enabled = env.CORS_ENABLED === 'true';
  const allowedOrigins = new Set<string>();

  if (enabled && env.CORS_ORIGINS) {
    // Parse comma-separated origins
    const origins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
    for (const origin of origins) {
      allowedOrigins.add(origin);
    }
  }

  return {
    enabled,
    allowedOrigins,
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'API-TOKEN', 'X-Correlation-ID', 'X-Request-ID'],
    maxAge: 86400, // 24 hours
  };
}

/**
 * Checks if an origin is allowed
 * @param origin Request origin header
 * @param config CORS configuration
 * @returns True if origin is allowed
 */
function isOriginAllowed(origin: string | null, config: CorsConfig): boolean {
  if (!config.enabled || config.allowedOrigins.size === 0) {
    return false;
  }

  if (!origin) {
    return false;
  }

  return config.allowedOrigins.has(origin);
}

/**
 * Handles CORS preflight (OPTIONS) request
 * @param request The HTTP request
 * @param config CORS configuration
 * @returns Response for preflight request, or null if not a preflight
 */
export function handleCorsPreflight(request: Request, config: CorsConfig): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  const origin = request.headers.get('Origin');
  if (!isOriginAllowed(origin, config)) {
    return new Response(null, { status: 403 });
  }

  const requestHeaders = request.headers.get('Access-Control-Request-Headers');

  const corsHeaders = new Headers();
  corsHeaders.set('Access-Control-Allow-Origin', origin ?? '');
  corsHeaders.set('Access-Control-Allow-Methods', config.allowedMethods.join(', '));
  corsHeaders.set('Access-Control-Allow-Headers', requestHeaders ?? config.allowedHeaders.join(', '));
  corsHeaders.set('Access-Control-Max-Age', String(config.maxAge));

  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Adds CORS headers to a response
 * @param request The HTTP request
 * @param response The response to add headers to
 * @param config CORS configuration
 * @returns Response with CORS headers added
 */
export function addCorsHeaders(
  request: Request,
  response: Response,
  config: CorsConfig
): Response {
  if (!config.enabled) {
    return response;
  }

  const origin = request.headers.get('Origin');
  if (!isOriginAllowed(origin, config)) {
    return response;
  }

  // Clone response to add headers
  const corsResponseHeaders = new Headers(response.headers);
  corsResponseHeaders.set('Access-Control-Allow-Origin', origin ?? '');
  corsResponseHeaders.set('Access-Control-Allow-Credentials', 'true');
  corsResponseHeaders.set('Access-Control-Expose-Headers', 'X-Request-ID, X-Response-Time');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: corsResponseHeaders,
  });
}

/**
 * Gets CORS configuration from environment
 * @param env Environment variables
 * @returns CORS configuration
 */
export function getCorsConfig(env: Env): CorsConfig {
  return parseCorsConfig(env);
}
