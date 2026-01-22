import type { PublishPolicy } from './PublishPolicy';

/**
 * Aggressive policy prioritizing speed
 * Faster but less reliable
 */
export const aggressivePolicy: PublishPolicy = {
  relayConcurrency: 12,
  perRelayTimeoutMs: 5000,
  connectionTimeoutMs: 2000,
  overallTimeoutMs: 10000,
  minSuccessRelays: 1,
  retry: {
    maxAttempts: 0,
    backoffMs: 500,
  },
};
