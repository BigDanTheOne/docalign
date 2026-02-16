import fs from 'fs';
import path from 'path';

export type ResolveSource = 'env' | 'cwd-walk';

export interface ResolveResult {
  root: string;
  source: ResolveSource;
}

const DEFAULT_OVERRIDE_ENV = 'DOCALIGN_REPO_ROOT';

// Deterministic precedence: strongest sentinel set first.
const SENTINEL_SETS: string[][] = [
  ['.git', 'package.json', '.docalign'],
  ['.git', 'package.json'],
  ['.git'],
];

function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function hasSentinelSet(dir: string, sentinels: string[]): boolean {
  return sentinels.every((s) => exists(path.join(dir, s)));
}

function normalizeReal(p: string): string {
  return fs.realpathSync(path.resolve(p));
}

function validateCandidate(candidate: string): string {
  const real = normalizeReal(candidate);
  const matched = SENTINEL_SETS.find((set) => hasSentinelSet(real, set));
  if (!matched) {
    throw new Error(
      `Repo root candidate invalid: ${real} is missing required sentinels. Expected one of: ${SENTINEL_SETS.map((s) => s.join('+')).join(' | ')}`,
    );
  }
  return real;
}

function* parentsFrom(start: string): Generator<string> {
  let current = path.resolve(start);
  while (true) {
    yield current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function resolveRepoRoot(opts?: { cwd?: string; overrideEnv?: string }): ResolveResult {
  const overrideName = opts?.overrideEnv ?? DEFAULT_OVERRIDE_ENV;
  const cwd = opts?.cwd ?? process.cwd();

  const overrideValue = process.env[overrideName]?.trim();
  if (overrideValue) {
    const validated = validateCandidate(overrideValue);
    return { root: validated, source: 'env' };
  }

  let bestMatch: { dir: string; score: number } | null = null;
  for (const dir of parentsFrom(cwd)) {
    const real = normalizeReal(dir);
    const score = SENTINEL_SETS.findIndex((set) => hasSentinelSet(real, set));
    if (score !== -1) {
      // deterministic: nearest dir wins first; score retained for diagnostics only
      bestMatch = { dir: real, score };
      break;
    }
  }

  if (!bestMatch) {
    throw new Error(
      `Unable to resolve repo root from cwd=${cwd}. No sentinel set found. Set ${overrideName} to a valid repo path.`,
    );
  }

  return { root: bestMatch.dir, source: 'cwd-walk' };
}
