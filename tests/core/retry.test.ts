import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryWithBackoff } from '../../src/core/retry';
import { RelayOperationStateMachine } from '../../src/core/stateMachine';
import type { RelayUrl } from '../../src/core/types';
import { createMockLogger } from '../utils/testHelpers';

const RELAY = 'wss://relay.example.com' as RelayUrl;

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the first successful result without retrying', async () => {
    const logger = createMockLogger();
    const operation = vi.fn().mockResolvedValue('ok');

    await expect(retryWithBackoff(operation, 3, 10, logger)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(logger.infoLogs).toHaveLength(0);
  });

  it('retries a timeout and logs the later success', async () => {
    const logger = createMockLogger();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection timeout'))
      .mockResolvedValueOnce('recovered');

    const promise = retryWithBackoff(operation, 3, 20, logger);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(logger.infoLogs.some((log) => String(log[0]).includes('succeeded after'))).toBe(true);
  });

  it('does not retry validation failures', async () => {
    const logger = createMockLogger();
    const operation = vi.fn().mockRejectedValue(new Error('validation failed'));

    await expect(retryWithBackoff(operation, 4, 10, logger)).rejects.toThrow('validation failed');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(logger.warnLogs.some((log) => String(log[0]).includes('Non-retryable'))).toBe(true);
  });

  it('does not retry non-Error rejections', async () => {
    const logger = createMockLogger();
    const operation = vi.fn().mockRejectedValue('nope');

    await expect(retryWithBackoff(operation, 3, 10, logger)).rejects.toBe('nope');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after the last retryable attempt', async () => {
    const logger = createMockLogger();
    const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const promise = retryWithBackoff(operation, 2, 5, logger);
    const assertion = expect(promise).rejects.toThrow('ECONNREFUSED');
    await vi.runAllTimersAsync();
    await assertion;
    expect(operation).toHaveBeenCalledTimes(2);
    expect(logger.errorLogs.some((log) => String(log[0]).includes('failed after'))).toBe(true);
  });

  it('rejects immediately when the attempt budget is empty', async () => {
    const logger = createMockLogger();
    const operation = vi.fn();

    await expect(retryWithBackoff(operation, 0, 10, logger)).rejects.toThrow(
      'Operation failed with unknown error'
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('cancels a retry while waiting to back off', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(new Error('network down'));

    const promise = retryWithBackoff(operation, 3, 1_000, logger, controller.signal);
    const assertion = expect(promise).rejects.toThrow('aborted during retry backoff');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
  });

  it('refuses to start when the signal is already aborted', async () => {
    const logger = createMockLogger();
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn().mockResolvedValue('unused');

    const promise = retryWithBackoff(operation, 2, 10, logger, controller.signal);
    const assertion = expect(promise).rejects.toThrow('Operation aborted');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('tracks connecting, retry, and failure on the state machine', async () => {
    const logger = createMockLogger();
    const machine = new RelayOperationStateMachine(RELAY, logger);
    const operation = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const promise = retryWithBackoff(operation, 2, 5, logger, undefined, machine, RELAY);
    const assertion = expect(promise).rejects.toThrow('ENOTFOUND');
    await vi.runAllTimersAsync();
    await assertion;

    const states = machine.getTransitionHistory().map((entry) => entry.to);
    expect(states).toContain('connecting');
    expect(states).toContain('failure');
  });

  it('marks a failed machine retry-eligible when another attempt remains', async () => {
    const logger = createMockLogger();
    const machine = new RelayOperationStateMachine(RELAY, logger);
    machine.transition('connecting');
    machine.transition('failure');
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');

    const promise = retryWithBackoff(operation, 2, 5, logger, undefined, machine, RELAY);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(machine.getTransitionHistory().some((entry) => entry.to === 'retry_eligible')).toBe(
      true
    );
  });

  it('opens the circuit when a failed machine cannot retry', async () => {
    const logger = createMockLogger();
    const machine = new RelayOperationStateMachine(RELAY, logger);
    machine.transition('connecting');
    machine.transition('failure');

    await expect(
      retryWithBackoff(
        async () => {
          throw new Error('validation failed');
        },
        2,
        5,
        logger,
        undefined,
        machine,
        RELAY
      )
    ).rejects.toThrow('validation failed');
    expect(machine.getState()).toBe('circuit_open');
  });

  it('records success on a machine that is already publishing', async () => {
    const logger = createMockLogger();
    const machine = new RelayOperationStateMachine(RELAY, logger);
    machine.transition('connecting');
    machine.transition('publishing');

    await expect(
      retryWithBackoff(async () => 'done', 2, 10, logger, undefined, machine, RELAY)
    ).resolves.toBe('done');
    expect(machine.getState()).toBe('success');
  });
});
