// Type definitions for bech32
declare module 'bech32' {
  export interface Decoded {
    prefix: string;
    words: number[];
  }

  export function decode(_str: string, _limit?: number): Decoded;
  export function fromWords(_words: number[]): number[];
  export function toWords(_bytes: number[]): number[];
  export function encode(_prefix: string, _words: number[], _limit?: number): string;

  // Default export for namespace import
  const bech32: {
    decode: (_str: string, _limit?: number) => Decoded;
    fromWords: (_words: number[]) => number[];
    toWords: (_bytes: number[]) => number[];
    encode: (_prefix: string, _words: number[], _limit?: number) => string;
  };
  export default bech32;
}
