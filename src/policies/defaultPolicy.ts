import type { PublishOutcome, RelayResult } from '../core/types';

import type { PublishPolicy } from './PublishPolicy';

/**
 * Default success criteria: at least 1 successful relay
 */
function defaultSuccessCriteria(results: RelayResult[]): PublishOutcome {
  const successCount = results.filter((r) => r.status === 'success').length;
  const minSuccessRelays = 1;

  if (successCount >= minSuccessRelays) {
    if (successCount === results.length) {
      return { status: 'success', relays: results };
    }
    return { status: 'partial', relays: results };
  }

  return { status: 'failed', relays: results };
}

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
  successCriteria: defaultSuccessCriteria,
};
