import { Relay as NostrRelay } from 'nostr-tools';
import type { Event, Filter } from 'nostr-tools';

import type { Relay, RelayConnection, RelaySubscription } from '../../core/Relay';
import type { RelayUrl } from '../../core/types';

/**
 * NOSTR relay subscription wrapper
 */
class NostrRelaySubscription implements RelaySubscription {
  private subscription: ReturnType<typeof NostrRelay.prototype.subscribe>;

  constructor(subscription: ReturnType<typeof NostrRelay.prototype.subscribe>) {
    this.subscription = subscription;
  }

  close(): void {
    this.subscription.close();
  }
}

/**
 * NOSTR relay connection implementation
 * Wraps nostr-tools Relay connection
 */
class NostrRelayConnection implements RelayConnection {
  private relay: NostrRelay;
  private isConnected = false;

  constructor(relay: NostrRelay) {
    this.relay = relay;
  }

  async connect(): Promise<void> {
    await this.relay.connect();
    this.isConnected = true;
  }

  async publish(event: Event): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected');
    }
    await this.relay.publish(event);
  }

  subscribe(
    filters: Filter[],
    callbacks: {
      onevent: (event: Event) => void;
      onclose?: (reason: string) => void;
    }
  ): RelaySubscription {
    const subscription = this.relay.subscribe(filters, {
      onevent: callbacks.onevent,
      onclose: callbacks.onclose,
    });
    return new NostrRelaySubscription(subscription);
  }

  close(): void {
    this.relay.close();
    this.isConnected = false;
  }

  get connected(): boolean {
    return this.isConnected && this.relay.connected;
  }
}

/**
 * NOSTR relay adapter
 * Implements the Relay interface using nostr-tools
 */
export class NostrRelayAdapter implements Relay {
  readonly url: RelayUrl;
  private nostrRelay: NostrRelay;

  constructor(url: string) {
    // Cast to RelayUrl - validation should happen at transport layer
    this.url = url as RelayUrl;
    this.nostrRelay = new NostrRelay(this.url);
  }

  async createConnection(): Promise<RelayConnection> {
    return new NostrRelayConnection(this.nostrRelay);
  }
}
