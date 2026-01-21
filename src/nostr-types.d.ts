// Type definitions for nostr-tools
declare module 'nostr-tools' {
  export interface Event {
    id: string;
    kind: number;
    pubkey: string;
    created_at: number;
    content: string;
    tags: string[][];
    sig: string;
  }

  export interface Relay {
    connect(): Promise<void>;
    close(): void;
    publish(event: Event): PublishResult;
    sub(filters: Filter[]): Subscription;
    on(event: 'connect' | 'error', handler: (...args: any[]) => void): void;
  }

  export interface PublishResult {
    on(event: 'ok' | 'failed', handler: (reason?: string) => void): void;
  }

  export interface Subscription {
    on(event: 'event', handler: (event: Event) => void): void;
    unsub(): void;
  }

  export interface Filter {
    ids?: string[];
    kinds?: number[];
    authors?: string[];
    limit?: number;
    [key: string]: any;
  }

  export function relayInit(url: string): Relay;
}
