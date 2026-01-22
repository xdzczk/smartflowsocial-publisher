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

  export interface Filter {
    ids?: string[];
    kinds?: number[];
    authors?: string[];
    limit?: number;
    [key: string]: unknown;
  }

  export interface Subscription {
    onevent: (evt: Event) => void;
    oneose?: () => void;
    onclose?: (reason: string) => void;
    close(reason?: string): void;
  }

  export class Relay {
    constructor(url: string, options?: { enablePing?: boolean; enableReconnect?: boolean });
    static connect(url: string, options?: { enablePing?: boolean; enableReconnect?: boolean }): Promise<Relay>;
    connect(): Promise<void>;
    close(): void;
    publish(event: Event): Promise<string>;
    subscribe(filters: Filter[], params?: { onevent?: (evt: Event) => void; oneose?: () => void; onclose?: (reason: string) => void }): Subscription;
    get connected(): boolean;
  }
}
