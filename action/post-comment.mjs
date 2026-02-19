#!/usr/bin/env node
/**
 * Post DocAlign scan results as a PR comment.
 * Reads /tmp/docalign-pr-comment.md (produced by `docalign scan --format github-pr`).
 * Uses GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, GITHUB_EVENT_PATH.
 */

import { readFileSync } from 'node:fs';

const COMMENT_MARKER = '<!-- docalign-report -->';

// --- Read pre-formatted PR comment ---

let commentBody;
try {
  commentBody = readFileSync('/tmp/docalign-pr-comment.md', 'utf-8').trim();
  if (!commentBody) {
    console.error('DocAlign: PR comment file is empty');
    process.exit(0);
  }
} catch (err) {
  console.error(`DocAlign: Failed to read PR comment: ${err.message}`);
  process.exit(0); // Don't fail the action if comment posting fails
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

// --- Verify comment has marker ---

if (!commentBody.includes(COMMENT_MARKER)) {
  console.error('DocAlign: PR comment is missing the docalign-report marker');
  process.exit(0);
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

try {
  const existingId = await findExistingComment();
  if (existingId) {
    await githubApi('PATCH', `/repos/${owner}/${repo}/issues/comments/${existingId}`, { body: commentBody });
    console.log(`DocAlign: Updated existing PR comment (id: ${existingId})`);
  } else {
    await githubApi('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body: commentBody });
    console.log('DocAlign: Posted PR comment');
  }
} catch (err) {
  console.error(`DocAlign: Failed to post comment: ${err.message}`);
  // Don't fail the action
}
