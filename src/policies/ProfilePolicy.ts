/**
 * Policy for fetching profiles from relays
 */
export interface ProfilePolicy {
  /**
   * Timeout per relay in milliseconds
   */
  perRelayTimeoutMs: number;

  /**
   * Overall timeout in milliseconds
   */
  overallTimeoutMs: number;

  /**
   * Maximum number of relays to query
   */
  maxRelays: number;
}

/**
 * Default profile policy
 */
export const defaultProfilePolicy: ProfilePolicy = {
  perRelayTimeoutMs: 5000,
  overallTimeoutMs: 10000,
  maxRelays: 10,
};
