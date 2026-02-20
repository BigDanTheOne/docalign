import 'vitest';

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toStartWith(expected: string): T;
  }
  interface AsymmetricMatchersContaining {
    toStartWith(expected: string): unknown;
  }
}
