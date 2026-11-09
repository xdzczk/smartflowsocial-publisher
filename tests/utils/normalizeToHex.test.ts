import { describe, expect, it } from 'vitest';

import { normalizeToHex } from '../../src/utils';

const HEX_PUBKEY = 'ab'.repeat(32);
const NPUB = 'npub14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4scf6zts';

describe('normalizeToHex', () => {
  it('rejects empty and non-string values', () => {
    expect(normalizeToHex('')).toBeUndefined();
    expect(normalizeToHex(42)).toBeUndefined();
  });

  it('returns plain strings unchanged', () => {
    expect(normalizeToHex('deadbeef')).toBe('deadbeef');
  });

  it('decodes an npub to hex', () => {
    expect(normalizeToHex(NPUB)).toBe(HEX_PUBKEY);
  });

  it('returns undefined when a nostr prefix is not valid bech32', () => {
    expect(normalizeToHex('npub1not-valid')).toBeUndefined();
    expect(normalizeToHex('note1not-valid')).toBeUndefined();
    expect(normalizeToHex('nsec1not-valid')).toBeUndefined();
  });
});
