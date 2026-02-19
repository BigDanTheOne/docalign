import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const WORKFLOW_PATH = '.github/workflows/docalign.yml';

interface WorkflowStep {
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
  concurrency?: Record<string, unknown>;
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  true?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
  concurrency?: Record<string, unknown>;
}

describe('QA contract: CI workflow for DocAlign itself', () => {
  let workflow: Workflow;
  const repoRoot = resolve(__dirname, '../../..');

  beforeAll(() => {
    const fullPath = resolve(repoRoot, WORKFLOW_PATH);
    expect(existsSync(fullPath), `${WORKFLOW_PATH} must exist`).toBe(true);
    const raw = readFileSync(fullPath, 'utf-8');
    workflow = parseYaml(raw);
  });

  it('AC1: .github/workflows/docalign.yml exists and is separate from ci.yml', () => {
    const ciPath = resolve(repoRoot, '.github/workflows/ci.yml');
    expect(existsSync(ciPath)).toBe(true); // ci.yml still exists separately
    expect(workflow).toBeDefined();
    expect(workflow.name).toBeDefined();
  });

  it('AC2: triggers on push to main and on pull_request', () => {
    const on = workflow.on ?? workflow.true; // YAML 'on' can parse oddly
    expect(on).toBeDefined();

    // Push trigger
    const push = on.push;
    expect(push).toBeDefined();
    expect(push.branches).toContain('main');

    // PR trigger
    expect(on.pull_request).toBeDefined();
  });

  it('AC3: uses local action reference ./', () => {
    const jobs = workflow.jobs;
    expect(jobs).toBeDefined();
    const jobEntries = Object.values(jobs ?? {});
    const usesLocal = jobEntries.some((job) =>
      job.steps?.some((step) => {
        const uses = step.uses ?? '';
        return uses === './' || uses.startsWith('./');
      })
    );
    expect(usesLocal, 'At least one step must use local action reference ./').toBe(true);
  });

  it('AC4: fail_on_drift is configurable (input or env)', () => {
    const jobs = workflow.jobs;
    const jobEntries = Object.values(jobs ?? {});
    // Check for fail_on_drift in step with/env or workflow-level env
    const hasFOD = jobEntries.some((job) =>
      job.steps?.some((step) => {
        const withBlock = step.with ?? {};
        const envBlock = step.env ?? {};
        return 'fail_on_drift' in withBlock || 'FAIL_ON_DRIFT' in envBlock || 'fail_on_drift' in envBlock;
      })
    );
    expect(hasFOD, 'fail_on_drift must be configurable via with or env').toBe(true);
  });

  it('AC5: has concurrency group to cancel stale runs', () => {
    const jobs = workflow.jobs;
    const jobEntries = Object.values(jobs ?? {});
    // Concurrency can be at workflow level or job level
    const hasWorkflowConcurrency = workflow.concurrency != null;
    const hasJobConcurrency = jobEntries.some((job) => job.concurrency != null);
    expect(
      hasWorkflowConcurrency || hasJobConcurrency,
      'Workflow or job must define a concurrency group'
    ).toBe(true);

    // Verify cancel-in-progress
    if (hasWorkflowConcurrency && workflow.concurrency) {
      expect(workflow.concurrency['cancel-in-progress']).toBe(true);
    }
  });

  it('AC2+: path filters are configured for docs/src/md', () => {
    const on = workflow.on ?? workflow.true;
    const push = on.push;
    const pr = on.pull_request;

    // At least one trigger should have path filters
    const paths = push?.paths ?? pr?.paths ?? [];
    expect(paths.length).toBeGreaterThan(0);

    const joined = paths.join(' ');
    expect(joined).toMatch(/docs/);
    expect(joined).toMatch(/src/);
    expect(joined).toMatch(/\.md/);
  });
});
