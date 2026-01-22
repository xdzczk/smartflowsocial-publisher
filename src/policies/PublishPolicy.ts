/**
 * Policy for publishing events to relays
 * All timeouts, concurrency, and retry behavior is policy-driven
 */
export interface PublishPolicy {
  /**
   * Maximum number of concurrent relay connections
   */
  relayConcurrency: number;

  /**
   * Timeout per relay in milliseconds
   * Includes connection + publish time
   */
  perRelayTimeoutMs: number;

  /**
   * Connection timeout in milliseconds
   * Time allowed for initial WebSocket connection
   */
  connectionTimeoutMs: number;

  /**
   * Overall timeout in milliseconds
   * Maximum time for entire publish operation
   */
  overallTimeoutMs: number;

  /**
   * Minimum number of successful relays for overall success
   * If fewer succeed, outcome is 'partial' or 'failed'
   */
  minSuccessRelays: number;

  /**
   * Retry configuration
   */
  retry: {
    /**
     * Maximum retry attempts per relay
     */
    maxAttempts: number;

    /**
     * Backoff delay in milliseconds between retries
     */
    backoffMs: number;
  };
}
