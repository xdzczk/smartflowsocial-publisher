import type { Logger } from '../observability/logger';

import type { RelayUrl } from './types';

/**
 * Circuit breaker states
 */
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /**
   * Failure threshold to open circuit
   */
  failureThreshold: number;

  /**
   * Time window in milliseconds to track failures
   */
  failureWindowMs: number;

  /**
   * Time in milliseconds before attempting half-open
   */
  halfOpenTimeoutMs: number;

  /**
   * Success threshold to close circuit from half-open
   */
  successThreshold: number;
}

/**
 * Default circuit breaker configuration
 */
export const defaultCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5, // Open after 5 failures
  failureWindowMs: 60000, // Within 1 minute
  halfOpenTimeoutMs: 30000, // Try again after 30 seconds
  successThreshold: 2, // Need 2 successes to close
};

/**
 * Failure record for tracking failures in time window
 */
interface FailureRecord {
  timestamp: number;
}

/**
 * Circuit breaker for relay operations
 * Prevents cascading failures by opening circuit after threshold failures
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: FailureRecord[] = [];
  private halfOpenAttempts = 0;
  private halfOpenSuccesses = 0;
  private lastFailureTime: number | null = null;

  constructor(
    // relayUrl, config, and logger are used in methods below
    // eslint-disable-next-line no-unused-vars
    private readonly relayUrl: RelayUrl,
    // eslint-disable-next-line no-unused-vars
    private readonly config: CircuitBreakerConfig,
    // eslint-disable-next-line no-unused-vars
    private readonly logger: Logger
  ) {}

  /**
   * Gets current circuit state
   */
  getState(): CircuitState {
    this.cleanup();
    return this.state;
  }

  /**
   * Records a successful operation
   */
  recordSuccess(): void {
    this.cleanup();

    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.logger.info(`[CircuitBreaker] ${this.relayUrl} circuit closed (recovered)`);
        this.state = 'closed';
        this.halfOpenAttempts = 0;
        this.halfOpenSuccesses = 0;
        this.failures = [];
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failures = [];
    }
  }

  /**
   * Records a failed operation
   */
  recordFailure(): void {
    this.cleanup();

    const now = Date.now();
    this.failures.push({ timestamp: now });
    this.lastFailureTime = now;

    if (this.state === 'half-open') {
      // Failure in half-open state - open circuit again
      this.logger.warn(`[CircuitBreaker] ${this.relayUrl} circuit opened (half-open failure)`);
      this.state = 'open';
      this.halfOpenAttempts = 0;
      this.halfOpenSuccesses = 0;
    } else if (this.state === 'closed') {
      // Check if we should open circuit
      const recentFailures = this.failures.filter(
        (f) => f.timestamp > now - this.config.failureWindowMs
      );

      if (recentFailures.length >= this.config.failureThreshold) {
        this.logger.warn(
          `[CircuitBreaker] ${this.relayUrl} circuit opened (${recentFailures.length} failures)`
        );
        this.state = 'open';
      }
    }
  }

  /**
   * Checks if operation should be allowed
   * @returns True if operation should proceed, false if circuit is open
   */
  canAttempt(): boolean {
    this.cleanup();

    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime >= this.config.halfOpenTimeoutMs
      ) {
        this.logger.info(`[CircuitBreaker] ${this.relayUrl} circuit half-open (testing recovery)`);
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
        this.halfOpenSuccesses = 0;
        return true;
      }
      return false;
    }

    // half-open state
    return true;
  }

  /**
   * Cleans up old failure records
   */
  private cleanup(): void {
    const now = Date.now();
    this.failures = this.failures.filter(
      (f) => f.timestamp > now - this.config.failureWindowMs
    );
  }
}

/**
 * Circuit breaker manager for multiple relays
 */
export class CircuitBreakerManager {
  private breakers = new Map<RelayUrl, CircuitBreaker>();

  constructor(
    // config and logger are used in getBreaker method
    // eslint-disable-next-line no-unused-vars
    private readonly config: CircuitBreakerConfig,
    // eslint-disable-next-line no-unused-vars
    private readonly logger: Logger
  ) {}

  /**
   * Gets or creates a circuit breaker for a relay
   */
  getBreaker(relayUrl: RelayUrl): CircuitBreaker {
    let breaker = this.breakers.get(relayUrl);
    if (!breaker) {
      breaker = new CircuitBreaker(relayUrl, this.config, this.logger);
      this.breakers.set(relayUrl, breaker);
    }
    return breaker;
  }

  /**
   * Checks if operation should be attempted for a relay
   */
  canAttempt(relayUrl: RelayUrl): boolean {
    return this.getBreaker(relayUrl).canAttempt();
  }

  /**
   * Records success for a relay
   */
  recordSuccess(relayUrl: RelayUrl): void {
    this.getBreaker(relayUrl).recordSuccess();
  }

  /**
   * Records failure for a relay
   */
  recordFailure(relayUrl: RelayUrl): void {
    this.getBreaker(relayUrl).recordFailure();
  }

  /**
   * Resets all circuit breakers (useful for testing)
   */
  reset(): void {
    this.breakers.clear();
  }
}
