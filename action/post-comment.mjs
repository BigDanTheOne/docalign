#!/usr/bin/env node
/**
 * Post DocAlign scan results as a PR comment.
 * Reads /tmp/docalign-output.json (produced by `docalign scan --json`).
 * Uses GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, GITHUB_EVENT_PATH.
 */

import { readFileSync } from 'node:fs';

const COMMENT_MARKER = '<!-- docalign-report -->';

// --- Parse scan results ---

let scanData;
try {
  const raw = readFileSync('/tmp/docalign-output.json', 'utf-8');
  // The file may contain stderr lines before the JSON — find the JSON object
  const jsonStart = raw.indexOf('{');
  if (jsonStart === -1) {
    console.error('DocAlign: No JSON found in scan output');
    process.exit(0);
  }
  scanData = JSON.parse(raw.slice(jsonStart));
} catch (err) {
  console.error(`DocAlign: Failed to read scan results: ${err.message}`);
  process.exit(0); // Don't fail the action if comment posting fails
}

if (scanData.error) {
  console.error(`DocAlign: Scan error: ${scanData.error}`);
  process.exit(0);
}

// --- Determine PR number ---

let prNumber = null;
const ref = process.env.GITHUB_REF ?? '';
const prMatch = ref.match(/refs\/pull\/(\d+)\//);
if (prMatch) {
  prNumber = parseInt(prMatch[1], 10);
}

if (!prNumber && process.env.GITHUB_EVENT_PATH) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf-8'));
    if (event.pull_request?.number) {
      prNumber = event.pull_request.number;
    }
  } catch {
    // ignore
  }
}

if (!prNumber) {
  console.log('DocAlign: Not a PR event, skipping comment.');
  process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY ?? '';
const [owner, repo] = repository.split('/');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!token) {
  console.error('DocAlign: No GitHub token available');
  process.exit(0);
}

// --- Format comment body ---

function healthEmoji(percent) {
  if (percent >= 90) return ':white_check_mark:';
  if (percent >= 75) return ':large_blue_circle:';
  if (percent >= 50) return ':warning:';
  return ':x:';
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatBody(data) {
  const lines = [];
  const emoji = healthEmoji(data.healthPercent);
  lines.push(`## ${emoji} DocAlign: ${data.healthPercent}% Documentation Health`);
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Claims checked | ${data.verified + data.drifted} |`);
  lines.push(`| Verified | ${data.verified} |`);
  lines.push(`| Drifted | ${data.drifted} |`);
  lines.push('');

  const findings = data.findings ?? [];
  if (findings.length === 0) {
    lines.push('All documentation claims match the codebase. :tada:');
    lines.push('');
    lines.push('<sub>Powered by [DocAlign](https://github.com/BigDanTheOne/docalign)</sub>');
    return lines.join('\n');
  }

  lines.push(`### Findings (${findings.length})`);
  lines.push('');

  // Group by file
  const byFile = new Map();
  for (const f of findings) {
    const existing = byFile.get(f.file) ?? [];
    existing.push(f);
    byFile.set(f.file, existing);
  }

  for (const [file, fileFindings] of byFile) {
    lines.push('<details>');
    lines.push(`<summary><strong>${file}</strong> (${fileFindings.length} issue${fileFindings.length > 1 ? 's' : ''})</summary>`);
    lines.push('');

    for (const f of fileFindings) {
      const badge = f.severity === 'high' ? '`HIGH`' : f.severity === 'medium' ? '`MEDIUM`' : '`LOW`';
      lines.push(`${badge} **Line ${f.line}**`);
      lines.push(`> ${truncate(f.claimText, 150)}`);
      lines.push('');
      lines.push(f.actual);
      if (f.evidence) {
        lines.push(`Evidence: \`${f.evidence}\``);
      }
      lines.push('');
    }

    lines.push('</details>');
    lines.push('');
  }

  // Hotspots
  const hotspots = data.hotspots ?? [];
  if (hotspots.length > 3) {
    lines.push('### Hotspots');
    lines.push('');
    for (const h of hotspots.slice(0, 5)) {
      lines.push(`- **${h.file}** — ${h.drifted} drifted`);
    }
    if (hotspots.length > 5) {
      lines.push(`- ...and ${hotspots.length - 5} more files`);
    }
    lines.push('');
  }

  lines.push('<sub>Powered by [DocAlign](https://github.com/BigDanTheOne/docalign)</sub>');
  return lines.join('\n');
}

// --- GitHub API helpers ---

async function githubApi(method, path, body) {
  const url = `https://api.github.com${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'docalign-action/0.1.0',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GitHub API ${method} ${path}: ${resp.status} ${text.slice(0, 200)}`);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

async function findExistingComment() {
  const resp = await githubApi('GET', `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=50`);
  if (!Array.isArray(resp)) return null;
  for (const comment of resp) {
    if (typeof comment.body === 'string' && comment.body.startsWith(COMMENT_MARKER)) {
      return comment.id;
    }
  }
  return null;
}

// --- Main ---

const body = `${COMMENT_MARKER}\n${formatBody(scanData)}`;

try {
  const existingId = await findExistingComment();
  if (existingId) {
    await githubApi('PATCH', `/repos/${owner}/${repo}/issues/comments/${existingId}`, { body });
    console.log(`DocAlign: Updated existing PR comment (id: ${existingId})`);
  } else {
    await githubApi('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body });
    console.log('DocAlign: Posted PR comment');
  }
} catch (err) {
  console.error(`DocAlign: Failed to post comment: ${err.message}`);
  // Don't fail the action
}
