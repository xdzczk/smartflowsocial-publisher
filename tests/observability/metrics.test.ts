import { describe, expect, it, vi } from 'vitest';

import { LoggerMetrics, NullMetrics, createMetrics } from '../../src/observability/metrics';
import { createMockLogger } from '../utils/testHelpers';

describe('metrics', () => {
  it('records counters, gauges, and histogram percentiles', async () => {
    const logger = createMockLogger();
    const metrics = new LoggerMetrics(logger);

    metrics.increment('publish.ok');
    metrics.increment('publish.ok', 2, { relay: 'b', region: 'eu' });
    metrics.increment('publish.ok', 1, { region: 'eu', relay: 'b' });
    metrics.gauge('pool.size', 4, { relay: 'a' });
    for (let value = 1; value <= 10; value += 1) {
      metrics.histogram('latency', value);
    }

    expect(metrics.getCounter('publish.ok')).toBe(1);
    expect(metrics.getCounter('publish.ok', { region: 'eu', relay: 'b' })).toBe(3);
    expect(metrics.getCounter('missing')).toBe(0);
    expect(metrics.getGauge('pool.size', { relay: 'a' })).toBe(4);
    expect(metrics.getGauge('missing')).toBe(0);
    expect(metrics.getHistogram('latency')).toHaveLength(10);
    expect(metrics.getHistogram('missing')).toEqual([]);
    expect(logger.infoLogs.some((log) => String(log[0]).includes('percentiles'))).toBe(true);

    metrics.reset();
    expect(metrics.getCounter('publish.ok')).toBe(0);
  });

  it('flushes to an exporter and logs export failures', async () => {
    const logger = createMockLogger();
    const exporter = {
      export: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve())
        .mockRejectedValueOnce(new Error('sink down')),
    };
    const metrics = new LoggerMetrics(logger, exporter, 1_000);
    metrics.increment('events');

    await metrics.flush();
    await metrics.flush();

    expect(exporter.export).toHaveBeenCalledTimes(2);
    expect(logger.warnLogs.some((log) => String(log[0]).includes('Failed to export'))).toBe(true);

    exporter.export.mockRejectedValueOnce('sink string');
    await metrics.flush();
    expect(logger.warnLogs.some((log) => String(log[0]).includes('sink string'))).toBe(true);
  });

  it('flushes as a no-op without an exporter', async () => {
    const metrics = new LoggerMetrics(createMockLogger());
    await expect(metrics.flush()).resolves.toBeUndefined();
  });

  it('ignores null metrics and builds an exporter when export is enabled', async () => {
    const silent = new NullMetrics();
    silent.increment('x', 2, { a: 'b' });
    silent.histogram('y', 1);
    silent.gauge('z', 3);

    const disabled = await createMetrics(createMockLogger(), { METRICS_EXPORT_ENABLED: 'false' });
    expect(disabled).toBeInstanceOf(LoggerMetrics);

    const enabled = await createMetrics(createMockLogger(), {
      METRICS_EXPORT_ENABLED: 'true',
      METRICS_EXPORT_INTERVAL_MS: '5000',
    });
    expect(enabled).toBeInstanceOf(LoggerMetrics);
    await (enabled as LoggerMetrics).flush();
  });
});
