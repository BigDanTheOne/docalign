#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = fs.realpathSync(process.env.DOCALIGN_REPO_ROOT || process.cwd());
const outDir = path.join(repoRoot, '_team', 'outputs', 'migration');
const forbidden = '/Users/kotkot/Discovery/docalign';
const include = ['src', 'scripts', 'docs', '.github', 'config'];
const skip = new Set(['node_modules', '.git', 'dist']);
const findings = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs);
    else if (ent.isFile()) {
      const rel = path.relative(repoRoot, abs);
      const content = fs.readFileSync(abs, 'utf8');
      if (content.includes(forbidden)) findings.push(rel);
    }
  }
}

for (const d of include) {
  const abs = path.join(repoRoot, d);
  if (fs.existsSync(abs)) walk(abs);
}

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'preflight-path-audit.json');
fs.writeFileSync(outPath, JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repoRoot,
  forbidden,
  files: findings,
}, null, 2) + '\n');

console.log(`Preflight audit written: ${outPath}`);
console.log(`Matches: ${findings.length}`);
process.exit(0);
