/**
 * Rate Limiting Security Tests
 *
 * Tests that the application properly rate limits requests
 * to prevent DoS attacks and abuse.
 */

import { describe, expect, it, vi } from 'vitest';

import { RateLimiter } from '../../src/middleware/rateLimiter';
import { createMockLogger } from '../utils/testHelpers';

describe('Rate Limiting: Sliding Window Algorithm', () => {
  describe('RateLimiter', () => {
    it('should allow requests within limit', () => {
      const logger = createMockLogger();
      const limiter = new RateLimiter(100, 60000, logger); // 100 requests per 60s

      const result = limiter.check('client-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('should block requests exceeding limit', () => {
      const logger = createMockLogger();
      const limiter = new RateLimiter(5, 60000, logger); // 5 requests per 60s

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        const result = limiter.check('client-1');
        expect(result.allowed).toBe(true);
      }

      // 6th request should be blocked
      const result = limiter.check('client-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(result.remaining).toBe(0);
    });

    it('should track requests per client identifier', () => {
      const logger = createMockLogger();
      const limiter = new RateLimiter(5, 60000, logger);

      // Client 1 makes requests
      limiter.check('client-1');
      limiter.check('client-1');
      limiter.check('client-1');

      // Client 2 should have separate limit
      const result = limiter.check('client-2');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Client 2's own limit
    });

    it('should reset window after expiration', () => {
      vi.useFakeTimers();
      const logger = createMockLogger();
      const limiter = new RateLimiter(5, 1000, logger); // 5 requests per 1s

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        limiter.check('client-1');
      }

      // 6th request should be blocked
      let result = limiter.check('client-1');
      expect(result.allowed).toBe(false);

      // Advance time past window
      vi.advanceTimersByTime(1001);

      // Request should now be allowed (window reset)
      result = limiter.check('client-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      vi.useRealTimers();
    });

    it('should provide Retry-After header value', () => {
      const logger = createMockLogger();
      const limiter = new RateLimiter(1, 60000, logger); // 1 request per 60s

      // Make 1 request (at limit)
      limiter.check('client-1');

      // 2nd request should be blocked with retry-after
      const result = limiter.check('client-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(typeof result.retryAfter).toBe('number');
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should clean up expired entries', () => {
      vi.useFakeTimers();
      const logger = createMockLogger();
      const limiter = new RateLimiter(5, 1000, logger);

      // Make requests for multiple clients
      limiter.check('client-1');
      limiter.check('client-2');
      limiter.check('client-3');

      // Advance time past window
      vi.advanceTimersByTime(1001);

      // Cleanup should happen on next check
      limiter.check('client-4');

      // Status should show only client-4 has an entry
      const status1 = limiter.getStatus('client-1');
      const status4 = limiter.getStatus('client-4');

      expect(status1).toBeNull(); // Expired and cleaned up
      expect(status4).not.toBeNull(); // Still active

      vi.useRealTimers();
    });

    it('should track by IP address', () => {
      const logger = createMockLogger();
      const limiter = new RateLimiter(10, 60000, logger);

      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.2';

      limiter.check(ip1);
      limiter.check(ip1);
      limiter.check(ip2);

      const status1 = limiter.getStatus(ip1);
      const status2 = limiter.getStatus(ip2);

      expect(status1?.count).toBe(2);
      expect(status2?.count).toBe(1);
    });

    it('should track by API token', () => {
      const logger = createMockLogger();
      const limiter = new RateLimiter(10, 60000, logger);

      const token1 = 'token-abc-123';
      const token2 = 'token-xyz-456';

      limiter.check(token1);
      limiter.check(token1);
      limiter.check(token2);

      const status1 = limiter.getStatus(token1);
      const status2 = limiter.getStatus(token2);

      expect(status1?.count).toBe(2);
      expect(status2?.count).toBe(1);
    });
  });
});
