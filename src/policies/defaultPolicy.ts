import type { PublishPolicy } from './PublishPolicy';

/**
 * Default policy with sensible defaults
 * Balanced between speed and reliability
 */
export const defaultPolicy: PublishPolicy = {
  relayConcurrency: 8,
  perRelayTimeoutMs: 10000,
  connectionTimeoutMs: 5000,
  overallTimeoutMs: 15000,
  minSuccessRelays: 1,
  retry: {
    maxAttempts: 0, // No retries by default
    backoffMs: 1000,
  },
};
