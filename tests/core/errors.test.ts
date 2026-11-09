import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  RelayError,
  ReplayError,
  TimeoutError,
  ValidationError,
} from '../../src/core/errors';
import type { RelayUrl } from '../../src/core/types';

const RELAY = 'wss://relay.example.com' as RelayUrl;

describe('application errors', () => {
  it('suggests a fix for the common event fields', () => {
    expect(new ValidationError('bad id', 'event.id').suggestion).toContain('64-character');
    expect(new ValidationError('bad sig', 'event.sig').suggestion).toContain('128-character');
    expect(new ValidationError('bad key', 'event.pubkey').suggestion).toContain('npub');
    expect(new ValidationError('bad relays', 'relays').suggestion).toContain('wss://');
  });

  it('keeps an explicit suggestion and field-less details', () => {
    const error = new ValidationError('nope', undefined, { reason: 'missing' }, 'try again');
    expect(error.suggestion).toBe('try again');
    expect(error.details).toEqual({ reason: 'missing' });
    expect(error.httpStatus).toBe(400);
    expect(error.name).toBe('ValidationError');
  });

  it('carries relay, timeout, configuration, and replay context', () => {
    const relayError = new RelayError('down', RELAY, 'unreachable', { attempt: 2 });
    expect(relayError.httpStatus).toBe(502);
    expect(relayError.relay).toBe(RELAY);
    expect(relayError.reason).toBe('unreachable');

    const timeout = new TimeoutError('too slow', 1500);
    expect(timeout.code).toBe('TIMEOUT_ERROR');
    expect(timeout.timeoutMs).toBe(1500);

    const config = new ConfigurationError('bad policy', { name: 'custom' });
    expect(config.httpStatus).toBe(500);
    expect(config.details).toEqual({ name: 'custom' });

    const replay = new ReplayError('already published', 'abc');
    expect(replay.httpStatus).toBe(409);
    expect(replay.eventId).toBe('abc');
    expect(replay.details).toMatchObject({ eventId: 'abc', ttlHours: 24, replayProtection: true });
    expect(replay.suggestion).toContain('24 hours');
  });
});
