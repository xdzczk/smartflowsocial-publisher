import type { Event, Filter } from 'nostr-tools';

import type { RelayUrl } from './types';

/**
 * Subscription interface for profile fetching
 */
export interface RelaySubscription {
  /**
   * Close the subscription
   */
  close(): void;
}

/**
 * Relay connection interface
 * Abstracts the connection lifecycle
 */
export interface RelayConnection {
  /**
   * Connect to the relay
   * @throws Error if connection fails
   */
  connect(): Promise<void>;

  /**
   * Publish an event to the relay
   * @param event The event to publish
   * @returns Promise that resolves when event is published
   * @throws Error if publish fails
   */
  publish(event: Event): Promise<void>;

  /**
   * Subscribe to events matching filters
   * @param filters Array of filters
   * @param callbacks Event callbacks
   * @returns Subscription that can be closed
   */
  subscribe(
    filters: Filter[],
    callbacks: {
      onevent: (event: Event) => void;
      onclose?: (reason: string) => void;
    }
  ): RelaySubscription;

  /**
   * Close the connection
   */
  close(): void;

  /**
   * Check if the connection is currently open
   */
  get connected(): boolean;
}

/**
 * Relay interface
 * Abstracts nostr-tools Relay implementation
 */
export interface Relay {
  /**
   * The relay URL
   */
  readonly url: RelayUrl;

  /**
   * Create a connection to this relay
   * @returns A connection that can be used to publish events
   */
  createConnection(): Promise<RelayConnection>;
}
