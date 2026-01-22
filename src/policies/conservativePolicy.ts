import type { PublishOutcome, RelayResult } from '../core/types';

import type { PublishPolicy } from './PublishPolicy';

/**
 * Conservative success criteria: at least 2 successful relays
 */
function conservativeSuccessCriteria(results: RelayResult[]): PublishOutcome {
  const successCount = results.filter((r) => r.status === 'success').length;
  const minSuccessRelays = 2;

  if (successCount >= minSuccessRelays) {
    if (successCount === results.length) {
      return { status: 'success', relays: results };
    }
    return { status: 'partial', relays: results };
  }

  return { status: 'failed', relays: results };
}

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
  successCriteria: conservativeSuccessCriteria,
};
