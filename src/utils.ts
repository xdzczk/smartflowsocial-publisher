import * as bech32 from 'bech32';

/**
 * Decodes bech32 string to hex or utf-8
 */
const bech32Decode = (str: string, encoding: 'utf-8' | 'hex' = 'utf-8'): string => {
  const { words: dataPart } = bech32.decode(str, 2000);
  const requestByteArray = bech32.fromWords(dataPart);
  return Buffer.from(requestByteArray).toString(encoding);
};

/**
 * Normalizes a string to hex format
 * Handles bech32 encoded strings (npub, nsec, note prefixes)
 */
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
      // Ignore bech32 parsing errors
      return undefined;
    }
  }
  return str;
};
