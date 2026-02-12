/**
 * API client for communicating with the DocAlign server.
 * Implements: tdd-infra.md Sections 4.4-4.6 (client-side contract).
 */

export interface TaskListItem {
  id: string;
  type: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export interface TaskListResponse {
  tasks: TaskListItem[];
}

export interface TaskDetailResponse {
  id: string;
  repo_id: string;
  scan_run_id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  claimed_by: string | null;
  error: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

export interface TaskResultPayload {
  success: boolean;
  error?: string;
  data: Record<string, unknown>;
  metadata: {
    duration_ms: number;
    model_used?: string;
    tokens_used?: number;
    cost_usd?: number;
  };
}

export interface TaskResultResponse {
  status: 'accepted';
  task_id: string;
}

export interface ApiError {
  status: number;
  error: string;
  message: string;
  details?: unknown;
}

export class DocAlignApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly repoId: string;
  private readonly actionRunId: string;

  constructor(baseUrl: string, token: string, repoId: string, actionRunId: string) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.repoId = repoId;
    this.actionRunId = actionRunId;
  }

  /**
   * GET /api/tasks/pending — list pending tasks for this repo/scan.
   */
  async getPendingTasks(scanRunId?: string): Promise<TaskListResponse> {
    const params = new URLSearchParams();
    if (scanRunId) params.set('scan_run_id', scanRunId);
    const url = `${this.baseUrl}/api/tasks/pending?${params.toString()}`;

    const response = await this.fetchWithRetry(url, { method: 'GET' });
    if (!response.ok) {
      throw await this.parseError(response);
    }
    return response.json() as Promise<TaskListResponse>;
  }

  /**
   * GET /api/tasks/:id — claim a task atomically.
   * Returns the full task payload on success.
   * Throws on 404 (not found), 409 (already claimed), 410 (expired).
   */
  async claimTask(taskId: string): Promise<TaskDetailResponse> {
    const url = `${this.baseUrl}/api/tasks/${taskId}?action_run_id=${encodeURIComponent(this.actionRunId)}`;

    const response = await this.fetchWithRetry(url, { method: 'GET' });
    if (!response.ok) {
      throw await this.parseError(response);
    }
    return response.json() as Promise<TaskDetailResponse>;
  }

  /**
   * POST /api/tasks/:id/result — submit task result.
   */
  async submitTaskResult(taskId: string, result: TaskResultPayload): Promise<TaskResultResponse> {
    const url = `${this.baseUrl}/api/tasks/${taskId}/result`;

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!response.ok) {
      throw await this.parseError(response);
    }
    return response.json() as Promise<TaskResultResponse>;
  }

  /**
   * Fetch with retry for transient errors (500, 503).
   * Retries up to 3 times with exponential backoff.
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 3,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...(init.headers as Record<string, string> || {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, { ...init, headers });

        // Retry on server errors
        if ((response.status === 500 || response.status === 503) && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await sleep(delay);
          continue;
        }

        return response;
      } catch (err) {
        // Network error — retry
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    // Should never reach here
    throw new Error('Max retries exceeded');
  }

  private async parseError(response: Response): Promise<ApiError> {
    try {
      const body = await response.json() as Record<string, unknown>;
      return {
        status: response.status,
        error: (body.error as string) || 'UNKNOWN_ERROR',
        message: (body.message as string) || response.statusText,
        details: body.details,
      };
    } catch {
      return {
        status: response.status,
        error: 'UNKNOWN_ERROR',
        message: response.statusText,
      };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
