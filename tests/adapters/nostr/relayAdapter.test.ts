import type { Event, Filter } from 'nostr-tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NostrRelayAdapter } from '../../../src/adapters/nostr/relayAdapter';

// Mock nostr-tools
vi.mock('nostr-tools', () => {
  class MockNostrRelay {
    public connected = false;
    public url: string;

    constructor(url: string) {
      this.url = url;
    }

    async connect(): Promise<void> {
      this.connected = true;
    }

    async publish(_event: Event): Promise<string> {
      if (!this.connected) {
        throw new Error('Not connected');
      }
      return 'ok';
    }

    subscribe(
      _filters: Filter[],
      _callbacks?: {
        onevent?: (_event: Event) => void;
        onclose?: (_reason: string) => void;
      }
    ) {
      return {
        close: vi.fn(),
      };
    }

    close(): void {
      this.connected = false;
    }
  }

  return {
    Relay: MockNostrRelay,
  };
});

const RELAY_URL = 'wss://relay.example.com';

describe('NostrRelayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with URL', () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      expect(adapter.url).toBe(RELAY_URL);
    });
  });

  describe('createConnection', () => {
    it('should create a connection', async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const connection = await adapter.createConnection();
      expect(connection).toBeDefined();
    });

    it('should create connection that can connect', async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const connection = await adapter.createConnection();
      await connection.connect();
      expect(connection.connected).toBe(true);
    });

    const TEST_EVENT: Event = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      content: 'test',
      tags: [],
      sig: 'test-sig',
    };

    it('should create connection that can publish', async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const connection = await adapter.createConnection();
      await connection.connect();
      await expect(connection.publish(TEST_EVENT)).resolves.not.toThrow();
    });

    it('should throw if publishing without connection', async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const connection = await adapter.createConnection();
      await expect(connection.publish(TEST_EVENT)).rejects.toThrow('Not connected');
    });

    it('should create connection that can subscribe', async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const connection = await adapter.createConnection();
      await connection.connect();

      const filters: Filter[] = [{ kinds: [0] }];
      const callbacks = {
        onevent: vi.fn(),
        onclose: vi.fn(),
      };

      const subscription = connection.subscribe(filters, callbacks);
      expect(subscription).toBeDefined();
      expect(typeof subscription.close).toBe('function');
    });

    it('should create connection that can close', async () => {
      const adapter = new NostrRelayAdapter(RELAY_URL);
      const connection = await adapter.createConnection();
      await connection.connect();
      expect(connection.connected).toBe(true);

      connection.close();
      expect(connection.connected).toBe(false);
    });
  });
});
