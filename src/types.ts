import type { KVNamespace } from '@cloudflare/workers-types';

// Environment interface for Cloudflare Workers
export interface Env {
  API_TOKEN?: string;
  PROFILES: KVNamespace;
  // Rate limiting configuration (optional)
  RATE_LIMIT_REQUESTS?: string; // Max requests per window (default: 100)
  RATE_LIMIT_WINDOW_MS?: string; // Window size in milliseconds (default: 60000 = 1 minute)
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
