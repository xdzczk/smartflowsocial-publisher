import * as bech32 from 'bech32';
import { relayInit } from 'nostr-tools';
import type { Event } from 'nostr-tools';

export const cleanURLs = (urls: unknown): string[] => {
  if (!urls || !Array.isArray(urls)) {
    return [];
  }
  return urls
    .map((url) => {
      try {
        return new URL(url as string).origin;
      } catch (e) {
        console.error(e);
        return null;
      }
    })
    .filter((u): u is string => u !== null); // filter falsy values;
};

/**
 * Normalizes a single relay URL
 */
const normalizeSingleRelay = (relay: string): string | null => {
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
};

/**
 * Normalizes relay URLs for publishing:
 * - Ensures wss:// scheme (rejects non-wss)
 * - Trims whitespace
 * - Removes trailing /
 * - Deduplicates
 * - Caps at max 12 relays
 */
export const normalizeRelays = (relays: unknown): string[] => {
  if (!relays || !Array.isArray(relays)) {
    throw new Error('relays must be an array');
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

  return Array.from(normalized);
};

const fetchProfileFromRelay = (pubkey: string, url: string): Promise<Event> => {
  return new Promise((resolve, reject) => {
    console.info(`Fetching ${pubkey}'s info from ${url}`);

    const relay = relayInit(url);
    const timeout = 5000;

    function timeoutAndClose() {
      console.error(`Timeout error: pubkey ${pubkey} relay ${url}`);
      relay.close();
      reject(new Error(`Timeout fetching profile from ${url}`));
    }
    const timeoutCheck = setTimeout(timeoutAndClose, timeout);

    relay.on('connect', () => {
      console.info(`connected to ${url}`);
      const subscription = relay.sub([{ limit: 1, kinds: [0], authors: [pubkey] }]);
      subscription.on('event', (ev) => {
        console.info(`Fetched ${pubkey}'s info from ${url}`);
        clearTimeout(timeoutCheck);
        subscription.unsub();
        relay.close();
        resolve(ev);
      });
    });

    relay.on('error', (msg) => {
      console.error(`Failed to fetch from ${url}`, JSON.stringify(msg));
      clearTimeout(timeoutCheck);
      relay.close();
      reject(new Error(`Failed to fetch from ${url}: ${JSON.stringify(msg)}`));
    });

    void relay.connect();
  });
};

export const fetchProfiles = (pubkey: string, urls: string[]): Promise<Event>[] => {
  return urls.map((url) => fetchProfileFromRelay(pubkey, url));
};

const bech32Decode = (str: string, encoding: 'utf-8' | 'hex' = 'utf-8'): string => {
  const { words: dataPart } = bech32.decode(str, 2000);
  const requestByteArray = bech32.fromWords(dataPart);
  return Buffer.from(requestByteArray).toString(encoding);
};

export const normalizeToHex = (str: unknown): string | undefined => {
  if (!str || typeof str !== 'string') {
    return undefined;
  }
  const NIP19Prefixes = ['npub', 'nsec', 'note'];
  const prefix = str.substring(0, 4);
  if (NIP19Prefixes.includes(prefix)) {
    try {
      return bech32Decode(str, 'hex');
    } catch {
      console.info('ignoring bech32 parsing error');
    }
  }
  return str;
};
