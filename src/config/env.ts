import type { Env } from '../types';

/**
 * Validates a numeric environment variable
 */
function validateNumericEnv(
  value: string | undefined,
  name: string,
  defaultValue: string,
  logger: { warn: (_warning: string) => void }
): void {
  if (!value) {
    return;
  }
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    logger.warn(`Invalid ${name} value: ${value}. Using default: ${defaultValue}`);
  }
}

/**
 * Validates environment variables and configuration
 * @param env Environment variables from Cloudflare Workers
 * @param logger Logger instance for warnings
 * @throws {Error} if required configuration is missing
 */
export function validateEnvironment(env: Env, logger: { warn: (_warning: string) => void }): void {
  // Validate required: PROFILES KV namespace
  // In Cloudflare Workers, KVNamespace is always defined, but we check for type safety
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime safety check
  if (!env.PROFILES) {
    throw new Error(
      'Missing required environment variable: PROFILES KV namespace is not configured. ' +
        'Run: wrangler kv:namespace create PROFILES'
    );
  }

  // Private by default. Public mode must be explicit.
  const token = env.API_TOKEN?.trim() ?? '';
  const allowPublic = env.ALLOW_UNAUTHENTICATED_PUBLISH === 'true';
  if (!token && !allowPublic) {
    if (env.ENVIRONMENT === 'production') {
      throw new Error(
        'API_TOKEN is required in production unless public publishing is explicitly enabled'
      );
    }
    logger.warn(
      'API_TOKEN is not set. Publish routes fail closed until a token is set or public publishing is explicitly enabled.'
    );
  }

  // Validate optional: Rate limiting
  validateNumericEnv(env.RATE_LIMIT_REQUESTS, 'RATE_LIMIT_REQUESTS', '100', logger);
  validateNumericEnv(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', '60000', logger);

  // Validate optional: CORS
  if (env.CORS_ENABLED === 'true' && !env.CORS_ORIGINS) {
    logger.warn('CORS_ENABLED is true but CORS_ORIGINS is not set. CORS will be disabled.');
  }

  // Validate optional: Metrics export
  if (env.METRICS_EXPORT_ENABLED === 'true') {
    validateNumericEnv(
      env.METRICS_EXPORT_INTERVAL_MS,
      'METRICS_EXPORT_INTERVAL_MS',
      '60000',
      logger
    );
  }
}
