import type { KVNamespace } from '@cloudflare/workers-types';

// Environment interface for Cloudflare Workers
export interface Env {
  API_TOKEN?: string;
  PROFILES: KVNamespace;
  // Rate limiting configuration (optional)
  RATE_LIMIT_REQUESTS?: string; // Max requests per window (default: 100)
  RATE_LIMIT_WINDOW_MS?: string; // Window size in milliseconds (default: 60000 = 1 minute)
  // CORS configuration (optional)
  CORS_ENABLED?: string; // 'true' to enable CORS (default: disabled)
  CORS_ORIGINS?: string; // Comma-separated list of allowed origins (e.g., "https://example.com,https://app.example.com")
  // Metrics export configuration (optional)
  METRICS_EXPORT_ENABLED?: string; // 'true' to enable metrics export (default: disabled)
  METRICS_EXPORT_INTERVAL_MS?: string; // Export interval in milliseconds (default: 60000 = 1 minute)
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
