import { describe, expect, it } from 'vitest';

import {
  RelayOperationStateMachine,
  RelayStateMachineManager,
} from '../../src/core/stateMachine';
import type { RelayUrl } from '../../src/core/types';
import { MockLogger } from '../utils/mocks';

const TEST_RELAY_URL = 'wss://relay.test' as RelayUrl;

describe('stateMachine', () => {
  describe('RelayOperationStateMachine', () => {
    it('should start in idle state', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      expect(machine.getState()).toBe('idle');
      expect(machine.getCircuitState()).toBe('closed');
      expect(machine.getAttemptCount()).toBe(0);
    });

    it('should transition from idle to connecting', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      const result = machine.transition('connecting');
      expect(result).toBe(true);
      expect(machine.getState()).toBe('connecting');
    });

    it('should transition from connecting to publishing', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      const result = machine.transition('publishing');
      expect(result).toBe(true);
      expect(machine.getState()).toBe('publishing');
    });

    it('should transition from publishing to success', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      const result = machine.transition('success');
      expect(result).toBe(true);
      expect(machine.getState()).toBe('success');
    });

    it('should transition from publishing to failure', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      const result = machine.transition('failure');
      expect(result).toBe(true);
      expect(machine.getState()).toBe('failure');
    });

    it('should transition from failure to retry_eligible', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      machine.transition('failure');
      const result = machine.transition('retry_eligible');
      expect(result).toBe(true);
      expect(machine.getState()).toBe('retry_eligible');
    });

    it('should transition from retry_eligible to retry_in_progress', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      machine.transition('failure');
      machine.transition('retry_eligible');
      const result = machine.transition('retry_in_progress');
      expect(result).toBe(true);
      expect(machine.getState()).toBe('retry_in_progress');
      expect(machine.getAttemptCount()).toBe(1);
    });

    it('should increment attempt count on retry', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      machine.transition('failure');
      machine.transition('retry_eligible');
      machine.transition('retry_in_progress');
      expect(machine.getAttemptCount()).toBe(1);
      
      // Second retry
      machine.transition('failure');
      machine.transition('retry_eligible');
      machine.transition('retry_in_progress');
      expect(machine.getAttemptCount()).toBe(2);
    });

    it('should reset attempt count on success', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      machine.transition('failure');
      machine.transition('retry_eligible');
      machine.transition('retry_in_progress');
      expect(machine.getAttemptCount()).toBe(1);
      
      machine.transition('success');
      expect(machine.getAttemptCount()).toBe(0);
    });

    it('should reject invalid transitions', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      const result = machine.transition('success'); // Can't go from idle to success
      expect(result).toBe(false);
      expect(machine.getState()).toBe('idle');
    });

    it('should transition to circuit_open when circuit opens', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.setCircuitState('open');
      expect(machine.getCircuitState()).toBe('open');
      expect(machine.getState()).toBe('circuit_open');
    });

    it('should track transition history', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      machine.transition('success');
      
      const history = machine.getTransitionHistory();
      expect(history.length).toBe(3);
      expect(history[0].from).toBe('idle');
      expect(history[0].to).toBe('connecting');
      expect(history[1].from).toBe('connecting');
      expect(history[1].to).toBe('publishing');
      expect(history[2].from).toBe('publishing');
      expect(history[2].to).toBe('success');
    });

    it('should reset to idle', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      machine.transition('connecting');
      machine.transition('publishing');
      machine.reset();
      expect(machine.getState()).toBe('idle');
      expect(machine.getAttemptCount()).toBe(0);
    });

    it('should check if transition is valid', () => {
      const machine = new RelayOperationStateMachine(TEST_RELAY_URL, new MockLogger());
      expect(machine.canTransitionTo('connecting')).toBe(true);
      expect(machine.canTransitionTo('success')).toBe(false);
    });
  });

  describe('RelayStateMachineManager', () => {
    const RELAY1_URL = 'wss://relay1.test' as RelayUrl;
    const RELAY2_URL = 'wss://relay2.test' as RelayUrl;

    it('should create and retrieve state machines', () => {
      const manager = new RelayStateMachineManager(new MockLogger());
      const machine1 = manager.getMachine(RELAY1_URL);
      const machine2 = manager.getMachine(RELAY2_URL);
      
      expect(machine1).toBeDefined();
      expect(machine2).toBeDefined();
      expect(machine1).not.toBe(machine2);
    });

    it('should return same machine for same relay', () => {
      const manager = new RelayStateMachineManager(new MockLogger());
      const machine1 = manager.getMachine(TEST_RELAY_URL);
      const machine2 = manager.getMachine(TEST_RELAY_URL);
      
      expect(machine1).toBe(machine2);
    });

    it('should reset all machines', () => {
      const manager = new RelayStateMachineManager(new MockLogger());
      const machine1 = manager.getMachine(RELAY1_URL);
      
      manager.reset();
      
      // New machines should be created after reset
      const machine3 = manager.getMachine(RELAY1_URL);
      expect(machine3).not.toBe(machine1);
    });
  });
});
