import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';

import { assertEventSignature } from '../../src/security/eventSignature';
import { createSignedEvent } from '../utils/fixtures';

describe('event signature verification', () => {
  it('accepts a cryptographically valid event', () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'hello',
      },
      generateSecretKey()
    );
    expect(() => assertEventSignature(event)).not.toThrow();
  });

  it('rejects a hex signature that was not produced by the key', () => {
    const event = createSignedEvent();
    expect(() => assertEventSignature(event)).toThrow(/signature is invalid/);
  });
});
