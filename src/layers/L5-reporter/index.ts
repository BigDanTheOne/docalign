export { sanitizeForMarkdown, sanitizeForCodeBlock } from './sanitize';
export { calculateHealthScore, updateCachedHealthScore } from './health';
export { formatFinding, buildSummaryComment, determineCheckConclusion, determineOutcome } from './comment-formatter';
export type { CommentOutcome } from './comment-formatter';
