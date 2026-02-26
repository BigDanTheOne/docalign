import type { LlmFixtureEntry, LlmFixtureFile } from './types';

/**
 * Creates a mock LLM function from pre-recorded fixtures.
 *
 * The returned function takes `{ filePath: string }` and resolves with the
 * stored response for that file. Throws if no fixture exists for the given path.
 */
export function createLlmMock(
  fixtures: LlmFixtureFile | LlmFixtureEntry[],
): (args: { filePath: string }) => Promise<LlmFixtureEntry['response']> {
  const entries: LlmFixtureEntry[] = Array.isArray(fixtures)
    ? fixtures
    : fixtures.entries;

  const fixtureMap = new Map<string, LlmFixtureEntry['response']>();
  for (const entry of entries) {
    fixtureMap.set(entry.file_path, entry.response);
  }

  return async (args: { filePath: string }) => {
    const response = fixtureMap.get(args.filePath);
    if (response === undefined) {
      throw new Error(
        `No LLM fixture found for file_path: "${args.filePath}". ` +
          `Available fixtures: ${[...fixtureMap.keys()].join(', ')}`,
      );
    }
    return response;
  };
}
