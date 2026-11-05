import type { PublishPolicy } from '../policies/PublishPolicy';

import type { PublishOutcome, RelayResult } from './types';

/**
 * Classifies publish outcome based on results and policy success criteria
 * Centralized function for all outcome classification logic
 *
 * @param results Array of relay results
 * @param policy Publish policy with success criteria
 * @returns Classified publish outcome
 */
export function classifyPublishOutcome(
  results: RelayResult[],
  policy: PublishPolicy
): PublishOutcome {
  // Use policy's success criteria function if available
  if ('successCriteria' in policy && typeof policy.successCriteria === 'function') {
    return policy.successCriteria(results);
  }

  // Fallback to default classification using minSuccessRelays
  const successCount = results.filter((r) => r.status === 'success').length;
  const minSuccessRelays = policy.minSuccessRelays;

  if (successCount >= minSuccessRelays) {
    if (successCount === results.length) {
      return { status: 'success', relays: results };
    }
    return { status: 'partial', relays: results };
  }

  return { status: 'failed', relays: results };
}
