import type { PublishPolicy } from './PublishPolicy';

/**
 * Default policy with sensible defaults
 * Balanced between speed and reliability
 */
/**
 * Default policy with sensible defaults
 * Balanced between speed and reliability
 * Includes retry logic for transient failures
 */
export const defaultPolicy: PublishPolicy = {
  relayConcurrency: 8,
  perRelayTimeoutMs: 10000,
  connectionTimeoutMs: 5000,
  overallTimeoutMs: 15000,
  minSuccessRelays: 1,
  retry: {
    maxAttempts: 1, // One retry for transient failures
    backoffMs: 1000,
  },
};
