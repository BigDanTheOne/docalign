import type { PreProcessedDoc, RawExtraction } from '../../shared/types';

// === B.1 File Path References ===

const FILE_PATH_PATTERNS = [
  { name: 'backtick_path', regex: /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g },
  { name: 'markdown_link_path', regex: /\[.*?\]\(\.?\/?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\)/g },
  { name: 'text_ref_path', regex: /(?:see|in|at|from|file)\s+[`"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/gi },
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico']);
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.less']);

export function extractPaths(doc: PreProcessedDoc, docFile: string): RawExtraction[] {
  const results: RawExtraction[] = [];
  const lines = doc.cleaned_content.split('\n');

  for (const pattern of FILE_PATH_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const path = match[1];
        if (!passesPathFilters(path, docFile)) continue;

        results.push({
          claim_text: line.trim(),
          claim_type: 'path_reference',
          extracted_value: { type: 'path_reference', path },
          line_number: doc.original_line_map[i],
          pattern_name: pattern.name,
        });
      }
    }
  }

  return results;
}

// Known file extensions — paths without `/` must have one of these
const KNOWN_FILE_EXTENSIONS = new Set([
  // Code
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt', '.scala',
  '.r', '.jl', '.lua', '.pl', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  // Docs
  '.md', '.mdx', '.rst', '.txt', '.html', '.htm', '.adoc', '.tex', '.pdf',
  // Config
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env', '.cfg', '.conf',
  '.properties', '.lock', '.sum', '.mod',
  // Build/infra
  '.sql', '.graphql', '.gql', '.proto', '.wasm', '.wat', '.log', '.csv',
  // Special dot-files
  '.gitignore', '.gitattributes', '.editorconfig', '.eslintrc', '.prettierrc',
  '.dockerignore', '.nvmrc', '.cursorrules',
]);

function passesPathFilters(path: string, docFile: string): boolean {
  if (path.includes('://')) return false;
  const ext = getExtension(path);
  if (IMAGE_EXTENSIONS.has(ext)) return false;
  if (STYLE_EXTENSIONS.has(ext)) return false;
  if (path.startsWith('#')) return false;
  if (path === docFile) return false;
  if (!isValidPath(path)) return false;

  // If path has no directory separator, require a known file extension.
  // This filters out config-key notation like `doc_patterns.include` or `agent.adapter`.
  if (!path.includes('/') && ext && !KNOWN_FILE_EXTENSIONS.has(ext)) return false;

  return true;
}

function getExtension(path: string): string {
  const dotIdx = path.lastIndexOf('.');
  if (dotIdx === -1) return '';
  return path.slice(dotIdx).toLowerCase();
}

// === Appendix C: Path Validation ===

export function isValidPath(path: string): boolean {
  if (path.includes('..')) return false;
  if (path.startsWith('/')) return false;
  if (path.startsWith('file://')) return false;
  if (path.includes('\0')) return false;
  let p = path;
  if (p.startsWith('./')) p = p.slice(2);
  if (p.length === 0) return false;
  if (p.length > 500) return false;
  return true;
}

// === B.4 API Routes ===

const ROUTE_PATTERNS = [
  {
    name: 'http_method_path',
    regex: /(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+[`"]?(\/[a-zA-Z0-9_\-/:{}.*]+)/gi,
  },
];

export function extractApiRoutes(doc: PreProcessedDoc): RawExtraction[] {
  const results: RawExtraction[] = [];
  const lines = doc.cleaned_content.split('\n');

  for (const pattern of ROUTE_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const fullMatch = match[0];
        const routePath = match[1].replace(/[`"]/g, '');
        const method = fullMatch.split(/\s+/)[0].toUpperCase();

        results.push({
          claim_text: line.trim(),
          claim_type: 'api_route',
          extracted_value: { type: 'api_route', method, path: routePath },
          line_number: doc.original_line_map[i],
          pattern_name: pattern.name,
        });
      }
    }
  }

  return results;
}

// === B.2 CLI Commands ===

const KNOWN_RUNNERS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'pip', 'cargo', 'go', 'make', 'docker', 'kubectl',
]);

const COMMAND_BLOCK_REGEX = /```(?:bash|sh|shell|zsh|console)\n([\s\S]*?)```/g;

const COMMAND_INLINE_PATTERNS = [
  {
    name: 'inline_runner_command',
    regex: /`((?:npm|npx|yarn|pnpm|pip|cargo|go|make|docker|kubectl)\s+[^`]+)`/g,
  },
  {
    name: 'run_pattern_command',
    regex: /(?:run|execute|use)\s+`([^`]+)`/gi,
  },
];

export function extractCommands(doc: PreProcessedDoc): RawExtraction[] {
  const results: RawExtraction[] = [];
  const content = doc.cleaned_content;
  const lines = content.split('\n');

  // Code block commands
  const blockRegex = new RegExp(COMMAND_BLOCK_REGEX.source, COMMAND_BLOCK_REGEX.flags);
  let blockMatch;
  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1];
    const blockStartOffset = content.slice(0, blockMatch.index).split('\n').length;
    const commands = parseCommandBlock(blockContent);

    for (const cmd of commands) {
      results.push({
        claim_text: cmd.full,
        claim_type: 'command',
        extracted_value: { type: 'command', runner: cmd.runner, script: cmd.script },
        line_number: doc.original_line_map[blockStartOffset] ?? blockStartOffset + 1,
        pattern_name: 'code_block_command',
      });
    }
  }

  // Inline commands
  for (const pattern of COMMAND_INLINE_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const command = match[1].trim();
        for (const part of splitChainedCommands(command)) {
          const { runner, script } = detectRunner(part);
          results.push({
            claim_text: line.trim(),
            claim_type: 'command',
            extracted_value: { type: 'command', runner, script },
            line_number: doc.original_line_map[i],
            pattern_name: pattern.name,
          });
        }
      }
    }
  }

  return results;
}

function parseCommandBlock(blockContent: string): Array<{ full: string; runner: string; script: string }> {
  const lines = blockContent.split('\n');
  const hasPrompt = lines.some((l) => /^\s*[$>]\s/.test(l));
  const commands: Array<{ full: string; runner: string; script: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip lines that look like ASCII art/diagrams
    if (isAsciiArt(trimmed)) continue;

    if (hasPrompt) {
      const promptMatch = trimmed.match(/^[$>]\s*(.*)/);
      if (!promptMatch) continue;
      const cmd = stripInlineComment(promptMatch[1].trim());
      if (!cmd) continue;
      for (const part of splitChainedCommands(cmd)) {
        const { runner, script } = detectRunner(part);
        commands.push({ full: part, runner, script });
      }
    } else {
      if (trimmed.startsWith('#')) continue;
      const cmd = stripInlineComment(trimmed);
      if (!cmd) continue;
      for (const part of splitChainedCommands(cmd)) {
        const { runner, script } = detectRunner(part);
        commands.push({ full: part, runner, script });
      }
    }
  }

  return commands;
}

/**
 * Split chained commands on && and || operators.
 * e.g., "npm run typecheck && npm run test" → ["npm run typecheck", "npm run test"]
 */
function splitChainedCommands(command: string): string[] {
  const parts = command.split(/\s*(?:&&|\|\|)\s*/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Strip trailing shell-style inline comments (` # comment`).
 * Only strips when `#` is preceded by whitespace to avoid
 * stripping `#` in URLs, anchors, or mid-token positions.
 */
function stripInlineComment(line: string): string {
  const idx = line.indexOf(' #');
  if (idx === -1) return line;
  return line.slice(0, idx).trimEnd();
}

/**
 * Detect lines that are ASCII art/diagrams rather than commands.
 * Matches tree-drawing characters, box-drawing, and diagram lines.
 */
function isAsciiArt(line: string): boolean {
  // Tree structure characters (├, └, │, ─)
  if (/[├└│─┌┐┘┬┴┼]/.test(line)) return true;
  // Box-drawing with +-- or === or |
  if (/^\s*[+|][-=+|]+/.test(line)) return true;
  // Table rows: | content | content |
  if (/^\s*\|.*\|\s*$/.test(line)) return true;
  // Lines that are purely arrows/pipes/spaces
  if (/^\s*[v^|<>]+\s*$/.test(line)) return true;
  return false;
}

function detectRunner(command: string): { runner: string; script: string } {
  const firstWord = command.split(/\s+/)[0].toLowerCase();
  if (KNOWN_RUNNERS.has(firstWord)) {
    let script = command.slice(firstWord.length).trim();
    // For npm/yarn/pnpm: strip 'run ' prefix to get the actual script name
    if (['npm', 'yarn', 'pnpm'].includes(firstWord) && script.startsWith('run ')) {
      script = script.slice(4);
    }
    return { runner: firstWord, script };
  }
  return { runner: 'unknown', script: command };
}

// === B.3 Dependency Versions ===

const RUNTIME_NAMES = new Set(['node.js', 'nodejs', 'python', 'ruby', 'go', 'rust', 'java']);

const VERSION_PATTERNS = [
  { name: 'word_version', regex: /(\w+(?:\.\w+)?)\s+v?(\d+\.\d+(?:\.\d+)?)/gi },
  { name: 'explicit_version', regex: /(\w+(?:\.\w+)?)\s+(?:version\s+)?[v^~]?(\d+[\d.]*)/gi },
  { name: 'runtime_version', regex: /(?:Node\.?js|Python|Ruby|Go|Rust|Java)\s+(\d+[\d.+]*)/gi },
];

export function extractDependencyVersions(
  doc: PreProcessedDoc,
  knownPackages: Set<string>,
): RawExtraction[] {
  const results: RawExtraction[] = [];
  const lines = doc.cleaned_content.split('\n');

  // Runtime versions first (always kept)
  const runtimeRegex = new RegExp(VERSION_PATTERNS[2].regex.source, VERSION_PATTERNS[2].regex.flags);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    const regex = new RegExp(runtimeRegex.source, runtimeRegex.flags);
    while ((match = regex.exec(line)) !== null) {
      const runtime = match[0].split(/\s+/)[0];
      const version = match[1];
      results.push({
        claim_text: line.trim(),
        claim_type: 'dependency_version',
        extracted_value: { type: 'dependency_version', package: runtime, version },
        line_number: doc.original_line_map[i],
        pattern_name: 'runtime_version',
      });
    }
  }

  // Word version and explicit version patterns
  for (let p = 0; p < 2; p++) {
    const pattern = VERSION_PATTERNS[p];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const packageName = match[1];
        const version = match[2];

        // Validate: must be a known dependency or a runtime
        const isRuntime = RUNTIME_NAMES.has(packageName.toLowerCase());
        const isKnown = knownPackages.has(packageName) ||
          knownPackages.has(packageName.toLowerCase());

        if (!isKnown && !isRuntime) continue;

        results.push({
          claim_text: line.trim(),
          claim_type: 'dependency_version',
          extracted_value: { type: 'dependency_version', package: packageName, version },
          line_number: doc.original_line_map[i],
          pattern_name: pattern.name,
        });
      }
    }
  }

  return results;
}

// === B.5 Code Example Blocks ===

const CODE_EXAMPLE_REGEX = /```(\w*)\n([\s\S]*?)```/g;
const CLI_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

const IMPORT_PATTERNS = [
  /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /from\s+(\S+)\s+import/g,
];

const SYMBOL_PATTERN_PASCAL = /([A-Z][a-zA-Z0-9]*)\s*\(/g;
const SYMBOL_PATTERN_CAMEL = /([a-z][a-zA-Z0-9]*)\s*\(/g;

export function extractCodeExamples(doc: PreProcessedDoc): RawExtraction[] {
  const results: RawExtraction[] = [];
  const content = doc.cleaned_content;

  const regex = new RegExp(CODE_EXAMPLE_REGEX.source, CODE_EXAMPLE_REGEX.flags);
  let match;
  while ((match = regex.exec(content)) !== null) {
    const language = match[1] || null;
    const blockContent = match[2];

    // Skip CLI-only blocks
    if (language && CLI_LANGUAGES.has(language.toLowerCase())) continue;

    const blockStartLine = content.slice(0, match.index).split('\n').length;
    const lineNum = doc.original_line_map[blockStartLine - 1] ?? blockStartLine;

    const imports = extractImportsFromBlock(blockContent);
    const symbols = extractSymbolsFromBlock(blockContent);
    const commands = extractCommandsFromBlock(blockContent);

    results.push({
      claim_text: blockContent.trim().slice(0, 200),
      claim_type: 'code_example',
      extracted_value: {
        type: 'code_example',
        language,
        imports,
        symbols,
        commands,
      },
      line_number: lineNum,
      pattern_name: 'fenced_code_block',
    });
  }

  return results;
}

function extractImportsFromBlock(content: string): string[] {
  const imports: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (!imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }
  }
  return imports;
}

function extractSymbolsFromBlock(content: string): string[] {
  const symbols = new Set<string>();

  let match;
  const pascalRegex = new RegExp(SYMBOL_PATTERN_PASCAL.source, SYMBOL_PATTERN_PASCAL.flags);
  while ((match = pascalRegex.exec(content)) !== null) {
    symbols.add(match[1]);
  }

  const camelRegex = new RegExp(SYMBOL_PATTERN_CAMEL.source, SYMBOL_PATTERN_CAMEL.flags);
  while ((match = camelRegex.exec(content)) !== null) {
    // Skip very common false positives
    const name = match[1];
    if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'var', 'let', 'const', 'function'].includes(name)) {
      symbols.add(name);
    }
  }

  return Array.from(symbols);
}

function extractCommandsFromBlock(content: string): string[] {
  const commands: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const promptMatch = trimmed.match(/^[$>]\s*(.*)/);
    if (promptMatch) {
      const cmd = promptMatch[1].trim();
      if (cmd && !commands.includes(cmd)) commands.push(cmd);
    }
  }

  return commands;
}

// === Appendix E: Deduplication ===

export function deduplicateWithinFile(extractions: RawExtraction[]): RawExtraction[] {
  const seen = new Map<string, RawExtraction>();

  for (const extraction of extractions) {
    const key = getIdentityKey(extraction);
    if (!seen.has(key)) {
      seen.set(key, extraction);
    }
  }

  return Array.from(seen.values());
}

export function getIdentityKey(extraction: RawExtraction): string {
  const ev = extraction.extracted_value as Record<string, unknown>;
  switch (extraction.claim_type) {
    case 'path_reference':
      return 'path:' + (ev.path as string);
    case 'command':
      return 'cmd:' + (ev.runner as string) + ':' + (ev.script as string);
    case 'dependency_version':
      return 'dep:' + (ev.package as string);
    case 'api_route':
      return 'route:' + (ev.method as string) + ':' + (ev.path as string);
    case 'code_example':
      return 'code:' + extraction.line_number;
    default:
      return extraction.claim_type + ':' + extraction.claim_text;
  }
}

// === Appendix F: Keyword Generation ===

export function generateKeywords(extraction: RawExtraction): string[] {
  const ev = extraction.extracted_value as Record<string, unknown>;

  switch (extraction.claim_type) {
    case 'path_reference': {
      const p = ev.path as string;
      const parts = p.split('/');
      const filename = parts[parts.length - 1];
      const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
      return unique([nameWithoutExt, ...parts.filter((s) => s.length > 2)]);
    }
    case 'command':
      return [ev.runner as string, ev.script as string].filter(Boolean);
    case 'dependency_version': {
      const pkg = ev.package as string;
      return unique([pkg, pkg.replace(/[-_.]js$/i, '')]);
    }
    case 'api_route': {
      const segments = (ev.path as string)
        .split('/')
        .filter((s) => s.length > 0 && !s.startsWith(':') && !s.startsWith('{'));
      return [ev.method as string, ...segments];
    }
    case 'code_example': {
      const imports = (ev.imports as string[]) || [];
      const symbols = (ev.symbols as string[]) || [];
      const commands = (ev.commands as string[]) || [];
      return unique([
        ...imports.map((i) => i.split('/').pop()!),
        ...symbols,
        ...commands.map((c) => c.split(' ')[0]),
      ].filter(Boolean));
    }
    default:
      return [];
  }
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}
