import { describe, expect, it } from 'vitest';

import { validateEnvironment } from '../../src/config/env';
import { authorizePublisherRequest } from '../../src/security/access';
import type { Env } from '../../src/types';

const TEST_TOKEN = 'secret-token-123';
const PUBLISH_URL = 'http://localhost/publish';

function env(overrides: Partial<Env> = {}): Env {
  return {
    PROFILES: {} as unknown as Env['PROFILES'],
    ...overrides,
  };
}

describe('publisher access control', () => {
  it('rejects publish requests when API_TOKEN is missing', () => {
    const response = authorizePublisherRequest(
      new Request(PUBLISH_URL, { method: 'POST' }),
      env(),
      '/publish'
    );
    expect(response?.status).toBe(403);
  });

  it('allows publish requests only when public mode is explicit', () => {
    const denied = authorizePublisherRequest(
      new Request(PUBLISH_URL, { method: 'POST' }),
      env(),
      '/publish'
    );
    const allowed = authorizePublisherRequest(
      new Request(PUBLISH_URL, { method: 'POST' }),
      env({ ALLOW_UNAUTHENTICATED_PUBLISH: 'true' }),
      '/publish'
    );
    expect(denied?.status).toBe(403);
    expect(allowed).toBeNull();
  });

  it('rejects a missing or wrong token when API_TOKEN is set', () => {
    const configured = env({ API_TOKEN: TEST_TOKEN });
    const missing = authorizePublisherRequest(
      new Request(PUBLISH_URL, { method: 'POST' }),
      configured,
      '/publish'
    );
    const wrong = authorizePublisherRequest(
      new Request(PUBLISH_URL, {
        method: 'POST',
        headers: { 'API-TOKEN': 'other-token-value' },
      }),
      configured,
      '/publish'
    );
    expect(missing?.status).toBe(403);
    expect(wrong?.status).toBe(403);
  });

  it('accepts an exact token and leaves health open', () => {
    const configured = env({ API_TOKEN: TEST_TOKEN });
    const accepted = authorizePublisherRequest(
      new Request(PUBLISH_URL, {
        method: 'POST',
        headers: { 'API-TOKEN': TEST_TOKEN },
      }),
      configured,
      '/publish'
    );
    const health = authorizePublisherRequest(
      new Request('http://localhost/health', { method: 'GET' }),
      env(),
      '/health'
    );
    expect(accepted).toBeNull();
    expect(health).toBeNull();
  });

  it('fails production startup when the token is missing and public mode is off', () => {
    const logger = {
      warn(_warning: string) {
        /* assertion is the thrown error */
      },
    };
    expect(() => validateEnvironment(env({ ENVIRONMENT: 'production' }), logger)).toThrow(
      /API_TOKEN/
    );
    expect(() =>
      validateEnvironment(
        env({
          ENVIRONMENT: 'production',
          ALLOW_UNAUTHENTICATED_PUBLISH: 'true',
        }),
        logger
      )
    ).not.toThrow();
  });

  it('warns outside production and rejects a missing profile namespace', () => {
    const warnings: string[] = [];
    const logger = {
      warn(warning: string) {
        warnings.push(warning);
      },
    };
    validateEnvironment(env(), logger);
    validateEnvironment(
      env({
        RATE_LIMIT_REQUESTS: '0',
        CORS_ENABLED: 'true',
        METRICS_EXPORT_ENABLED: 'true',
        METRICS_EXPORT_INTERVAL_MS: 'nope',
      }),
      logger
    );
    expect(warnings.some((warning) => warning.includes('API_TOKEN'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('CORS_ORIGINS'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('RATE_LIMIT_REQUESTS'))).toBe(true);
    expect(() => validateEnvironment({} as unknown as Env, logger)).toThrow(/PROFILES/);
  });
});
