import type { DocFix } from '../../shared/types';

interface ConfirmationPageData {
  fixCount: number;
  prNumber: number;
  repoFullName: string;
  fixes: DocFix[];
  hiddenFields: {
    repo: string;
    scan_run_id: string;
    token: string;
  };
  postAction: string;
}

/**
 * Build the HTML confirmation page for fix application.
 * GATE42-029 (GET → confirmation → POST).
 *
 * Security: No third-party resources. All CSS inline.
 */
export function buildConfirmationPage(data: ConfirmationPageData): string {
  const fixListHtml = data.fixes
    .map((fix) => {
      const file = escapeHtml(fix.file);
      const reason = escapeHtml(truncate(fix.reason, 120));
      return `<li><code>${file}</code> line ${fix.line_start}: ${reason}</li>`;
    })
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DocAlign - Confirm Fix Application</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #24292f; }
    h1 { font-size: 1.5rem; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    ul { padding-left: 1.5em; }
    li { margin-bottom: 0.5em; }
    .actions { margin-top: 2em; }
    button { padding: 8px 16px; font-size: 1rem; border-radius: 6px; cursor: pointer; margin-right: 8px; }
    .confirm { background: #2da44e; color: white; border: 1px solid #2da44e; }
    .confirm:hover { background: #2c974b; }
    .cancel { background: #f6f8fa; color: #24292f; border: 1px solid #d0d7de; }
    .cancel:hover { background: #eaeef2; }
  </style>
</head>
<body>
  <h1>Apply Documentation Fixes</h1>
  <p>Apply <strong>${data.fixCount} fix${data.fixCount !== 1 ? 'es' : ''}</strong> to PR <strong>#${data.prNumber}</strong> on <strong>${escapeHtml(data.repoFullName)}</strong>?</p>
  <ul>
      ${fixListHtml}
  </ul>
  <form method="POST" action="${escapeHtml(data.postAction)}">
    <input type="hidden" name="repo" value="${escapeHtml(data.hiddenFields.repo)}">
    <input type="hidden" name="scan_run_id" value="${escapeHtml(data.hiddenFields.scan_run_id)}">
    <input type="hidden" name="token" value="${escapeHtml(data.hiddenFields.token)}">
    <div class="actions">
      <button type="submit" class="confirm">Confirm</button>
      <button type="button" class="cancel" onclick="history.back()">Cancel</button>
    </div>
  </form>
</body>
</html>`;
}

/**
 * Build a simple error page (for 403, 404, 400 responses).
 */
export function buildErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DocAlign - ${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #24292f; }
    h1 { font-size: 1.5rem; color: #cf222e; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
