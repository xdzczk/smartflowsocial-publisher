// Type definitions for bech32
declare module 'bech32' {
  export interface Decoded {
    prefix: string;
    words: number[];
  }

  export function decode(str: string, limit?: number): Decoded;
  export function fromWords(words: number[]): number[];
  export function toWords(bytes: number[]): number[];
  export function encode(prefix: string, words: number[], limit?: number): string;

  // Default export for namespace import
  const bech32: {
    decode: (str: string, limit?: number) => Decoded;
    fromWords: (words: number[]) => number[];
    toWords: (bytes: number[]) => number[];
    encode: (prefix: string, words: number[], limit?: number) => string;
  };
  export default bech32;
}
