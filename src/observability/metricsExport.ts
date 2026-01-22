/**
 * Interface for exporting metrics to external services
 */
export interface MetricsExporter {
  /**
   * Exports metrics data
   * @param _metrics Current metrics state (may be unused in no-op implementations)
   */
  export(_metrics: {
    counters: Map<string, number>;
    histograms: Map<string, number[]>;
    gauges: Map<string, number>;
  }): Promise<void> | void;
}

/**
 * Cloudflare Analytics exporter
 * Uses Cloudflare's built-in analytics API
 */
export class CloudflareAnalyticsExporter implements MetricsExporter {
  export(_metrics: {
    counters: Map<string, number>;
    histograms: Map<string, number[]>;
    gauges: Map<string, number>;
  }): void {
    // Metrics parameter is intentionally unused - this is a no-op implementation
    // that could be extended in the future to send to Cloudflare Analytics Engine
    void _metrics;
    // Cloudflare Workers automatically collect metrics via console.log
    // In production, you could integrate with Cloudflare Analytics Engine
    // For now, this is a no-op as metrics are already logged via LoggerMetrics
    // Future: Could send to Cloudflare Analytics Engine API
  }
}

/**
 * Null exporter (no-op, useful for testing or when export is disabled)
 */
export class NullMetricsExporter implements MetricsExporter {
  export(): void {
    // No-op
  }
}

/**
 * Creates a metrics exporter based on environment configuration
 * @param env Environment variables
 * @returns Metrics exporter instance
 */
export function createMetricsExporter(env?: {
  METRICS_EXPORT_ENABLED?: string;
}): MetricsExporter | null {
  if (env?.METRICS_EXPORT_ENABLED === 'true') {
    return new CloudflareAnalyticsExporter();
  }
  return null;
}
