import type { Logger } from '../observability/logger';

import type { RelayUrl } from './types';

/**
 * States for relay operation lifecycle
 */
export type RelayOperationState =
  | 'idle'
  | 'connecting'
  | 'publishing'
  | 'success'
  | 'failure'
  | 'circuit_open'
  | 'retry_eligible'
  | 'retry_in_progress';

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Valid state transitions for relay operations
 */
const VALID_TRANSITIONS: Record<RelayOperationState, RelayOperationState[]> = {
  idle: ['connecting', 'circuit_open'],
  connecting: ['publishing', 'failure', 'circuit_open'],
  publishing: ['success', 'failure', 'circuit_open'],
  success: ['idle'], // Terminal state, can reset to idle
  failure: ['retry_eligible', 'circuit_open'], // Can retry or circuit opens
  circuit_open: ['retry_eligible'], // Can attempt recovery
  retry_eligible: ['retry_in_progress', 'circuit_open'],
  retry_in_progress: ['success', 'failure', 'circuit_open'],
};

/**
 * State machine for relay operations
 * Tracks the lifecycle of a relay publish operation including retries and circuit breaker states
 */
export class RelayOperationStateMachine {
  private state: RelayOperationState = 'idle';
  private circuitState: CircuitState = 'closed';
  private attemptCount = 0;
  private lastTransitionTime = Date.now();
  private transitionHistory: Array<{ from: RelayOperationState; to: RelayOperationState; timestamp: number }> = [];

  constructor(
    private readonly relayUrl: RelayUrl,
    private readonly logger: Logger
  ) {}

  /**
   * Gets the current operation state
   */
  getState(): RelayOperationState {
    return this.state;
  }

  /**
   * Gets the current circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  /**
   * Gets the number of attempts made
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }

  /**
   * Gets the transition history
   */
  getTransitionHistory(): ReadonlyArray<{ from: RelayOperationState; to: RelayOperationState; timestamp: number }> {
    return this.transitionHistory;
  }

  /**
   * Transitions to a new state if the transition is valid
   * @param newState The target state
   * @returns True if transition was successful, false if invalid
   */
  transition(newState: RelayOperationState): boolean {
    const validNextStates = VALID_TRANSITIONS[this.state];
    
    if (!validNextStates.includes(newState)) {
      this.logger.warn(
        `[StateMachine] ${this.relayUrl}: Invalid transition from ${this.state} to ${newState}. ` +
        `Valid transitions: ${validNextStates.join(', ')}`
      );
      return false;
    }

    const oldState = this.state;
    this.state = newState;
    this.lastTransitionTime = Date.now();
    
    this.transitionHistory.push({
      from: oldState,
      to: newState,
      timestamp: this.lastTransitionTime,
    });

    // Increment attempt count on retry
    if (newState === 'retry_in_progress') {
      this.attemptCount++;
    }

    // Reset attempt count on success
    if (newState === 'success') {
      this.attemptCount = 0;
    }

    this.logger.info(`[StateMachine] ${this.relayUrl}: ${oldState} → ${newState} (attempt ${this.attemptCount})`);
    
    return true;
  }

  /**
   * Transitions circuit breaker state
   * @param newCircuitState The new circuit breaker state
   */
  setCircuitState(newCircuitState: CircuitState): void {
    if (this.circuitState !== newCircuitState) {
      const oldCircuitState = this.circuitState;
      this.circuitState = newCircuitState;
      this.logger.info(`[StateMachine] ${this.relayUrl}: Circuit ${oldCircuitState} → ${newCircuitState}`);
      
      // If circuit opens, transition operation to circuit_open state
      if (newCircuitState === 'open' && this.state !== 'circuit_open') {
        this.transition('circuit_open');
      }
    }
  }

  /**
   * Checks if a transition to the given state is valid
   */
  canTransitionTo(state: RelayOperationState): boolean {
    return VALID_TRANSITIONS[this.state].includes(state);
  }

  /**
   * Resets the state machine to idle
   */
  reset(): void {
    const oldState = this.state;
    this.state = 'idle';
    this.attemptCount = 0;
    this.lastTransitionTime = Date.now();
    this.logger.info(`[StateMachine] ${this.relayUrl}: Reset from ${oldState} to idle`);
  }

  /**
   * Gets the time since last transition
   */
  getTimeSinceLastTransition(): number {
    return Date.now() - this.lastTransitionTime;
  }
}

/**
 * State machine manager for multiple relays
 */
export class RelayStateMachineManager {
  private machines = new Map<RelayUrl, RelayOperationStateMachine>();

  constructor(private readonly logger: Logger) {}

  /**
   * Gets or creates a state machine for a relay
   */
  getMachine(relayUrl: RelayUrl): RelayOperationStateMachine {
    let machine = this.machines.get(relayUrl);
    if (!machine) {
      machine = new RelayOperationStateMachine(relayUrl, this.logger);
      this.machines.set(relayUrl, machine);
    }
    return machine;
  }

  /**
   * Resets all state machines (useful for testing)
   */
  reset(): void {
    this.machines.clear();
  }
}
