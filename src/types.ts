import type { KVNamespace } from '@cloudflare/workers-types';

// Environment interface for Cloudflare Workers
export interface Env {
  API_TOKEN?: string;
  PROFILES: KVNamespace;
}

// Cache metadata interface
export interface CacheMetadata {
  createdAt: number;
}

// Helper type for KV cache result
export interface CacheResult {
  value: string | null;
  metadata: CacheMetadata | null;
}
