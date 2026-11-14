import type { ExecutionContext } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publishBatch } from '../../../src/core/BatchPublisher';
import { checkAndRecordEvent } from '../../../src/security/replayProtection';
import { batchPublishHandler } from '../../../src/transport/http/handlers';
import type { Env } from '../../../src/types';
import { createSignedEvent } from '../../utils/fixtures';
import { readJson } from '../../utils/readJson';

vi.mock('../../../src/core/BatchPublisher', () => ({
  publishBatch: vi.fn(async () => ({
    results: [{ eventId: 'a'.repeat(64), outcome: { status: 'success', relays: [] } }],
    totalEvents: 1,
    successfulEvents: 1,
    failedEvents: 0,
  })),
}));

vi.mock('../../../src/security/replayProtection', () => ({
  checkAndRecordEvent: vi.fn(async () => false),
}));

vi.mock('../../../src/security/eventSignature', () => ({
  assertEventSignature() {
    /* real signature checks live in tests/security/event-signature.test.ts */
  },
}));

vi.mock('../../../src/adapters/nostr/relayAdapter', () => ({
  NostrRelayAdapter: vi.fn(function MockAdapter(this: { url: string }, url: string) {
    this.url = url;
  }),
}));

const mockedBatch = vi.mocked(publishBatch);
const mockedReplay = vi.mocked(checkAndRecordEvent);

describe('batchPublishHandler', () => {
  const env: Env = {
    API_TOKEN: 'token',
    PROFILES: {
      get: vi.fn(),
      put: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as Env['PROFILES'],
  };
  const ctx: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };

  beforeEach(() => {
    mockedReplay.mockReset();
    mockedReplay.mockResolvedValue(false);
    mockedBatch.mockClear();
  });

  function request(body: unknown, url = 'http://localhost/batch?policy=aggressive'): Request {
    return new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('publishes a valid batch and returns the publisher result', async () => {
    const response = await batchPublishHandler(
      request({ relays: ['wss://relay.example.com'], events: [createSignedEvent()] }),
      env,
      ctx,
      'batch-1'
    );

    expect(response.status).toBe(200);
    const body = await readJson<{ successfulEvents: number }>(response);
    expect(body.successfulEvents).toBe(1);
    expect(mockedBatch).toHaveBeenCalledOnce();
    expect(response.headers.get('x-request-id')).toBe('batch-1');
  });

  it('rejects a batch body over ten megabytes', async () => {
    const response = await batchPublishHandler(request('x'.repeat(10 * 1024 * 1024 + 1)), env, ctx);
    expect(response.status).toBe(400);
  });

  it('rejects a body that is not a batch', async () => {
    const response = await batchPublishHandler(request({ events: 'nope' }), env, ctx);
    expect(response.status).toBe(400);
  });

  it('rejects a batch larger than the event cap', async () => {
    const events = Array.from({ length: 201 }, () => createSignedEvent());
    const response = await batchPublishHandler(
      request({ relays: ['wss://relay.example.com'], events }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toContain('Maximum 200');
  });

  it('rejects an empty event list', async () => {
    const response = await batchPublishHandler(
      request({ relays: ['wss://relay.example.com'], events: [] }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toContain('at least one event');
  });

  it('rejects invalid JSON and invalid events', async () => {
    const invalidJson = await batchPublishHandler(request('{'), env, ctx, 'bad-json');
    expect(invalidJson.status).toBe(400);
    const jsonBody = await readJson<{ details?: { correlationId?: string } }>(invalidJson);
    expect(jsonBody.details?.correlationId).toBe('bad-json');

    const invalidEvent = await batchPublishHandler(
      request({ relays: ['wss://relay.example.com'], events: [{ id: 'short' }] }),
      env,
      ctx
    );
    expect(invalidEvent.status).toBe(400);
  });

  it('rejects a batch that repeats an already published event', async () => {
    mockedReplay.mockResolvedValue(true);
    const response = await batchPublishHandler(
      request({ relays: ['wss://relay.example.com'], events: [createSignedEvent()] }),
      env,
      ctx
    );
    expect(response.status).toBe(409);
    expect(mockedBatch).not.toHaveBeenCalled();
  });

  it('rejects relays that do not survive normalization', async () => {
    const response = await batchPublishHandler(
      request({ relays: ['not a relay'], events: [createSignedEvent()] }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toContain('No valid relays');
  });
});
