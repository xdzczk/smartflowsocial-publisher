import { relayInit } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import * as bech32 from "bech32";

export const cleanURLs = (urls: unknown): string[] => {
  if (!urls || !Array.isArray(urls)) {
    return [];
  }
  return urls.map(url => {
    try {
      return new URL(url as string).origin;
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }).filter((u): u is string => Boolean(u)); // filter falsy values;
}

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

    relay.connect();
  });
};

export const fetchProfiles = (pubkey: string, urls: string[]): Promise<Event>[] => {
  return urls.map(url => fetchProfileFromRelay(pubkey, url));
};

const bech32Decode = (str: string, encoding: 'utf-8' | 'hex' = "utf-8"): string => {
  const { words: dataPart } = bech32.decode(str, 2000);
  const requestByteArray = bech32.fromWords(dataPart);
  return Buffer.from(requestByteArray).toString(encoding);
}

export const normalizeToHex = (str: unknown): string | undefined => {
  if (!str || typeof str !== 'string') {
    return undefined;
  }
  const NIP19Prefixes = ["npub", "nsec", "note"];
  const prefix = str.substring(0, 4);
  if (NIP19Prefixes.includes(prefix)) {
    try {
      const hexStr = bech32Decode(str, "hex");
      return hexStr;
    } catch (e) {
      console.info("ignoring bech32 parsing error", e);
    }
  }
  return str;
}
