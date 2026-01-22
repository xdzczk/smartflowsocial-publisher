import type { PublishOutcome, RelayResult } from '../core/types';

import type { PublishPolicy } from './PublishPolicy';

/**
 * Aggressive success criteria: at least 1 successful relay
 */
function aggressiveSuccessCriteria(results: RelayResult[]): PublishOutcome {
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
  successCriteria: aggressiveSuccessCriteria,
};
