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


  export interface PublishResult {
    on(_event: 'ok' | 'failed', _handler: (_reason?: string) => void): void;
  }

  export interface Subscription {
    on(_event: 'event', _handler: (_event: Event) => void): void;
    unsub(): void;
  }

  export interface Filter {
    ids?: string[];
    kinds?: number[];
    authors?: string[];
    limit?: number;
    [key: string]: unknown;
  }

  export class Relay {
    constructor(url: string);
    connect(): Promise<void>;
    close(): void;
    publish(_event: Event): PublishResult;
    sub(_filters: Filter[]): Subscription;
    on(_event: 'connect' | 'error' | 'disconnect', _handler: (..._args: unknown[]) => void): void;
  }
}
