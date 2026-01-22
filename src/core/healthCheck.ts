import type { Logger } from '../observability/logger';

import type { Relay } from './Relay';
import type { RelayUrl } from './types';

/**
 * Health status of a relay
 */
export interface RelayHealth {
  relayUrl: RelayUrl;
  healthy: boolean;
  lastChecked: number;
  lastSuccess?: number;
  consecutiveFailures: number;
}

/**
 * Health check manager for relays
 */
export class HealthCheckManager {
  private healthStatus = new Map<RelayUrl, RelayHealth>();

  constructor(private readonly logger: Logger) {}

  /**
   * Records a successful operation for a relay
   */
  recordSuccess(relayUrl: RelayUrl): void {
    const health = this.healthStatus.get(relayUrl) ?? {
      relayUrl,
      healthy: true,
      lastChecked: Date.now(),
      consecutiveFailures: 0,
    };

    health.healthy = true;
    health.lastChecked = Date.now();
    health.lastSuccess = Date.now();
    health.consecutiveFailures = 0;

    this.healthStatus.set(relayUrl, health);
  }

  /**
   * Records a failed operation for a relay
   */
  recordFailure(relayUrl: RelayUrl): void {
    const health = this.healthStatus.get(relayUrl) ?? {
      relayUrl,
      healthy: true,
      lastChecked: Date.now(),
      consecutiveFailures: 0,
    };

    health.consecutiveFailures++;
    health.lastChecked = Date.now();

    // Mark as unhealthy after 3 consecutive failures
    if (health.consecutiveFailures >= 3) {
      health.healthy = false;
      this.logger.warn(`[HealthCheck] ${relayUrl} marked as unhealthy (${health.consecutiveFailures} failures)`);
    }

    this.healthStatus.set(relayUrl, health);
  }

  /**
   * Gets health status for a relay
   */
  getHealth(relayUrl: RelayUrl): RelayHealth | null {
    return this.healthStatus.get(relayUrl) ?? null;
  }

  /**
   * Checks if a relay is healthy
   */
  isHealthy(relayUrl: RelayUrl): boolean {
    const health = this.healthStatus.get(relayUrl);
    return health?.healthy ?? true; // Default to healthy if unknown
  }

  /**
   * Gets all health statuses
   */
  getAllHealth(): RelayHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Performs a health check on a relay
   * @param relay The relay to check
   * @param timeoutMs Timeout for health check
   * @returns True if relay is healthy
   */
  async checkRelayHealth(relay: Relay, timeoutMs: number): Promise<boolean> {
    const relayUrl = relay.url;
    const startTime = Date.now();

    try {
      const connection = await Promise.race([
        relay.createConnection(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
        ),
      ]);

      await Promise.race([
        connection.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
        ),
      ]);

      connection.close();

      const latency = Date.now() - startTime;
      this.logger.info(`[HealthCheck] ${relayUrl} is healthy (${latency}ms)`);
      this.recordSuccess(relayUrl);
      return true;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.warn(
        `[HealthCheck] ${relayUrl} health check failed (${latency}ms): ${error instanceof Error ? error.message : String(error)}`
      );
      this.recordFailure(relayUrl);
      return false;
    }
  }
}
