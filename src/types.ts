import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import type { Event } from 'nostr-tools';

// Environment interface for Cloudflare Workers
export interface Env {
  API_TOKEN?: string;
  PROFILES: KVNamespace;
}

// Request body types
export interface PublishRequest {
  relays: string[];
  event: Event;
}

export interface ProfileRequest {
  relays: string[];
  pubkey: string;
}

// Cache metadata interface
export interface CacheMetadata {
  createdAt: number;
}

// Type alias for relay URLs
export type RelayUrl = string;

// Helper type for KV cache result
export interface CacheResult {
  value: string | null;
  metadata: CacheMetadata | null;
}
