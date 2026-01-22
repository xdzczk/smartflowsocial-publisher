import type { Logger } from '../observability/logger';

import { RelayStateMachineManager, type CircuitState } from './stateMachine';
import type { RelayUrl } from './types';

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
 * Uses state machine for formal state tracking
 */
export class CircuitBreaker {
  private failures: FailureRecord[] = [];
  private halfOpenSuccesses = 0;
  private lastFailureTime: number | null = null;

  constructor(
    private readonly relayUrl: RelayUrl,
    private readonly config: CircuitBreakerConfig,
    private readonly logger: Logger,
    private readonly stateMachine: RelayStateMachineManager
  ) {}

  /**
   * Gets current circuit state from state machine
   */
  getState(): CircuitState {
    this.cleanup();
    return this.stateMachine.getMachine(this.relayUrl).getCircuitState();
  }

  /**
   * Records a successful operation
   */
  recordSuccess(): void {
    this.cleanup();
    const machine = this.stateMachine.getMachine(this.relayUrl);
    const circuitState = machine.getCircuitState();

    if (circuitState === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.logger.info(`[CircuitBreaker] ${this.relayUrl} circuit closed (recovered)`);
        machine.setCircuitState('closed');
        this.halfOpenSuccesses = 0;
        this.failures = [];
      }
    } else if (circuitState === 'closed') {
      // Reset failure count on success
      this.failures = [];
    }
  }

  /**
   * Records a failed operation
   */
  recordFailure(): void {
    this.cleanup();
    const machine = this.stateMachine.getMachine(this.relayUrl);
    const circuitState = machine.getCircuitState();

    const now = Date.now();
    this.failures.push({ timestamp: now });
    this.lastFailureTime = now;

    if (circuitState === 'half-open') {
      // Failure in half-open state - open circuit again
      this.logger.warn(`[CircuitBreaker] ${this.relayUrl} circuit opened (half-open failure)`);
      machine.setCircuitState('open');
      this.halfOpenSuccesses = 0;
    } else if (circuitState === 'closed') {
      // Check if we should open circuit
      const recentFailures = this.failures.filter(
        (f) => f.timestamp > now - this.config.failureWindowMs
      );

      if (recentFailures.length >= this.config.failureThreshold) {
        this.logger.warn(
          `[CircuitBreaker] ${this.relayUrl} circuit opened (${recentFailures.length} failures)`
        );
        machine.setCircuitState('open');
      }
    }
  }

  /**
   * Checks if operation should be allowed
   * @returns True if operation should proceed, false if circuit is open
   */
  canAttempt(): boolean {
    this.cleanup();
    const machine = this.stateMachine.getMachine(this.relayUrl);
    const circuitState = machine.getCircuitState();

    if (circuitState === 'closed') {
      return true;
    }

    if (circuitState === 'open') {
      // Check if we should transition to half-open
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime >= this.config.halfOpenTimeoutMs
      ) {
        this.logger.info(`[CircuitBreaker] ${this.relayUrl} circuit half-open (testing recovery)`);
        machine.setCircuitState('half-open');
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
 * Uses state machine for formal state tracking
 */
export class CircuitBreakerManager {
  private breakers = new Map<RelayUrl, CircuitBreaker>();
  private readonly stateMachineManager: RelayStateMachineManager;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly logger: Logger
  ) {
    this.stateMachineManager = new RelayStateMachineManager(logger);
  }

  /**
   * Gets or creates a circuit breaker for a relay
   */
  getBreaker(relayUrl: RelayUrl): CircuitBreaker {
    let breaker = this.breakers.get(relayUrl);
    if (!breaker) {
      breaker = new CircuitBreaker(relayUrl, this.config, this.logger, this.stateMachineManager);
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
    this.stateMachineManager.reset();
  }
}
