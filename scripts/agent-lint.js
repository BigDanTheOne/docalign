#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');
const REMEDIATION_PATH = path.join(__dirname, 'lint-remediation.json');

// Load remediation map
let remediations = {};
try {
  remediations = JSON.parse(fs.readFileSync(REMEDIATION_PATH, 'utf8'));
} catch (e) {
  process.stderr.write(`Warning: Could not load remediation map: ${e.message}\n`);
}

// Run ESLint in JSON format
let eslintOutput;
let exitCode = 0;
try {
  eslintOutput = execSync('npx eslint src/ test/ --format json', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
} catch (err) {
  eslintOutput = err.stdout || '[]';
  exitCode = err.status || 1;
}

// Parse results
let results;
try {
  results = JSON.parse(eslintOutput);
} catch (_) {
  process.stderr.write('Error: Could not parse ESLint JSON output\n');
  process.stderr.write(eslintOutput + '\n');
  process.exit(2);
}

let totalErrors = 0;
let totalWarnings = 0;

for (const fileResult of results) {
  if (fileResult.messages.length === 0) continue;

  const relPath = path.relative(REPO_ROOT, fileResult.filePath);

  for (const msg of fileResult.messages) {
    const severity = msg.severity === 2 ? 'error' : 'warning';
    if (severity === 'error') totalErrors++;
    else totalWarnings++;

    // Base message
    let output = `${relPath}:${msg.line}:${msg.column} ${severity} ${msg.message} (${msg.ruleId})`;

    // Append remediation if available
    const ruleInfo = remediations[msg.ruleId];
    if (ruleInfo) {
      output += `\n  FIX: ${ruleInfo.remediation}`;
      if (ruleInfo.examples && ruleInfo.examples.length > 0) {
        output += `\n  EXAMPLE: ${ruleInfo.examples[0]}`;
      }
    }

    process.stdout.write(output + '\n\n');
  }
}

// Summary
if (totalErrors === 0 && totalWarnings === 0) {
  process.stdout.write('No lint errors or warnings.\n');
} else {
  process.stdout.write(`\n${totalErrors} error(s), ${totalWarnings} warning(s)\n`);
}

process.exit(exitCode);
