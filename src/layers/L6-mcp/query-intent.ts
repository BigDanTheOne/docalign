/**
 * Query intent classifier — maps query keywords to claim types.
 * No LLM required. Pure keyword matching (~40 lines).
 */

import type { ClaimType } from '../../shared/types';

const INTENT_MAP: Record<string, ClaimType[]> = {
  api: ['api_route'],
  endpoint: ['api_route'],
  route: ['api_route'],
  rest: ['api_route'],
  url: ['api_route'],
  deploy: ['command'],
  install: ['command'],
  build: ['command'],
  run: ['command'],
  test: ['command'],
  setup: ['command'],
  start: ['command'],
  script: ['command'],
  config: ['config', 'environment'],
  configuration: ['config', 'environment'],
  env: ['environment'],
  environment: ['environment'],
  variable: ['environment'],
  secret: ['environment'],
  file: ['path_reference'],
  path: ['path_reference'],
  directory: ['path_reference'],
  folder: ['path_reference'],
  version: ['dependency_version'],
  package: ['dependency_version'],
  dependency: ['dependency_version'],
  library: ['dependency_version'],
  example: ['code_example'],
  import: ['code_example'],
  snippet: ['code_example'],
  usage: ['code_example'],
  convention: ['convention'],
  pattern: ['convention'],
  style: ['convention'],
  naming: ['convention'],
  architecture: ['architecture'],
  design: ['architecture'],
  structure: ['architecture'],
};

/**
 * Classify a query into claim types based on keyword matching.
 * Returns an array of matching ClaimTypes (may contain duplicates removed).
 */
export function classifyIntent(query: string): ClaimType[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const types = new Set<ClaimType>();

  for (const token of tokens) {
    const matched = INTENT_MAP[token];
    if (matched) {
      for (const t of matched) {
        types.add(t);
      }
    }
  }

  return [...types];
}
