import { describe, expect, it } from 'vitest';

import { normalizeRelayUrls } from '../../src/core/RelayUrl';

const RELAY1 = 'wss://relay1.example.com';
const RELAY2 = 'wss://relay2.example.com';
const RELAY3 = 'wss://relay3.example.com';
const RELAY_BASE = 'wss://relay.example.com';

describe('Relay Normalization Properties', () => {
  describe('idempotency', () => {
    it('should be idempotent (normalize twice = same result)', () => {
      const input = [RELAY1, RELAY2, RELAY3];

      const first = normalizeRelayUrls(input);
      const second = normalizeRelayUrls(first);
      const third = normalizeRelayUrls(second);

      expect(first).toEqual(second);
      expect(second).toEqual(third);
    });
  });

  describe('valid URLs', () => {
    it('should always return valid wss:// URLs', () => {
      const inputs = [
        [RELAY_BASE],
        ['ws://relay.example.com'],
        ['http://relay.example.com'],
        ['https://relay.example.com'],
        [`${RELAY_BASE}/`, 'ws://relay2.example.com/'],
      ];

      inputs.forEach((input) => {
        const result = normalizeRelayUrls(input);
        result.forEach((url) => {
          expect(url).toMatch(/^wss:\/\//);
          try {
            new URL(url);
          } catch {
            throw new Error(`Invalid URL: ${url}`);
          }
        });
      });
    });
  });

  describe('deduplication', () => {
    it('should preserve relay identity (deduplication works)', () => {
      const input = [RELAY_BASE, RELAY_BASE, `${RELAY_BASE}/`, RELAY_BASE];

      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(RELAY_BASE);
    });

    it('should deduplicate after normalization', () => {
      const input = [
        RELAY_BASE,
        'ws://relay.example.com', // Same relay, different protocol
        'https://relay.example.com', // Same relay, different protocol
      ];

      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(1);
    });
  });

  describe('max relay limit', () => {
    it('should always enforce max relay limit of 12', () => {
      const input = Array.from({ length: 100 }, (_, i) => `wss://relay${i}.example.com`);
      const result = normalizeRelayUrls(input);
      expect(result.length).toBeLessThanOrEqual(12);
      expect(result.length).toBe(12);
    });

    it('should allow fewer than 12 relays', () => {
      const input = [RELAY1, RELAY2];
      const result = normalizeRelayUrls(input);
      expect(result.length).toBe(2);
      expect(result.length).toBeLessThanOrEqual(12);
    });
  });

  describe('result count', () => {
    it('should always return result count ≤ input count', () => {
      const inputs = [
        [RELAY1, RELAY2],
        [RELAY1, RELAY1], // Duplicate
        [RELAY1, 'invalid-url'],
        [RELAY1, RELAY2, RELAY3],
      ];

      inputs.forEach((input) => {
        const result = normalizeRelayUrls(input);
        expect(result.length).toBeLessThanOrEqual(input.length);
      });
    });
  });

  describe('order preservation', () => {
    it('should preserve order of first occurrence', () => {
      const input = [RELAY1, RELAY2, RELAY1, RELAY3]; // Duplicate RELAY1

      const result = normalizeRelayUrls(input);
      expect(result[0]).toBe(RELAY1);
      expect(result[1]).toBe(RELAY2);
      expect(result[2]).toBe(RELAY3);
    });
  });
});
