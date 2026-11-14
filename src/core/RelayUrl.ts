import { ValidationError } from './errors';
import type { RelayUrl } from './types';

export interface NormalizeRelayOptions {
  /** Local development only. Production publishers should leave this unset. */
  allowPrivateNetworks?: boolean;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const a = nums[0] ?? 0;
  const b = nums[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedRelayHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  if (/^\d+$/.test(host)) return true;
  if (isPrivateIpv4(host)) return true;
  if (host.startsWith('::ffff:')) return true;
  if (host.includes(':')) {
    const bare = host.split('%')[0] ?? host;
    if (bare === '::' || bare === '::1') return true;
    const first = bare.split(':').find((part) => part.length > 0) ?? '';
    if (first.startsWith('fc') || first.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(first)) return true;
  }
  return false;
}

/**
 * Normalizes a single relay URL
 * Returns null if invalid
 */
function normalizeSingleRelay(relay: string, options?: NormalizeRelayOptions): string | null {
  // Trim whitespace
  let url = relay.trim();

  // Skip empty strings
  if (!url) {
    return null;
  }

  // Remove trailing slash
  url = url.replace(/\/+$/, '');

  try {
    // Parse URL to validate and normalize
    const urlObj = new URL(url);

    if (
      urlObj.username ||
      urlObj.password ||
      (!options?.allowPrivateNetworks && isBlockedRelayHost(urlObj.hostname))
    ) {
      throw new ValidationError('Relay URL is not allowed', 'relays');
    }

    // Ensure wss:// scheme (reject non-wss)
    if (urlObj.protocol !== 'wss:') {
      // Try to convert http/https/ws to wss
      if (urlObj.protocol === 'ws:') {
        urlObj.protocol = 'wss:';
      } else if (urlObj.protocol === 'http:') {
        urlObj.protocol = 'wss:';
        urlObj.port = '';
      } else if (urlObj.protocol === 'https:') {
        urlObj.protocol = 'wss:';
        urlObj.port = '';
      } else {
        // Reject non-wss protocols
        return null;
      }
    }

    // Reconstruct URL without trailing slash
    return urlObj.toString().replace(/\/+$/, '');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    // Invalid URL, skip
    return null;
  }
}

/**
 * Normalizes relay URLs for publishing:
 * - Ensures wss:// scheme (rejects non-wss)
 * - Trims whitespace
 * - Removes trailing /
 * - Deduplicates
 * - Caps at max 12 relays
 * @param relays Array of relay URL strings
 * @returns Array of normalized RelayUrl branded strings
 * @throws {ValidationError} if relays is not an array
 */
export function normalizeRelayUrls(relays: unknown, options?: NormalizeRelayOptions): RelayUrl[] {
  if (!relays || !Array.isArray(relays)) {
    throw new ValidationError('relays must be an array', 'relays');
  }

  const MAX_RELAYS = 12;
  const normalized = new Set<string>();

  for (const relay of relays) {
    if (typeof relay !== 'string') {
      continue;
    }

    const normalizedUrl = normalizeSingleRelay(relay, options);
    if (normalizedUrl) {
      normalized.add(normalizedUrl);

      // Cap at max relays
      if (normalized.size >= MAX_RELAYS) {
        break;
      }
    }
  }

  // Cast to RelayUrl[] - validation has been done
  return Array.from(normalized) as RelayUrl[];
}

/**
 * Cleans URLs (similar to cleanURLs from utils)
 * Less strict than normalizeRelayUrls - just validates URL format
 *
 * @param urls Array of URL strings to clean
 * @returns Array of valid URL origins
 */
export function cleanUrls(urls: unknown): string[] {
  if (!urls || !Array.isArray(urls)) {
    return [];
  }
  return urls
    .map((url) => {
      try {
        return new URL(url as string).origin;
      } catch {
        return null;
      }
    })
    .filter((u): u is string => u !== null);
}
