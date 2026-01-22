import { describe, expect, it } from 'vitest';

import { classifyPublishOutcome } from '../../src/core/outcomeClassifier';
import { aggressivePolicy } from '../../src/policies/aggressivePolicy';
import { conservativePolicy } from '../../src/policies/conservativePolicy';
import { defaultPolicy } from '../../src/policies/defaultPolicy';
import { createRelayResult } from '../utils/fixtures';

const RELAY1_URL = 'wss://relay1.com';
const RELAY2_URL = 'wss://relay2.com';
const RELAY3_URL = 'wss://relay3.com';

describe('outcomeClassifier', () => {
  describe('classifyPublishOutcome', () => {
    it('should classify success when all relays succeed', () => {
      const results = [
        createRelayResult(RELAY1_URL, { status: 'success' }),
        createRelayResult(RELAY2_URL, { status: 'success' }),
      ];

      const outcome = classifyPublishOutcome(results, defaultPolicy);
      expect(outcome.status).toBe('success');
      expect(outcome.relays).toEqual(results);
    });

    it('should classify partial when some relays succeed (default policy)', () => {
      const results = [
        createRelayResult(RELAY1_URL, { status: 'success' }),
        createRelayResult(RELAY2_URL, { status: 'failure' }),
      ];

      const outcome = classifyPublishOutcome(results, defaultPolicy);
      expect(outcome.status).toBe('partial');
      expect(outcome.relays).toEqual(results);
    });

    it('should classify failed when no relays succeed (default policy)', () => {
      const results = [
        createRelayResult(RELAY1_URL, { status: 'failure' }),
        createRelayResult(RELAY2_URL, { status: 'failure' }),
      ];

      const outcome = classifyPublishOutcome(results, defaultPolicy);
      expect(outcome.status).toBe('failed');
      expect(outcome.relays).toEqual(results);
    });

    it('should use conservative policy success criteria (requires 2 successes)', () => {
      const results = [
        createRelayResult(RELAY1_URL, { status: 'success' }),
        createRelayResult(RELAY2_URL, { status: 'failure' }),
        createRelayResult(RELAY3_URL, { status: 'failure' }),
      ];

      const outcome = classifyPublishOutcome(results, conservativePolicy);
      expect(outcome.status).toBe('failed'); // Only 1 success, needs 2
      expect(outcome.relays).toEqual(results);
    });

    it('should classify success with conservative policy when 2+ relays succeed', () => {
      const results = [
        createRelayResult(RELAY1_URL, { status: 'success' }),
        createRelayResult(RELAY2_URL, { status: 'success' }),
        createRelayResult(RELAY3_URL, { status: 'failure' }),
      ];

      const outcome = classifyPublishOutcome(results, conservativePolicy);
      expect(outcome.status).toBe('partial'); // 2 successes, but not all
      expect(outcome.relays).toEqual(results);
    });

    it('should use aggressive policy success criteria (requires 1 success)', () => {
      const results = [
        createRelayResult(RELAY1_URL, { status: 'success' }),
        createRelayResult(RELAY2_URL, { status: 'failure' }),
      ];

      const outcome = classifyPublishOutcome(results, aggressivePolicy);
      expect(outcome.status).toBe('partial'); // 1 success is enough
      expect(outcome.relays).toEqual(results);
    });

    it('should handle empty results array', () => {
      const results: ReturnType<typeof createRelayResult>[] = [];

      const outcome = classifyPublishOutcome(results, defaultPolicy);
      expect(outcome.status).toBe('failed');
      expect(outcome.relays).toEqual([]);
    });

    it('should handle single relay success', () => {
      const results = [createRelayResult(RELAY1_URL, { status: 'success' })];

      const outcome = classifyPublishOutcome(results, defaultPolicy);
      expect(outcome.status).toBe('success');
      expect(outcome.relays).toEqual(results);
    });

    it('should handle single relay failure', () => {
      const results = [createRelayResult(RELAY1_URL, { status: 'failure' })];

      const outcome = classifyPublishOutcome(results, defaultPolicy);
      expect(outcome.status).toBe('failed');
      expect(outcome.relays).toEqual(results);
    });
  });
});
