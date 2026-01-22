import type { Logger } from '../observability/logger';

/**
 * Rate limit entry tracking request count and window
 */
interface RateLimitEntry {
  count: number;
  resetAt: number; // Timestamp when window resets
}

/**
 * Rate limiter using sliding window algorithm
 * Tracks requests per identifier (IP address or API token)
 */
export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly logger: Logger;

  /**
   * @param maxRequests Maximum requests allowed per window
   * @param windowMs Time window in milliseconds
   * @param logger Logger instance
   */
  constructor(maxRequests: number, windowMs: number, logger: Logger) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.logger = logger;

    // Clean up expired entries periodically
    // In Cloudflare Workers, this runs per-request, so cleanup happens naturally
  }

  /**
   * Cleans up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt < now) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Checks if a request should be allowed
   * @param identifier Client identifier (IP address or API token)
   * @returns Object with allowed status and retry-after seconds if rate limited
   */
  check(identifier: string): {
    allowed: boolean;
    retryAfter?: number;
    remaining?: number;
  } {
    this.cleanup();

    const now = Date.now();
    const entry = this.entries.get(identifier);

    if (!entry) {
      // First request - create entry
      this.entries.set(identifier, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
      };
    }

    // Check if window has expired
    if (entry.resetAt < now) {
      // Reset window
      this.entries.set(identifier, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
      };
    }

    // Check if limit exceeded
    if (entry.count >= this.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      this.logger.warn(`Rate limit exceeded for ${identifier}, retry after ${retryAfter}s`);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
      };
    }

    // Increment count
    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
    };
  }

  /**
   * Gets current rate limit status for an identifier
   * @param identifier Client identifier
   * @returns Current count and reset time, or null if no entry
   */
  getStatus(identifier: string): { count: number; resetAt: number } | null {
    this.cleanup();
    return this.entries.get(identifier) ?? null;
  }
}
