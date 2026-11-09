import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CircuitBreakerManager,
  defaultCircuitBreakerConfig,
  type CircuitBreakerConfig,
} from '../../src/core/circuitBreaker';
import type { RelayUrl } from '../../src/core/types';
import { createMockLogger } from '../utils/testHelpers';

const RELAY = 'wss://relay.example.com' as RelayUrl;
const OTHER = 'wss://other.example.com' as RelayUrl;

const config: CircuitBreakerConfig = {
  failureThreshold: 2,
  failureWindowMs: 1_000,
  halfOpenTimeoutMs: 500,
  successThreshold: 2,
};

describe('CircuitBreakerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the default production thresholds', () => {
    expect(defaultCircuitBreakerConfig.failureThreshold).toBe(5);
    expect(defaultCircuitBreakerConfig.successThreshold).toBe(2);
  });

  it('opens after the failure threshold and closes after enough half-open successes', () => {
    const logger = createMockLogger();
    const manager = new CircuitBreakerManager(config, logger);
    const breaker = manager.getBreaker(RELAY);

    expect(breaker.getState()).toBe('closed');
    expect(manager.canAttempt(RELAY)).toBe(true);

    breaker.recordSuccess();
    manager.recordFailure(RELAY);
    expect(breaker.canAttempt()).toBe(true);

    manager.recordFailure(RELAY);
    expect(breaker.getState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
    expect(logger.warnLogs.some((log) => String(log[0]).includes('circuit opened'))).toBe(true);

    vi.advanceTimersByTime(config.halfOpenTimeoutMs);
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.getState()).toBe('half-open');
    expect(breaker.canAttempt()).toBe(true);

    manager.recordSuccess(RELAY);
    expect(breaker.getState()).toBe('half-open');
    manager.recordSuccess(RELAY);
    expect(breaker.getState()).toBe('closed');
    expect(logger.infoLogs.some((log) => String(log[0]).includes('circuit closed'))).toBe(true);
  });

  it('reopens when a half-open probe fails', () => {
    const logger = createMockLogger();
    const manager = new CircuitBreakerManager(config, logger);

    manager.recordFailure(RELAY);
    manager.recordFailure(RELAY);
    vi.advanceTimersByTime(config.halfOpenTimeoutMs);
    expect(manager.canAttempt(RELAY)).toBe(true);

    manager.recordFailure(RELAY);
    expect(manager.getBreaker(RELAY).getState()).toBe('open');
    expect(logger.warnLogs.some((log) => String(log[0]).includes('half-open failure'))).toBe(true);
  });

  it('reuses a breaker and can forget every relay', () => {
    const manager = new CircuitBreakerManager(config, createMockLogger());
    const first = manager.getBreaker(RELAY);
    expect(manager.getBreaker(RELAY)).toBe(first);
    manager.recordFailure(OTHER);
    manager.reset();
    expect(manager.getBreaker(RELAY)).not.toBe(first);
    expect(manager.canAttempt(OTHER)).toBe(true);
  });
});
