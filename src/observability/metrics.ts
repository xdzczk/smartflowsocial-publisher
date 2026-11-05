import type { Logger } from './logger';
import type { MetricsExporter } from './metricsExport';

type MetricsExporterType = MetricsExporter;

/**
 * Metric types for tracking
 */
export interface Metrics {
  /**
   * Increment a counter metric
   * @param name Metric name
   * @param value Optional increment value (default: 1)
   * @param tags Optional tags for filtering
   */
  increment(name: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Record a histogram value (for latency, sizes, etc.)
   * @param name Metric name
   * @param value Value to record
   * @param tags Optional tags for filtering
   */
  histogram(name: string, value: number, tags?: Record<string, string>): void;

  /**
   * Set a gauge value
   * @param name Metric name
   * @param value Current value
   * @param tags Optional tags for filtering
   */
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}

/**
 * Metrics implementation using logger
 * In production, this could integrate with Cloudflare Analytics or other services
 */
export class LoggerMetrics implements Metrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private gauges = new Map<string, number>();
  private exporter: MetricsExporter | null = null;
  private exportInterval: number | null = null;
  private lastExportTime = Date.now();

  constructor(
    private readonly logger: Logger,
    exporter?: MetricsExporter | null,
    exportIntervalMs?: number
  ) {
    // Reference logger to satisfy ESLint (logger is used via this.logger in class methods)
    void logger;
    this.exporter = exporter ?? null;
    if (this.exporter && exportIntervalMs && exportIntervalMs > 0) {
      this.exportInterval = exportIntervalMs;
      // Schedule periodic export
      this.scheduleExport();
    }
  }

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    const key = this.getKey(name, tags);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
    this.logger.info(`[METRIC] ${name}: +${value}`, { tags, total: current + value });
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.getKey(name, tags);
    const values = this.histograms.get(key) ?? [];
    values.push(value);
    this.histograms.set(key, values);

    // Calculate percentiles if we have enough samples
    if (values.length >= 10) {
      const sorted = [...values].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
      this.logger.info(`[METRIC] ${name} percentiles`, {
        tags,
        p50,
        p95,
        p99,
        count: values.length,
      });
    } else {
      this.logger.info(`[METRIC] ${name}: ${value}`, { tags });
    }
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.getKey(name, tags);
    this.gauges.set(key, value);
    this.logger.info(`[METRIC] ${name}: ${value}`, { tags });
  }

  /**
   * Gets current counter value
   */
  getCounter(name: string, tags?: Record<string, string>): number {
    return this.counters.get(this.getKey(name, tags)) ?? 0;
  }

  /**
   * Gets current gauge value
   */
  getGauge(name: string, tags?: Record<string, string>): number {
    return this.gauges.get(this.getKey(name, tags)) ?? 0;
  }

  /**
   * Gets histogram values
   */
  getHistogram(name: string, tags?: Record<string, string>): number[] {
    return this.histograms.get(this.getKey(name, tags)) ?? [];
  }

  /**
   * Exports metrics to configured exporter
   */
  private async exportMetrics(): Promise<void> {
    if (!this.exporter) {
      return;
    }

    try {
      await this.exporter.export({
        counters: new Map(this.counters),
        histograms: new Map(this.histograms),
        gauges: new Map(this.gauges),
      });
      this.lastExportTime = Date.now();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to export metrics: ${errorMessage}`);
    }
  }

  /**
   * Schedules periodic metric export
   */
  private scheduleExport(): void {
    if (!this.exporter || !this.exportInterval) {
      return;
    }

    // In Cloudflare Workers, we can't use setInterval
    // Instead, export will be triggered on-demand or at request end
    // This is a placeholder for future implementation
  }

  /**
   * Flushes metrics to exporter immediately
   */
  async flush(): Promise<void> {
    await this.exportMetrics();
  }

  /**
   * Resets all metrics (useful for testing)
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }

  private getKey(name: string, tags?: Record<string, string>): string {
    if (!tags) {
      return name;
    }
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${tagStr}}`;
  }
}

/**
 * Null metrics implementation (no-op, useful for testing)
 */
export class NullMetrics implements Metrics {
  increment(_name: string, _value?: number, _tags?: Record<string, string>): void {
    // No-op
  }

  histogram(_name: string, _value: number, _tags?: Record<string, string>): void {
    // No-op
  }

  gauge(_name: string, _value: number, _tags?: Record<string, string>): void {
    // No-op
  }
}

/**
 * Creates a metrics instance
 * @param logger Logger instance
 * @param env Optional environment variables for metrics export configuration
 * @returns Metrics instance
 */
export async function createMetrics(
  logger: Logger,
  env?: {
    METRICS_EXPORT_ENABLED?: string;
    METRICS_EXPORT_INTERVAL_MS?: string;
  }
): Promise<Metrics> {
  let exporter: MetricsExporterType | null = null;
  if (env?.METRICS_EXPORT_ENABLED === 'true') {
    const metricsExportModule = await import('./metricsExport');
    const { createMetricsExporter } = metricsExportModule;
    exporter = createMetricsExporter(env) ?? null;
  }
  const exportInterval = env?.METRICS_EXPORT_INTERVAL_MS
    ? parseInt(env.METRICS_EXPORT_INTERVAL_MS, 10)
    : undefined;

  return new LoggerMetrics(logger, exporter, exportInterval);
}
