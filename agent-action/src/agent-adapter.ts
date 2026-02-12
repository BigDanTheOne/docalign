/**
 * Agent Adapter: Spawns Claude Code subprocess for Path 2 verification.
 * Implements: phase6-epics.md E5 Key Deliverable 11; ADR-1 (agent-first).
 */
import { spawn } from 'child_process';
import { PVerifyOutputSchema, type PVerifyOutput } from './prompts/schemas';

export interface AgentAdapterOptions {
  repoRoot: string;
  timeoutMs: number;
  command?: string;
  maxTurns?: number;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_TURNS = 10;

/**
 * Run a Claude Code subprocess for Path 2 verification.
 * Returns the parsed verification result, or an 'uncertain' fallback on failure.
 */
export async function runAgentVerification(
  prompt: string,
  options: AgentAdapterOptions,
): Promise<PVerifyOutput> {
  const command = options.command || 'claude';
  const maxTurns = options.maxTurns || DEFAULT_MAX_TURNS;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  try {
    const output = await spawnAgent(command, prompt, options.repoRoot, maxTurns, timeoutMs);
    return parseAgentOutput(output);
  } catch (err) {
    console.error('[agent-adapter] Agent execution failed:', err);
    return {
      verdict: 'uncertain',
      confidence: 0,
      severity: null,
      reasoning: `Agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
      specific_mismatch: null,
      suggested_fix: null,
      evidence_files: [],
    };
  }
}

function spawnAgent(
  command: string,
  prompt: string,
  cwd: string,
  maxTurns: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--max-turns', String(maxTurns), '--output-format', 'json'];
    const proc = spawn(command, args, { cwd, timeout: timeoutMs });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Agent exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function parseAgentOutput(output: string): PVerifyOutput {
  // Try to find JSON in the output
  const jsonMatch = output.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON verification result found in agent output');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return PVerifyOutputSchema.parse(parsed);
}
