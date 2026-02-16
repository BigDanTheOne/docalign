#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const FORBIDDEN = '/Users/kotkot/Discovery/docalign';
const repoRoot = fs.realpathSync(process.env.DOCALIGN_REPO_ROOT || process.cwd());
const includeDirs = ['src', 'scripts', 'docs', '.github', '_team', 'config'];
const skipNames = new Set(['node_modules', '.git', 'dist']);
const allowedSubpaths = [
  '_team/outputs',
  '_team/handoffs',
  'docs/runbooks/repo-relocation.md',
  'scripts/checks/path-hygiene.js',
  'scripts/migration/preflight-path-audit.js',
  'scripts/migration/relocate-repo.sh',
  'scripts/migration/rollback-repo.sh',
];

const visited = new Set();
const violations = [];

function isAllowed(relPath) {
  return allowedSubpaths.some((p) => relPath === p || relPath.startsWith(`${p}/`));
}

function walk(absDir) {
  let realDir;
  try {
    realDir = fs.realpathSync(absDir);
  } catch (e) {
    throw new Error(`Failed to realpath ${absDir}: ${e.message}`);
  }

  if (visited.has(realDir)) return;
  visited.add(realDir);

  const entries = fs.readdirSync(realDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const absPath = path.join(realDir, entry.name);

    let lst;
    try {
      lst = fs.lstatSync(absPath);
    } catch (e) {
      throw new Error(`Failed to stat ${absPath}: ${e.message}`);
    }

    if (lst.isSymbolicLink()) {
      // loop-safe: do not follow symlinks during scan
      continue;
    }

    if (lst.isDirectory()) {
      walk(absPath);
      continue;
    }

    if (!lst.isFile()) continue;

    const rel = path.relative(repoRoot, absPath);
    if (isAllowed(rel)) continue;

    const content = fs.readFileSync(absPath, 'utf8');
    if (!content.includes(FORBIDDEN)) continue;

    const realFile = fs.realpathSync(absPath);
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes(FORBIDDEN)) {
        violations.push({
          file: rel,
          realFile,
          line: i + 1,
          snippet: line.trim().slice(0, 180),
        });
      }
    });
  }
}

try {
  includeDirs.forEach((d) => {
    const abs = path.join(repoRoot, d);
    if (fs.existsSync(abs)) walk(abs);
  });

  if (violations.length > 0) {
    console.error(`[path-hygiene] found ${violations.length} forbidden absolute path reference(s):`);
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line} (real=${v.realFile}) :: ${v.snippet}`);
    }
    process.exit(1);
  }

  console.log('[path-hygiene] pass');
  process.exit(0);
} catch (e) {
  console.error(`[path-hygiene] execution/config error: ${e.message}`);
  process.exit(2);
}
