import { expect } from 'vitest';

expect.extend({
  toStartWith(received: string, expected: string) {
    const pass = typeof received === 'string' && received.startsWith(expected);
    return {
      pass,
      message: () =>
        pass
          ? `expected "${received}" not to start with "${expected}"`
          : `expected "${received}" to start with "${expected}"`,
    };
  },
});
