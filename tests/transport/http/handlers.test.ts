import type { ExecutionContext } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchProfile } from '../../../src/core/ProfileEngine';
import { publishSignedEventStreaming } from '../../../src/core/PublishEngine';
import { profileHandler, publishHandler } from '../../../src/transport/http/handlers';
import type { Env } from '../../../src/types';
import { createSignedEvent } from '../../utils/fixtures';
import { readJson } from '../../utils/readJson';

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
  publishSignedEventStreaming: vi.fn(async (_event, _relays, _policy, _logger, onResult) => {
    onResult({
      relay: 'wss://relay1.example.com',
      status: 'success',
      latencyMs: 25,
    });
    return {
      status: 'success' as const,
      relays: [
        {
          relay: 'wss://relay1.example.com' as const,
          status: 'success' as const,
          latencyMs: 25,
        },
      ],
    };
  }),
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
      get: vi.fn().mockResolvedValue(null),
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
    vi.mocked(mockEnv.PROFILES.get).mockResolvedValue(null as never);
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

      const body = (await response.json()) as { results: unknown[] };
      expect(body.results).toBeDefined();
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBeGreaterThan(0);
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

    it('should stream relay results when the client accepts event streams', async () => {
      const event = createSignedEvent();
      const request = new Request('http://localhost/publish?stream=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          relays: [RELAY1_URL],
          event,
        }),
      });

      const response = await publishHandler(request, mockEnv, mockCtx, 'corr-sse');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const body = await response.text();
      expect(body).toContain('event: result');
      expect(body).toContain('event: progress');
      expect(body).toContain('event: complete');
      expect(body).toContain(RELAY1_URL);
    });

    it('should stream an error event when publishing fails', async () => {
      vi.mocked(publishSignedEventStreaming).mockRejectedValueOnce(new Error('stream broke'));
      const request = new Request(LOCALHOST_PUBLISH, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ relays: [RELAY1_URL], event: createSignedEvent() }),
      });

      const response = await publishHandler(request, mockEnv, mockCtx, 'sse-error');
      const body = await response.text();
      expect(body).toContain('event: error');
      expect(body).toContain('stream broke');
    });

    it('should count a failed relay inside the event stream', async () => {
      vi.mocked(publishSignedEventStreaming).mockImplementationOnce(
        async (_event, _relays, _policy, _logger, onResult) => {
          onResult({
            relay: RELAY1_URL as never,
            status: 'failure',
            latencyMs: 5,
            error: 'rejected',
          });
          return { status: 'failed', relays: [] };
        }
      );
      const request = new Request(`${LOCALHOST_PUBLISH}?stream=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relays: [RELAY1_URL], event: createSignedEvent() }),
      });

      const response = await publishHandler(request, mockEnv, mockCtx);
      const body = await response.text();
      expect(body).toContain('"ok":false');
    });

    it('should attach the correlation id when publishing fails', async () => {
      const response = await publishHandler(
        new Request(LOCALHOST_PUBLISH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
        mockEnv,
        mockCtx,
        'publish-bad-json'
      );
      expect(response.status).toBe(400);
      const body = await readJson<{ details?: { correlationId?: string } }>(response);
      expect(body.details?.correlationId).toBe('publish-bad-json');
    });

    it('should reject an event that was already published', async () => {
      vi.mocked(mockEnv.PROFILES.get).mockResolvedValueOnce('seen' as never);
      const response = await publishHandler(
        new Request(LOCALHOST_PUBLISH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relays: [RELAY1_URL], event: createSignedEvent() }),
        }),
        mockEnv,
        mockCtx
      );
      expect(response.status).toBe(409);
    });

    it('should reject a body over the one megabyte limit', async () => {
      const request = new Request(LOCALHOST_PUBLISH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(1024 * 1024 + 1),
      });

      const response = await publishHandler(request, mockEnv, mockCtx, 'too-big');
      expect(response.status).toBe(400);
      const body = await readJson<{ error: string }>(response);
      expect(body.error).toContain('too large');
    });
  });

  describe('profileHandler', () => {
    it('should return 200 for cached profile', async () => {
      const cachedProfile = createSignedEvent({ kind: 0 });
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
      const staleTime = Date.now() - 4 * 60 * 60 * 1000;
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

    it('should reject a profile pubkey that cannot be normalized', async () => {
      const response = await profileHandler(
        new Request(LOCALHOST_PROFILE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relays: [RELAY1_URL], pubkey: 'npub1not-valid' }),
        }),
        mockEnv,
        mockCtx,
        'bad-key'
      );
      expect(response.status).toBe(400);
    });

    it('should reject profile JSON that does not parse', async () => {
      const response = await profileHandler(
        new Request(LOCALHOST_PROFILE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
        mockEnv,
        mockCtx
      );
      expect(response.status).toBe(400);
    });

    it('should include the correlation id when the profile cache throws', async () => {
      vi.mocked(mockEnv.PROFILES.getWithMetadata).mockRejectedValueOnce(new Error('kv down'));
      const response = await profileHandler(
        new Request(LOCALHOST_PROFILE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relays: [RELAY1_URL], pubkey: TEST_PUBKEY }),
        }),
        mockEnv,
        mockCtx,
        'profile-kv'
      );
      expect(response.status).toBe(500);
      const body = await readJson<{ details?: { correlationId?: string } }>(response);
      expect(body.details?.correlationId).toBe('profile-kv');
    });

    it('should ignore a background refresh that finds no profile event', async () => {
      vi.mocked(mockEnv.PROFILES.getWithMetadata).mockImplementationOnce(
        () => Promise.resolve({ value: null, metadata: null }) as never
      );
      vi.mocked(fetchProfile).mockResolvedValueOnce({
        pubkey: TEST_PUBKEY,
        event: null,
        relays: [],
      });

      const response = await profileHandler(
        new Request(LOCALHOST_PROFILE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relays: [RELAY1_URL], pubkey: TEST_PUBKEY }),
        }),
        mockEnv,
        mockCtx
      );
      expect(response.status).toBe(202);
      const pending = vi.mocked(mockCtx.waitUntil).mock.calls.at(-1)?.[0];
      await pending;
    });
  });
});
