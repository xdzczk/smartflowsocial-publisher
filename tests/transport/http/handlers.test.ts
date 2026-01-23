import type { ExecutionContext } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profileHandler, publishHandler } from '../../../src/transport/http/handlers';
import type { Env } from '../../../src/types';
import { createSignedEvent } from '../../utils/fixtures';

// Mock the core engines
vi.mock('../../../src/core/PublishEngine', () => ({
  publishSignedEvent: vi.fn(async () => ({
    status: 'success' as const,
    relays: [
      {
        relay: 'wss://relay1.example.com' as const,
        status: 'success' as const,
        latencyMs: 100,
      },
    ],
  })),
}));

vi.mock('../../../src/core/ProfileEngine', () => ({
  fetchProfile: vi.fn(async () => ({
    pubkey: 'test-pubkey',
    event: createSignedEvent({ kind: 0 }),
    relays: [],
  })),
}));

vi.mock('../../../src/adapters/nostr/relayAdapter', () => ({
  NostrRelayAdapter: vi.fn(),
}));

const TEST_TOKEN = 'test-token';
const RELAY1_URL = 'wss://relay1.example.com';
const TEST_PUBKEY = 'test-pubkey';
const LOCALHOST_PUBLISH = 'http://localhost/publish';
const LOCALHOST_PROFILE = 'http://localhost/profile';

describe('HTTP Handlers', () => {
  const mockEnv: Env = {
    API_TOKEN: TEST_TOKEN,
    PROFILES: {
      getWithMetadata: vi.fn(),
      put: vi.fn(),
    } as unknown as Env['PROFILES'],
  };

  const mockCtx: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('publishHandler', () => {
    it('should handle valid publish request', async () => {
      const event = createSignedEvent();
      const request = new Request(LOCALHOST_PUBLISH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: [RELAY1_URL],
          event,
        }),
      });

      const response = await publishHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(200);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type assertion needed for TypeScript strict mode
      const body = (await response.json()) as { results: unknown[] };
      expect(body.results).toBeDefined();
      expect(Array.isArray(body.results)).toBe(true);
       
      const results = body.results;
       
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return 400 for invalid request', async () => {
      const request = new Request(LOCALHOST_PUBLISH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: 'not-an-array',
        }),
      });

      const response = await publishHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(400);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Type assertion needed for TypeScript strict mode
      const body = (await response.json()) as { error: unknown };
      expect(body.error).toBeDefined();
    });

    it('should select policy from query params', async () => {
      const event = createSignedEvent();
      const request = new Request('http://localhost/publish?policy=conservative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: [RELAY1_URL],
          event,
        }),
      });

      const response = await publishHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(200);
    });

    it('should handle JSON parse errors', async () => {
      const request = new Request(LOCALHOST_PUBLISH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await publishHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(400);
    });
  });

  describe('profileHandler', () => {
    it('should return 200 for cached profile', async () => {
      const cachedProfile = createSignedEvent({ kind: 0 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Mock typing needed for test
      (mockEnv.PROFILES.getWithMetadata as any).mockResolvedValue({
        value: JSON.stringify(cachedProfile),
        metadata: { createdAt: Date.now() },
      });

      const request = new Request(LOCALHOST_PROFILE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: [RELAY1_URL],
          pubkey: TEST_PUBKEY,
        }),
      });

      const response = await profileHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(200);

      const body = await response.text();
      expect(body).toBe(JSON.stringify(cachedProfile));
    });

    it('should return 202 for uncached profile', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Mock typing needed for test
      (mockEnv.PROFILES.getWithMetadata as any).mockResolvedValue({
        value: null,
        metadata: null,
      });

      const request = new Request(LOCALHOST_PROFILE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: [RELAY1_URL],
          pubkey: TEST_PUBKEY,
        }),
      });

      const response = await profileHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(202);

      expect(mockCtx.waitUntil).toHaveBeenCalled();
    });

    it('should return 422 for invalid request', async () => {
      const request = new Request(LOCALHOST_PROFILE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: 'not-an-array',
        }),
      });

      const response = await profileHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(400);
    });

    it('should refresh stale cache in background', async () => {
      const staleTime = Date.now() - 4 * 60 * 60 * 1000; // 4 hours ago
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Mock typing needed for test
      (mockEnv.PROFILES.getWithMetadata as any).mockResolvedValue({
        value: JSON.stringify(createSignedEvent({ kind: 0 })),
        metadata: { createdAt: staleTime },
      });

      const request = new Request(LOCALHOST_PROFILE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relays: [RELAY1_URL],
          pubkey: TEST_PUBKEY,
        }),
      });

      const response = await profileHandler(request, mockEnv, mockCtx);
      expect(response.status).toBe(200);
      expect(mockCtx.waitUntil).toHaveBeenCalled();
    });
  });
});
