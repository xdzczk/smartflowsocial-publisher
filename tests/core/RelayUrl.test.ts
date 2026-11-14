import { describe, expect, it } from 'vitest';

import { cleanUrls, normalizeRelayUrls } from '../../src/core/RelayUrl';

const RELAY_DAMUS = 'wss://relay.damus.io';
const RELAY_SNORT = 'wss://relay.snort.social';
const RELAY_EXAMPLE = 'wss://relay.example.com';
const RELAY1 = 'wss://relay1.example.com';
const RELAY2 = 'wss://relay2.example.com';
const RELAY3 = 'wss://relay3.example.com';
const INVALID_REQUEST_MSG = 'must be an array';

describe('RelayUrl', () => {
  describe('normalizeRelayUrls', () => {
    it('should normalize valid relay URLs', () => {
      const input = [RELAY_DAMUS, RELAY_SNORT];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(RELAY_DAMUS);
      expect(result[1]).toBe(RELAY_SNORT);
    });

    it('should convert ws:// to wss://', () => {
      const input = ['ws://relay.example.com'];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(RELAY_EXAMPLE);
    });

    it('should convert http:// to wss://', () => {
      const input = ['http://relay.example.com'];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(RELAY_EXAMPLE);
    });

    it('should convert https:// to wss://', () => {
      const input = ['https://relay.example.com'];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(RELAY_EXAMPLE);
    });

    it('should remove trailing slashes', () => {
      const input = ['wss://relay.damus.io/', 'wss://relay.snort.social///'];
      const result = normalizeRelayUrls(input);
      expect(result[0]).toBe(RELAY_DAMUS);
      expect(result[1]).toBe(RELAY_SNORT);
    });

    it('should trim whitespace', () => {
      const input = ['  wss://relay.damus.io  ', '  wss://relay.snort.social  '];
      const result = normalizeRelayUrls(input);
      expect(result[0]).toBe(RELAY_DAMUS);
      expect(result[1]).toBe(RELAY_SNORT);
    });

    it('should deduplicate URLs', () => {
      const input = [RELAY_DAMUS, RELAY_DAMUS, RELAY_SNORT, RELAY_DAMUS];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(RELAY_DAMUS);
      expect(result[1]).toBe(RELAY_SNORT);
    });

    it('should enforce max relay limit of 12', () => {
      const input = Array.from({ length: 20 }, (_, i) => `wss://relay${i}.example.com`);
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(12);
    });

    it('should reject invalid URLs', () => {
      const input = ['not-a-url', 'ftp://invalid.com'];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(0);
    });

    it('should reject non-wss protocols after conversion attempt', () => {
      const input = ['ftp://invalid.com', 'file://invalid.com'];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = normalizeRelayUrls([]);
      expect(result).toHaveLength(0);
    });

    it('should filter out non-string values', () => {
      const input = [RELAY_DAMUS, 123, null, undefined, RELAY_SNORT];
      const result = normalizeRelayUrls(input as unknown as string[]);
      expect(result).toHaveLength(2);
    });

    it('should throw on non-array input', () => {
      expect(() => normalizeRelayUrls(null as unknown as string[])).toThrow(INVALID_REQUEST_MSG);
      expect(() => normalizeRelayUrls(undefined as unknown as string[])).toThrow(
        INVALID_REQUEST_MSG
      );
      expect(() => normalizeRelayUrls('string' as unknown as string[])).toThrow(
        INVALID_REQUEST_MSG
      );
    });

    it('should preserve order of valid URLs', () => {
      const input = [RELAY1, RELAY2, RELAY3];
      const result = normalizeRelayUrls(input);
      expect(result[0]).toBe(RELAY1);
      expect(result[1]).toBe(RELAY2);
      expect(result[2]).toBe(RELAY3);
    });

    it('should handle URLs with ports', () => {
      const RELAY_WITH_PORT = 'wss://relay.example.com:8080';
      const input = [`${RELAY_EXAMPLE}:443`, RELAY_WITH_PORT];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(2);
      // URL constructor removes default port 443, but keeps non-default ports
      expect(result[0]).toMatch(/^wss:\/\/relay\.example\.com/);
      expect(result[1]).toBe(RELAY_WITH_PORT);
    });

    it('rejects private, loopback, and credentialed relay URLs', () => {
      expect(() => normalizeRelayUrls(['wss://127.0.0.1'])).toThrow(/not allowed/);
      expect(() => normalizeRelayUrls(['wss://localhost'])).toThrow(/not allowed/);
      expect(() => normalizeRelayUrls(['http://169.254.169.254'])).toThrow(/not allowed/);
      expect(() => normalizeRelayUrls(['wss://user:pass@relay.example.com'])).toThrow(
        /not allowed/
      );
    });

    it('allows private relay URLs only when explicitly enabled', () => {
      const result = normalizeRelayUrls(['ws://127.0.0.1:8080'], {
        allowPrivateNetworks: true,
      });
      expect(result).toEqual(['wss://127.0.0.1:8080']);
    });

    it('should handle URLs with paths', () => {
      const RELAY_WITH_PATH1 = `${RELAY_EXAMPLE}/path`;
      const RELAY_WITH_PATH2 = `${RELAY_EXAMPLE}/another/path`;
      const input = [RELAY_WITH_PATH1, RELAY_WITH_PATH2];
      const result = normalizeRelayUrls(input);
      expect(result).toHaveLength(2);
      // Paths should be preserved (though trailing slashes removed)
      expect(result[0]).toBe(RELAY_WITH_PATH1);
      expect(result[1]).toBe(RELAY_WITH_PATH2);
    });
  });

  describe('cleanUrls', () => {
    it('should clean valid URLs', () => {
      const input = ['https://example.com', 'http://test.com'];
      const result = cleanUrls(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('https://example.com');
      expect(result[1]).toBe('http://test.com');
    });

    it('should filter out invalid URLs', () => {
      const input = ['not-a-url', 'invalid-url'];
      const result = cleanUrls(input);
      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = cleanUrls([]);
      expect(result).toHaveLength(0);
    });

    it('should handle non-array input', () => {
      expect(cleanUrls(null as unknown as string[])).toHaveLength(0);

      expect(cleanUrls(undefined as unknown as string[])).toHaveLength(0);
    });
  });
});
