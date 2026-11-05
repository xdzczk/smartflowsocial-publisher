import { ValidationError } from './errors';
import type { RelayUrl } from './types';

/**
 * Normalizes a single relay URL
 * Returns null if invalid
 */
function normalizeSingleRelay(relay: string): string | null {
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
  } catch {
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
export function normalizeRelayUrls(relays: unknown): RelayUrl[] {
  if (!relays || !Array.isArray(relays)) {
    throw new ValidationError('relays must be an array', 'relays');
  }

  const MAX_RELAYS = 12;
  const normalized = new Set<string>();

  for (const relay of relays) {
    if (typeof relay !== 'string') {
      continue;
    }

    const normalizedUrl = normalizeSingleRelay(relay);
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
