#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return out;
}

function parseHeader(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const header = {};
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '---') return header;
    const idx = l.indexOf(':');
    if (idx === -1) continue;
    header[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
  }
  return null;
}

const args = parseArgs(process.argv);
const runId = args['run-id'];
const stage = args.stage || 'build';
const schemaVersion = args['schema-version'] || '1';
const repoRoot = fs.realpathSync(process.env.DOCALIGN_REPO_ROOT || process.cwd());

try {
  if (!runId) throw new Error('Missing required --run-id');

  const required = [
    `_team/outputs/${runId}/decision.md`,
    `_team/outputs/${runId}/spec/tech-lead.md`,
    `_team/outputs/${runId}/spec_review/pm.md`,
    `_team/outputs/${runId}/spec_review/critic.md`,
    `_team/outputs/${runId}/${stage}/tech-lead.md`,
    `_team/outputs/${runId}/${stage}/evidence-checklist.md`,
    `_team/handoffs/${runId}/handoff.md`,
  ];

  const missing = [];
  const malformed = [];

  for (const rel of required) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    if (!content.trim()) {
      malformed.push(`${rel} (empty)`);
      continue;
    }
    const header = parseHeader(content);
    if (!header) {
      malformed.push(`${rel} (missing frontmatter header)`);
      continue;
    }
    if (header['Schema-Version'] !== schemaVersion) {
      malformed.push(`${rel} (Schema-Version=${header['Schema-Version'] || 'none'} expected ${schemaVersion})`);
    }
    if (header['Run-ID'] !== runId) {
      malformed.push(`${rel} (Run-ID=${header['Run-ID'] || 'none'} expected ${runId})`);
    }
  }

  if (missing.length || malformed.length) {
    console.error('[stage-artifacts] FAILED');
    if (missing.length) {
      console.error('Missing:');
      missing.forEach((m) => console.error(`- ${m}`));
    }
    if (malformed.length) {
      console.error('Malformed:');
      malformed.forEach((m) => console.error(`- ${m}`));
    }
    process.exit(1);
  }

  console.log(`[stage-artifacts] pass run=${runId} stage=${stage} schema=${schemaVersion}`);
  process.exit(0);
} catch (e) {
  console.error(`[stage-artifacts] execution/config error: ${e.message}`);
  process.exit(2);
}
