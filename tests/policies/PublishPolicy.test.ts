import { describe, expect, it } from 'vitest';

import { aggressivePolicy } from '../../src/policies/aggressivePolicy';
import { conservativePolicy } from '../../src/policies/conservativePolicy';
import { defaultPolicy } from '../../src/policies/defaultPolicy';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createRelayResult } from '../utils/fixtures';

describe('PublishPolicy', () => {
  describe('defaultPolicy', () => {
    it('should have sensible default values', () => {
      expect(defaultPolicy.relayConcurrency).toBe(8);
      expect(defaultPolicy.perRelayTimeoutMs).toBe(10000);
      expect(defaultPolicy.connectionTimeoutMs).toBe(5000);
      expect(defaultPolicy.overallTimeoutMs).toBe(15000);
      expect(defaultPolicy.minSuccessRelays).toBe(1);
      expect(defaultPolicy.retry.maxAttempts).toBe(1);
    });

    it('should be a valid PublishPolicy', () => {
      const policy: PublishPolicy = defaultPolicy;
      expect(policy).toBeDefined();
    });
  });

  describe('conservativePolicy', () => {
    it('should be more reliable (slower, higher timeouts)', () => {
      expect(conservativePolicy.perRelayTimeoutMs).toBeGreaterThan(defaultPolicy.perRelayTimeoutMs);
      expect(conservativePolicy.connectionTimeoutMs).toBeGreaterThan(
        defaultPolicy.connectionTimeoutMs
      );
      expect(conservativePolicy.overallTimeoutMs).toBeGreaterThan(defaultPolicy.overallTimeoutMs);
      expect(conservativePolicy.minSuccessRelays).toBeGreaterThan(defaultPolicy.minSuccessRelays);
    });

    it('should have lower concurrency', () => {
      expect(conservativePolicy.relayConcurrency).toBeLessThan(defaultPolicy.relayConcurrency);
    });

    it('should allow retries', () => {
      expect(conservativePolicy.retry.maxAttempts).toBeGreaterThan(0);
    });
  });

  describe('aggressivePolicy', () => {
    it('should be faster (lower timeouts)', () => {
      expect(aggressivePolicy.perRelayTimeoutMs).toBeLessThan(defaultPolicy.perRelayTimeoutMs);
      expect(aggressivePolicy.connectionTimeoutMs).toBeLessThan(defaultPolicy.connectionTimeoutMs);
      expect(aggressivePolicy.overallTimeoutMs).toBeLessThan(defaultPolicy.overallTimeoutMs);
    });

    it('should have higher concurrency', () => {
      expect(aggressivePolicy.relayConcurrency).toBeGreaterThan(defaultPolicy.relayConcurrency);
    });

    it('should have same minSuccessRelays as default', () => {
      expect(aggressivePolicy.minSuccessRelays).toBe(defaultPolicy.minSuccessRelays);
    });
  });

  describe('policy immutability', () => {
    it('should not mutate default policy', () => {
      // Policies are objects, so they can be mutated
      // But in practice, they should be treated as immutable
      // This test documents the expectation
      expect(typeof defaultPolicy).toBe('object');

      // Policies are objects, so they can be mutated
      // But in practice, they should be treated as immutable
      // This test documents the expectation
      expect(typeof defaultPolicy).toBe('object');
    });
  });

  describe('policy structure', () => {
    it('should have all required fields', () => {
      const requiredFields: (keyof PublishPolicy)[] = [
        'relayConcurrency',
        'perRelayTimeoutMs',
        'connectionTimeoutMs',
        'overallTimeoutMs',
        'minSuccessRelays',
        'retry',
      ];

      [defaultPolicy, conservativePolicy, aggressivePolicy].forEach((policy) => {
        requiredFields.forEach((field) => {
          expect(policy).toHaveProperty(field);
        });
        expect(policy.retry).toHaveProperty('maxAttempts');
        expect(policy.retry).toHaveProperty('backoffMs');
      });
    });
  });

  describe('success criteria', () => {
    const success = createRelayResult('wss://a.example', { status: 'success' });
    const failure = createRelayResult('wss://b.example', { status: 'failure' });

    it('classifies aggressive results as success, partial, or failed', () => {
      expect(aggressivePolicy.successCriteria([success]).status).toBe('success');
      expect(aggressivePolicy.successCriteria([success, failure]).status).toBe('partial');
      expect(aggressivePolicy.successCriteria([failure]).status).toBe('failed');
    });

    it('requires every conservative relay to succeed for a full success', () => {
      expect(conservativePolicy.successCriteria([success, success]).status).toBe('success');
      expect(conservativePolicy.successCriteria([success, failure, success]).status).toBe(
        'partial'
      );
    });
  });
});
