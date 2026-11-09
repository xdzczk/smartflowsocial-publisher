import { describe, expect, it } from 'vitest';

import {
  validateEvent,
  validateProfileRequest,
  validatePublishRequest,
  validateRelayUrl,
  validateSignedEventSchema,
} from '../../src/validation/schemas';
import { createSignedEvent } from '../utils/fixtures';

describe('schema validation branches', () => {
  it('accepts ws, http, and https relay URLs and rejects other schemes', () => {
    expect(validateRelayUrl('ws://relay.example.com')).toBe('ws://relay.example.com');
    expect(validateRelayUrl('http://relay.example.com')).toBe('http://relay.example.com');
    expect(validateRelayUrl('https://relay.example.com')).toBe('https://relay.example.com');
    expect(() => validateRelayUrl('ftp://relay.example.com')).toThrow(/Invalid relay URL/);
    expect(() => validateRelayUrl(42)).toThrow(/Invalid relay URL/);
  });

  it('reports an invalid event and an invalid signature', () => {
    expect(() => validateEvent(null)).toThrow(/Invalid event/);
    expect(() => validateEvent('nope')).toThrow(/Invalid event/);

    const event = createSignedEvent({ sig: 'zz'.repeat(64) });
    expect(() => validateSignedEventSchema(event)).toThrow(/128-character/);
    expect(() => validateSignedEventSchema({ id: 'nope' })).toThrow(/Invalid signed event/);
  });

  it('validates publish and profile requests, including a bad signature', () => {
    const event = createSignedEvent();
    const request = validatePublishRequest({
      relays: ['wss://relay.example.com'],
      event,
      correlationId: 'corr',
    });
    expect(request.correlationId).toBe('corr');

    expect(() =>
      validatePublishRequest({
        relays: ['wss://relay.example.com'],
        event: createSignedEvent({ sig: 'not-hex' }),
      })
    ).toThrow(/128-character/);

    expect(() => validatePublishRequest({ relays: ['ftp://nope.example'], event })).toThrow(
      /relays/
    );
    expect(() => validatePublishRequest(null)).toThrow(/Invalid publish request|Invalid request/);

    const profile = validateProfileRequest({
      relays: ['https://relay.example.com'],
      pubkey: 'ab',
    });
    expect(profile.pubkey).toBe('ab');
    expect(() => validateProfileRequest({ relays: [], pubkey: '' })).toThrow(/Invalid profile/);
    expect(() => validateProfileRequest('nope')).toThrow(/Invalid profile|Invalid request/);
  });
});
