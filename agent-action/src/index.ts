/**
 * DocAlign GitHub Action entry point.
 * Implements: E5-01 action scaffold.
 */
import { loadActionConfig } from './config';
import { DocAlignApiClient } from './api-client';
import { createAnthropicClient } from './llm-client';
import { createTaskProcessor } from './task-processor';
import { runPollingLoop } from './polling';

async function main(): Promise<void> {
  console.log('[docalign] Starting DocAlign agent action...');

  // 1. Load configuration
  const config = loadActionConfig();
  console.log(`[docalign] Server: ${config.serverUrl}`);
  console.log(`[docalign] Repo: ${config.repoId}`);
  console.log(`[docalign] Scan: ${config.scanRunId}`);
  console.log(`[docalign] Max tasks: ${config.maxTasks}`);
  console.log(`[docalign] Models: extraction=${config.llm.extractionModel}, verification=${config.llm.verificationModel}, triage=${config.llm.triageModel}`);

  // 2. Create API client
  const apiClient = new DocAlignApiClient(
    config.serverUrl,
    config.docalignToken,
    config.repoId,
    config.actionRunId,
  );

  // 3. Create LLM client
  const llmClient = createAnthropicClient(config.anthropicApiKey);

  // 4. Create task processor
  const processor = createTaskProcessor(config, llmClient);

  // 5. Run polling loop
  const stats = await runPollingLoop(apiClient, processor, config);

  // 6. Report results
  console.log('[docalign] Scan complete.');
  console.log(`[docalign] Tasks processed: ${stats.tasksProcessed}`);
  console.log(`[docalign] Tasks failed: ${stats.tasksFailed}`);
  console.log(`[docalign] Tasks skipped: ${stats.tasksSkipped}`);
  console.log(`[docalign] Total duration: ${stats.totalDurationMs}ms`);

  if (stats.tasksFailed > 0) {
    const totalAttempted = stats.tasksProcessed + stats.tasksFailed;
    const failureRate = stats.tasksFailed / totalAttempted;
    if (failureRate > 0.1) {
      console.error(
        `[docalign] WARNING: ${Math.round(failureRate * 100)}% failure rate (${stats.tasksFailed}/${totalAttempted}).`,
      );
    }
  }
}

main().catch((err) => {
  console.error('[docalign] Fatal error:', err);
  process.exit(1);
});
