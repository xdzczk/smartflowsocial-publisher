import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthCheckManager } from '../../src/core/healthCheck';
import type { RelayUrl } from '../../src/core/types';
import { MockRelay, MockRelayConnection } from '../utils/mocks';
import { createMockLogger } from '../utils/testHelpers';

const RELAY = 'wss://relay.example.com' as RelayUrl;

describe('HealthCheckManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats an unknown relay as healthy', () => {
    const manager = new HealthCheckManager(createMockLogger());
    expect(manager.isHealthy(RELAY)).toBe(true);
    expect(manager.getHealth(RELAY)).toBeNull();
    expect(manager.getAllHealth()).toEqual([]);
  });

  it('resets failures after a success', () => {
    const manager = new HealthCheckManager(createMockLogger());
    manager.recordFailure(RELAY);
    manager.recordFailure(RELAY);
    manager.recordSuccess(RELAY);

    const health = manager.getHealth(RELAY);
    expect(health?.healthy).toBe(true);
    expect(health?.consecutiveFailures).toBe(0);
    expect(health?.lastSuccess).toEqual(expect.any(Number));
    expect(manager.getAllHealth()).toHaveLength(1);
  });

  it('marks a relay unhealthy after three consecutive failures', () => {
    const logger = createMockLogger();
    const manager = new HealthCheckManager(logger);
    manager.recordFailure(RELAY);
    manager.recordFailure(RELAY);
    expect(manager.isHealthy(RELAY)).toBe(true);

    manager.recordFailure(RELAY);
    expect(manager.isHealthy(RELAY)).toBe(false);
    expect(logger.warnLogs.some((log) => String(log[0]).includes('marked as unhealthy'))).toBe(
      true
    );
  });

  it('records a successful connection check', async () => {
    const logger = createMockLogger();
    const manager = new HealthCheckManager(logger);
    const relay = new MockRelay(RELAY, { connection: new MockRelayConnection() });

    await expect(manager.checkRelayHealth(relay, 50)).resolves.toBe(true);
    expect(manager.isHealthy(RELAY)).toBe(true);
    expect(logger.infoLogs.some((log) => String(log[0]).includes('is healthy'))).toBe(true);
  });

  it('records a timeout and a non-Error failure', async () => {
    const logger = createMockLogger();
    const manager = new HealthCheckManager(logger);
    const hanging = new MockRelay(RELAY, {
      connection: new MockRelayConnection({ connectDelay: 1_000 }),
    });

    const timedOut = manager.checkRelayHealth(hanging, 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(timedOut).resolves.toBe(false);

    const broken = new MockRelay(RELAY);
    vi.spyOn(broken, 'createConnection').mockRejectedValue('socket gone');
    await expect(manager.checkRelayHealth(broken, 10)).resolves.toBe(false);
    expect(logger.warnLogs.some((log) => String(log[0]).includes('socket gone'))).toBe(true);
  });
});
