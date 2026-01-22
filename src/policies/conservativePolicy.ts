import type { PublishPolicy } from './PublishPolicy';

/**
 * Conservative policy prioritizing reliability
 * Slower but more reliable
 */
export const conservativePolicy: PublishPolicy = {
  relayConcurrency: 4,
  perRelayTimeoutMs: 20000,
  connectionTimeoutMs: 10000,
  overallTimeoutMs: 30000,
  minSuccessRelays: 2,
  retry: {
    maxAttempts: 1,
    backoffMs: 2000,
  },
};
