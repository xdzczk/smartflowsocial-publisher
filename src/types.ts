import type { KVNamespace } from '@cloudflare/workers-types';
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
  correlationId?: string;
  returnPerRelayResults?: boolean;
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

// Publish response types
export interface RelayPublishResult {
  relay: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface PublishResponse {
  results: RelayPublishResult[];
}

export interface ErrorResponse {
  error: string;
}
