import type { Logger } from './logger';

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
  // eslint-disable-next-line no-unused-vars
  increment(name: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Record a histogram value (for latency, sizes, etc.)
   * @param name Metric name
   * @param value Value to record
   * @param tags Optional tags for filtering
   */
  // eslint-disable-next-line no-unused-vars
  histogram(name: string, value: number, tags?: Record<string, string>): void;

  /**
   * Set a gauge value
   * @param name Metric name
   * @param value Current value
   * @param tags Optional tags for filtering
   */
  // eslint-disable-next-line no-unused-vars
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

  // logger is used in methods below
  // eslint-disable-next-line no-unused-vars
  constructor(private logger: Logger) {}

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
  // eslint-disable-next-line no-unused-vars
  increment(_name: string, _value?: number, _tags?: Record<string, string>): void {
    // No-op
  }

  // eslint-disable-next-line no-unused-vars
  histogram(_name: string, _value: number, _tags?: Record<string, string>): void {
    // No-op
  }

  // eslint-disable-next-line no-unused-vars
  gauge(_name: string, _value: number, _tags?: Record<string, string>): void {
    // No-op
  }
}

/**
 * Creates a metrics instance
 * @param logger Logger instance
 * @returns Metrics instance
 */
export function createMetrics(logger: Logger): Metrics {
  return new LoggerMetrics(logger);
}
