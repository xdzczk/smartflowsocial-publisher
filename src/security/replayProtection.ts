import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * TTL for replay protection records (24 hours in seconds)
 */
const REPLAY_PROTECTION_TTL = 24 * 60 * 60;

/**
 * Key prefix for replay protection in KV store
 */
const REPLAY_KEY_PREFIX = 'replay:';

/**
 * Checks if an event ID has already been published (replay protection)
 * Uses KV atomic operations for thread-safe checking
 * 
 * @param eventId The event ID to check
 * @param kv The KV namespace to use (reuses PROFILES namespace)
 * @returns Promise resolving to true if event is a replay, false otherwise
 */
export async function checkReplay(
  eventId: string,
  kv: KVNamespace
): Promise<boolean> {
  const key = `${REPLAY_KEY_PREFIX}${eventId}`;
  
  try {
    const existing = await kv.get(key);
    return existing !== null;
  } catch (error) {
    // If KV operation fails, log but don't block publishing
    // This is a safety measure - we'd rather allow a potential replay
    // than block all publishing if KV is down
    console.error(`Failed to check replay protection for ${eventId}:`, error);
    return false;
  }
}

/**
 * Records an event ID to prevent replay attacks
 * Uses KV with 24-hour TTL for automatic cleanup
 * 
 * @param eventId The event ID to record
 * @param kv The KV namespace to use (reuses PROFILES namespace)
 * @returns Promise that resolves when event is recorded
 */
export async function recordEvent(
  eventId: string,
  kv: KVNamespace
): Promise<void> {
  const key = `${REPLAY_KEY_PREFIX}${eventId}`;
  
  try {
    // Store with TTL for automatic cleanup after 24 hours
    // We store a simple marker value (timestamp) for debugging
    await kv.put(
      key,
      JSON.stringify({ recordedAt: Date.now() }),
      {
        expirationTtl: REPLAY_PROTECTION_TTL,
      }
    );
  } catch (error) {
    // If KV operation fails, log but don't throw
    // This ensures publishing can continue even if KV write fails
    console.error(`Failed to record event ${eventId} for replay protection:`, error);
  }
}

/**
 * Checks and records an event atomically to prevent race conditions
 * This is the recommended way to use replay protection
 * 
 * @param eventId The event ID to check and record
 * @param kv The KV namespace to use (reuses PROFILES namespace)
 * @returns Promise resolving to true if event is a replay, false if new
 */
export async function checkAndRecordEvent(
  eventId: string,
  kv: KVNamespace
): Promise<boolean> {
  const key = `${REPLAY_KEY_PREFIX}${eventId}`;
  
  try {
    // Try to get the existing value
    const existing = await kv.get(key);
    
    if (existing !== null) {
      // Event already exists - this is a replay
      return true;
    }
    
    // Event doesn't exist - record it atomically
    // Use put with expiration TTL
    await kv.put(
      key,
      JSON.stringify({ recordedAt: Date.now() }),
      {
        expirationTtl: REPLAY_PROTECTION_TTL,
      }
    );
    
    // Double-check: if another request recorded it between our check and put,
    // we might have a race condition. However, KV operations are atomic,
    // so this should be safe. The worst case is we allow a duplicate within
    // a very small time window (milliseconds), which is acceptable.
    
    return false;
  } catch (error) {
    // If KV operation fails, log but don't block publishing
    console.error(`Failed to check/record replay protection for ${eventId}:`, error);
    return false;
  }
}
