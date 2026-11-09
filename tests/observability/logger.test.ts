import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConsoleLogger,
  JsonLogger,
  NullLogger,
  createLogger,
} from '../../src/observability/logger';

describe('loggers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats console logs with context, correlation ids, and non-string values', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new ConsoleLogger();

    logger.info();
    logger.info({ ready: true });
    logger.setCorrelationId('req-1');
    logger.info('started', { relay: 'wss://a.example' }, 'extra');
    logger.warn('careful');
    logger.error('failed', 7);
    logger.setCorrelationId(undefined);
    logger.info('cleared');

    expect(logger.getCorrelationId()).toBeUndefined();
    expect(info).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    const started = String(info.mock.calls[2]?.[0]);
    expect(started).toContain('req-1');
    expect(started).toContain('wss://a.example');
    expect(started).toContain('extra');
    expect(started).toContain('\n');
  });

  it('emits compact JSON in production', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger({ NODE_ENV: 'production' });

    expect(logger).toBeInstanceOf(JsonLogger);
    logger.setCorrelationId('job-9');
    logger.info('shipped', { count: 2 });
    logger.warn('slow');
    logger.error('down');

    const shipped = String(info.mock.calls[0]?.[0]);
    expect(shipped).not.toContain('\n');
    expect(JSON.parse(shipped)).toMatchObject({
      level: 'info',
      message: 'shipped',
      correlationId: 'job-9',
      context: { count: 2 },
    });
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('uses a console logger outside production and a null logger discards messages', () => {
    expect(createLogger()).toBeInstanceOf(ConsoleLogger);
    expect(createLogger({ NODE_ENV: 'development' })).toBeInstanceOf(ConsoleLogger);

    const logger = new NullLogger();
    logger.setCorrelationId('hidden');
    logger.info('nope');
    logger.warn('nope');
    logger.error('nope');
    expect(logger.getCorrelationId()).toBe('hidden');
  });
});
