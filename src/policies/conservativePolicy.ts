import type { PublishPolicy } from './PublishPolicy';

/**
 * Conservative policy prioritizing reliability
 * Slower but more reliable
 * Includes retry logic with longer backoff for better reliability
 */
export const conservativePolicy: PublishPolicy = {
  relayConcurrency: 4,
  perRelayTimeoutMs: 20000,
  connectionTimeoutMs: 10000,
  overallTimeoutMs: 30000,
  minSuccessRelays: 2,
  retry: {
    maxAttempts: 2, // More retries for reliability
    backoffMs: 2000, // Longer backoff
  },
};
