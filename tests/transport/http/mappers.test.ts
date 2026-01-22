import { describe, expect, it } from 'vitest';

import {
  mapErrorToResponse,
  mapPublishOutcomeToResponse,
  parsePublishRequest,
} from '../../../src/transport/http/mappers';
import { createPublishOutcome, createRelayResult, createSignedEvent } from '../../utils/fixtures';

const RELAY1_URL = 'wss://relay1.example.com';
const RELAY2_URL = 'wss://relay2.example.com';
const INVALID_REQUEST_MSG = 'Invalid request';

describe('HTTP Mappers', () => {
  describe('parsePublishRequest', () => {
    it('should parse valid request', () => {
      const event = createSignedEvent();
      const body = {
        relays: [RELAY1_URL, RELAY2_URL],
        event,
      };

      const result = parsePublishRequest(body);
      expect(result.event).toEqual(event);
      expect(result.relayUrls).toHaveLength(2);
      expect(result.relayUrls[0]).toBe(RELAY1_URL);
    });

    it('should throw on null body', () => {
      expect(() => parsePublishRequest(null)).toThrow(INVALID_REQUEST_MSG);
    });

    it('should throw on non-object body', () => {
      expect(() => parsePublishRequest('string')).toThrow(INVALID_REQUEST_MSG);
      expect(() => parsePublishRequest(123)).toThrow(INVALID_REQUEST_MSG);
    });

    it('should throw on missing relays', () => {
      const body = {
        event: createSignedEvent(),
      };
      expect(() => parsePublishRequest(body)).toThrow('Invalid request');
    });

    it('should throw on non-array relays', () => {
      const body = {
        relays: 'not-an-array',
        event: createSignedEvent(),
      };
      expect(() => parsePublishRequest(body)).toThrow('Invalid request');
    });

    it('should throw on missing event', () => {
      const body = {
        relays: ['wss://relay.example.com'],
      };
      expect(() => parsePublishRequest(body)).toThrow('Invalid request');
    });

    it('should throw on unsigned event', () => {
      const body = {
        relays: ['wss://relay.example.com'],
        event: {
          id: 'test',
          pubkey: 'test',
          kind: 1,
          sig: '', // Empty = unsigned
          created_at: Date.now(),
          content: 'test',
          tags: [],
        },
      };
      expect(() => parsePublishRequest(body)).toThrow('must be signed');
    });

    it('should throw on invalid relays after normalization', () => {
      const INVALID_RELAY1 = 'not-a-url';
      const INVALID_RELAY2 = 'also-invalid';
      const body = {
        relays: [INVALID_RELAY1, INVALID_RELAY2],
        event: createSignedEvent(),
      };
      expect(() => parsePublishRequest(body)).toThrow('No valid relays');
    });
  });

  describe('mapPublishOutcomeToResponse', () => {
    it('should map success outcome', () => {
      const relays = [
        createRelayResult(RELAY1_URL, { status: 'success', latencyMs: 100 }),
        createRelayResult(RELAY2_URL, { status: 'success', latencyMs: 150 }),
      ];
      const outcome = createPublishOutcome('success', relays);

      const response = mapPublishOutcomeToResponse(outcome);
      expect(response.results).toHaveLength(2);
      expect(response.results[0].ok).toBe(true);
      expect(response.results[0].latencyMs).toBe(100);
      expect(response.results[1].ok).toBe(true);
      expect(response.results[1].latencyMs).toBe(150);
    });

    it('should map partial outcome', () => {
      const relays = [
        createRelayResult(RELAY1_URL, { status: 'success', latencyMs: 100 }),
        createRelayResult(RELAY2_URL, {
          status: 'failure',
          latencyMs: 200,
          error: 'TIMEOUT',
        }),
      ];
      const outcome = createPublishOutcome('partial', relays);

      const response = mapPublishOutcomeToResponse(outcome);
      expect(response.results).toHaveLength(2);
      expect(response.results[0].ok).toBe(true);
      expect(response.results[1].ok).toBe(false);
      expect(response.results[1].error).toBe('TIMEOUT');
    });

    it('should map failed outcome', () => {
      const relays = [
        createRelayResult(RELAY1_URL, {
          status: 'failure',
          latencyMs: 100,
          error: 'Connection failed',
        }),
      ];
      const outcome = createPublishOutcome('failed', relays);

      const response = mapPublishOutcomeToResponse(outcome);
      expect(response.results).toHaveLength(1);
      expect(response.results[0].ok).toBe(false);
      expect(response.results[0].error).toBe('Connection failed');
    });
  });

  describe('mapErrorToResponse', () => {
    it('should map Error to response', () => {
      const error = new Error('Test error');
      const response = mapErrorToResponse(error);
      expect(response.error).toBe('Test error');
    });

    it('should map string to response', () => {
      const error = 'String error';
      const response = mapErrorToResponse(error);
      expect(response.error).toBe('String error');
    });

    it('should map unknown type to response', () => {
      const error = { some: 'object' };
      const response = mapErrorToResponse(error);
      expect(response.error).toBe('[object Object]');
    });
  });
});
