/**
 * Barrel export for the tags module.
 */
export { parseTags, parseTag } from './parser';
export type { DocTag } from './parser';

export { writeTags, writeTagsToFile, blankSemanticClaimLines } from './writer';
export type { TaggableClaim, TagWriteResult } from './writer';
