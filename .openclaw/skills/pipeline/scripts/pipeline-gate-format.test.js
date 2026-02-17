const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'pipeline.js');
const TEAM_DIR = path.join(os.homedir(), 'Discovery', 'docalign', '_team');

function run(args, expectOk = true) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }).trim();
    return { ok: true, out: out ? JSON.parse(out) : null };
  } catch (err) {
    const stderr = String(err.stderr || '').trim();
    const parsed = stderr ? JSON.parse(stderr) : { error: String(err) };
    if (expectOk) throw new Error(parsed.error || stderr || String(err));
    return { ok: false, err: parsed.error || stderr || String(err) };
  }
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

describe('pipeline gate + formatting', () => {
  it('enforces review window gate for verify', () => {
    const runId = run(['create', '--type', 'feature', '--title', `gate-test-${Date.now()}`]).out.run_id;
    run(['advance', '--run-id', runId, '--stage', 'code_review']);

    const dir = path.join(TEAM_DIR, 'outputs', runId, 'code_review');
    mkdirp(dir);

    writeJson(path.join(dir, 'followups.json'), [
      { id: 'fx-1', source: 'codex', status: 'accepted_fixed', rationale: 'fixed' },
    ]);

    const missing = run(['advance', '--run-id', runId, '--stage', 'verify'], false);
    expect(missing.err).toContain('missing Codex review gate file');

    writeJson(path.join(dir, 'codex-review-window.json'), {
      status: 'pending_review_window',
      codex_issue_count: 1,
      latest_codex_comment_at: '2026-02-17T10:00:00Z',
      final_ingest_at: '2026-02-17T10:00:00Z',
    });
    const pending = run(['advance', '--run-id', runId, '--stage', 'verify'], false);
    expect(pending.err).toContain('review window not satisfied');

    writeJson(path.join(dir, 'codex-review-window.json'), {
      status: 'review_observed',
      codex_issue_count: 1,
      latest_codex_comment_at: '2026-02-17T10:10:00Z',
      final_ingest_at: '2026-02-17T10:00:00Z',
    });
    const stale = run(['advance', '--run-id', runId, '--stage', 'verify'], false);
    expect(stale.err).toContain('ingestion is stale');

    writeJson(path.join(dir, 'codex-review-window.json'), {
      status: 'review_observed',
      codex_issue_count: 1,
      latest_codex_comment_at: '2026-02-17T10:10:00Z',
      final_ingest_at: '2026-02-17T10:12:00Z',
    });
    const ok = run(['advance', '--run-id', runId, '--stage', 'verify']);
    expect(ok.out.current_stage).toBe('verify');
  });

  it('normalizes escaped newlines in EXEC_PLAN summaries', () => {
    const runId = run(['create', '--type', 'feature', '--title', `format-test-${Date.now()}`]).out.run_id;

    const step = run(['add-step', '--run-id', runId, '--stage', 'define', '--agent', 'pm']).out;
    run([
      'complete-step',
      '--step-id', step.id,
      '--result', 'completed',
      '--summary',
      'Line one\\nLine two',
    ]);

    const advanced = run(['advance', '--run-id', runId, '--stage', 'build']).out;
    const content = fs.readFileSync(advanced.exec_plan, 'utf8');

    expect(content).toContain('Line one\nLine two');
    expect(content).not.toContain('Line one\\nLine two');
  });
});
