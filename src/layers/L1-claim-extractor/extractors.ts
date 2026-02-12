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
  const exampleSections = buildExampleSectionLines(lines);

  for (const pattern of FILE_PATH_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (doc.code_fence_lines.has(i)) continue; // Skip code fence content
      if (exampleSections.has(i)) continue; // Skip example sections
      const line = lines[i];
      if (isIllustrativeLine(line)) continue; // Skip example/illustrative content
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

/**
 * Detect lines that contain illustrative/example paths rather than real references.
 * Catches: table rows, "e.g." context, quoted example strings, hypothetical scenarios,
 * and lines that describe generic file patterns rather than specific file references.
 */
function isIllustrativeLine(line: string): boolean {
  const trimmed = line.trim();
  // Markdown table rows: | content | content |
  if (/^\|.*\|.*\|/.test(trimmed)) return true;
  // Lines with "e.g.", "for example", "such as" — path is illustrative
  if (/\b(?:e\.g\.|for example|such as)\b/i.test(trimmed)) return true;
  // Lines describing output format
  if (/^(?:outputs?|produces?|returns?|shows?|displays?|prints?)\s*:/i.test(trimmed)) return true;
  // Quoted example strings: lines starting with `- "...` (bullet with quoted example)
  if (/^[-*]\s+"/.test(trimmed)) return true;
  // Lines starting with a blockquote that contains a quoted string
  if (/^>\s.*"/.test(trimmed)) return true;
  // Hypothetical / conditional scenarios: "If X and Y ..."
  if (/\bif\s+`[^`]+`\s+and\s+`[^`]+`/i.test(trimmed)) return true;
  // Lines listing glob patterns (e.g., "docs/**/*.md", "*.md")
  if (/\*\*\/\*\.\w+/.test(trimmed) || /^\d+\.\s+\b(?:identify|find|discover|locate)\b/i.test(trimmed)) return true;
  // Lines describing where something "is configured in" (generic documentation)
  if (/\bconfigured\s+in\s+`[^`]+`,\s+`[^`]+`/i.test(trimmed)) return true;
  return false;
}

/**
 * Build a set of line indices that fall under an "examples" heading/label.
 * Lines following a heading like "**Filename examples**:" or "### Examples"
 * until the next heading are considered illustrative.
 */
function buildExampleSectionLines(lines: string[]): Set<number> {
  const exampleLines = new Set<number>();
  let inExampleSection = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Check if this is an "examples" heading
    const isExampleHeading =
      /^#+\s+.*\bexamples?\b/i.test(trimmed) ||
      /^\*\*.*\bexamples?\b.*\*\*\s*:?\s*$/i.test(trimmed) ||
      /^.*\bexamples?\s*:?\s*$/i.test(trimmed) && trimmed.length < 40;

    if (isExampleHeading) {
      inExampleSection = true;
      exampleLines.add(i);
      continue;
    }

    // End example section on next heading (any level)
    if (inExampleSection && /^#{1,6}\s/.test(trimmed)) {
      inExampleSection = false;
    }

    // End example section on bold label (new subsection)
    if (inExampleSection && /^\*\*[^*]+\*\*\s*:/.test(trimmed) && !/example/i.test(trimmed)) {
      inExampleSection = false;
    }

    if (inExampleSection) {
      exampleLines.add(i);
    }
  }

  return exampleLines;
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

  // Paths ending in a purely numeric "extension" are likely model identifiers
  // (e.g., "openai/gpt-5.2", "zai/glm-4.7") or version references, not file paths.
  if (/\.\d+$/.test(path)) return false;

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

/**
 * Detect lines describing external API routes (not routes in this codebase).
 * Lines mentioning "its API", "their API", "external API", or "REST API" with
 * context about talking to another service are external references.
 */
function isExternalApiLine(line: string): boolean {
  const lower = line.toLowerCase();
  // "through its REST API", "its HTTP API", "their API"
  if (/\b(?:its|their|the\s+\w+(?:'s)?)\s+(?:rest\s+)?api\b/i.test(line)) return true;
  // "external API", "third-party API"
  if (/\b(?:external|third[- ]party)\s+(?:rest\s+)?api\b/i.test(line)) return true;
  // "calls X API at", "hits the X endpoint"
  if (/\b(?:calls?|hits?|sends?\s+to|talks?\s+to)\b.*\bapi\b/i.test(line)) return true;
  // Lines with explicit URL hosts: "http://localhost:3000/api"
  if (/https?:\/\/\S+\//.test(lower)) return true;
  return false;
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
      if (doc.code_fence_lines.has(i)) continue;
      const line = lines[i];
      if (isIllustrativeLine(line)) continue;
      if (isExternalApiLine(line)) continue;
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
      if (doc.code_fence_lines.has(i)) continue;
      const line = lines[i];
      if (isIllustrativeLine(line)) continue;
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

    // Skip directory tree / diagram blocks
    if (isDirectoryTreeBlock(blockContent)) continue;

    // Skip prose-heavy blocks (e.g., LLM prompts, schema descriptions) without a language tag
    if (!language && isProseBlock(blockContent)) continue;

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

/**
 * Detect directory tree / diagram code blocks.
 * Blocks where >30% of non-empty lines contain tree-drawing characters.
 */
function isDirectoryTreeBlock(content: string): boolean {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return false;
  const treeLines = lines.filter(
    (l) => /[├└│─┌┐┘┬┴┼]/.test(l) || /^\s*[+|][-=+|]+/.test(l.trim()),
  );
  return treeLines.length / lines.length > 0.3;
}

/**
 * Detect prose-heavy code blocks (LLM prompts, schema descriptions, etc.).
 * Returns true if the block has few code-like tokens and looks like natural language.
 */
const CODE_TOKENS = /[;{}=>[\]]/;
const CODE_KEYWORDS = /\b(?:import|export|const|let|var|function|class|def|fn|pub|use|return|async|await)\b/;

function isProseBlock(content: string): boolean {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return false;
  const codeLines = lines.filter((l) => CODE_TOKENS.test(l) || CODE_KEYWORDS.test(l));
  // If less than 20% of lines look like code, it's probably prose
  return codeLines.length / lines.length < 0.2;
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
    const name = match[1];
    // Skip language keywords
    if (['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'var', 'let', 'const', 'function'].includes(name)) continue;
    // Skip purely lowercase words — not actually camelCase, likely English words
    // that happen to precede '(' in prose (e.g., "claim (e.g.", "wrong (because")
    if (!/[A-Z]/.test(name)) continue;
    symbols.add(name);
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

// === V2: Environment Claims ===

/**
 * Extract environment-related claims: runtime version requirements and env var documentation.
 * Produces claims with claim_type 'environment' for Tier 2 verification (D.4 & D.5).
 */

const ENV_RUNTIME_PATTERNS = [
  {
    name: 'runtime_requirement',
    regex: /\b(Node\.?js|Python|Ruby|Go|Rust|Java|Deno|Bun)\s+(?:[Vv]ersion\s+)?[v>=~^]*\s*(\d+(?:\.\d+)*\+?)/g,
  },
];

const ENV_VAR_INSTRUCTION_PATTERNS = [
  {
    name: 'env_var_set_instruction',
    regex: /(?:[Ss]et|[Cc]onfigure|[Dd]efine|[Ee]xport)\s+(?:[Tt]he\s+)?`?([A-Z][A-Z0-9_]{2,})`?/g,
  },
  {
    name: 'env_var_required',
    regex: /`?([A-Z][A-Z0-9_]{2,})`?\s+(?:[Ii]s\s+)?(?:[Rr]equired|[Nn]eeded|[Mm]ust\s+be\s+set)/g,
  },
  {
    name: 'env_var_env_context',
    regex: /(?:[Ee]nvironment\s+[Vv]ariable|[Ee]nv\s+[Vv]ar)\s+`?([A-Z][A-Z0-9_]{2,})`?/g,
  },
];

const ENV_VAR_FALSE_POSITIVES = new Set([
  'README', 'TODO', 'NOTE', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON', 'HTML', 'CSS',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  'TRUE', 'FALSE', 'NULL', 'UNDEFINED',
  'MIT', 'BSD', 'ISC', 'GPL',
  'TDD', 'MVP', 'POC', 'WIP', 'LLM',
  'FIXME', 'HACK', 'XXX', 'TEMP',
  'SQL', 'CLI', 'GUI', 'IDE', 'EOF',
  'MCP', 'AST', 'ADR', 'SSO', 'HMAC', 'WASM',
  // System / shell variables
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'EDITOR',
  'DISPLAY', 'TMPDIR', 'PWD', 'HOSTNAME',
]);

export function extractEnvironmentClaims(doc: PreProcessedDoc): RawExtraction[] {
  const results: RawExtraction[] = [];
  const lines = doc.cleaned_content.split('\n');

  // Runtime version requirements
  for (let i = 0; i < lines.length; i++) {
    if (doc.code_fence_lines.has(i)) continue;
    const line = lines[i];
    for (const pattern of ENV_RUNTIME_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const runtime = match[1];
        const version = match[2];
        results.push({
          claim_text: line.trim(),
          claim_type: 'environment',
          extracted_value: { type: 'environment', runtime, version },
          line_number: doc.original_line_map[i],
          pattern_name: pattern.name,
        });
      }
    }
  }

  // Environment variable documentation
  for (let i = 0; i < lines.length; i++) {
    if (doc.code_fence_lines.has(i)) continue;
    const line = lines[i];
    for (const pattern of ENV_VAR_INSTRUCTION_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const envVar = match[1];
        if (ENV_VAR_FALSE_POSITIVES.has(envVar)) continue;
        results.push({
          claim_text: line.trim(),
          claim_type: 'environment',
          extracted_value: { type: 'environment', env_var: envVar },
          line_number: doc.original_line_map[i],
          pattern_name: pattern.name,
        });
      }
    }
  }

  return results;
}

// === V2: Convention Claims ===

/**
 * Extract convention claims: strict mode, framework usage.
 * Produces claims with claim_type 'convention' for Tier 2 verification (D.1 & D.2).
 */

const STRICT_MODE_PATTERNS = [
  {
    name: 'strict_mode_convention',
    regex: /\b(?:strict\s+mode|strict:\s*true|strict\s+typescript|typescript\s+strict)\b/gi,
  },
];

const FRAMEWORK_USAGE_PATTERNS = [
  {
    name: 'framework_convention',
    regex: /\b(?:built\s+with|uses?|powered\s+by|based\s+on|made\s+with)\s+`?([\w.]+)`?/gi,
  },
];

const KNOWN_FRAMEWORKS = new Set([
  'react', 'vue', 'angular', 'svelte', 'solid', 'preact', 'lit',
  'next', 'nextjs', 'next.js', 'nuxt', 'nuxtjs', 'nuxt.js', 'gatsby', 'remix', 'astro',
  'express', 'fastify', 'koa', 'hapi', 'nest', 'nestjs',
  'django', 'flask', 'fastapi', 'rails', 'spring', 'laravel',
  'tailwind', 'bootstrap', 'jest', 'vitest', 'mocha', 'cypress', 'playwright',
  'prisma', 'sequelize', 'mongoose', 'typeorm', 'drizzle',
  'webpack', 'vite', 'rollup', 'esbuild', 'turbopack', 'parcel',
  'docker', 'kubernetes', 'terraform',
  'typescript', 'graphql', 'redis', 'postgresql', 'mongodb', 'sqlite',
  'electron', 'tauri', 'deno', 'bun',
]);

export function extractConventionClaims(doc: PreProcessedDoc): RawExtraction[] {
  const results: RawExtraction[] = [];
  const lines = doc.cleaned_content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (doc.code_fence_lines.has(i)) continue;
    const line = lines[i];

    // Strict mode mentions
    for (const pattern of STRICT_MODE_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      if (regex.test(line)) {
        results.push({
          claim_text: line.trim(),
          claim_type: 'convention',
          extracted_value: { type: 'convention', convention: 'strict_mode' },
          line_number: doc.original_line_map[i],
          pattern_name: pattern.name,
        });
        break; // One strict mode claim per line
      }
    }

    // Framework usage mentions
    for (const pattern of FRAMEWORK_USAGE_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const framework = match[1].toLowerCase();
        if (KNOWN_FRAMEWORKS.has(framework)) {
          results.push({
            claim_text: line.trim(),
            claim_type: 'convention',
            extracted_value: { type: 'convention', framework: match[1] },
            line_number: doc.original_line_map[i],
            pattern_name: pattern.name,
          });
        }
      }
    }
  }

  return results;
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
    case 'environment': {
      const envVar = ev.env_var as string | undefined;
      const runtime = ev.runtime as string | undefined;
      if (envVar) return 'env:var:' + envVar;
      if (runtime) return 'env:runtime:' + runtime;
      return 'env:' + extraction.claim_text;
    }
    case 'convention': {
      const convention = ev.convention as string | undefined;
      const fw = ev.framework as string | undefined;
      if (convention) return 'conv:' + convention;
      if (fw) return 'conv:fw:' + (fw as string).toLowerCase();
      return 'conv:' + extraction.claim_text;
    }
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
    case 'environment': {
      const keywords: string[] = [];
      if (ev.env_var) keywords.push(ev.env_var as string);
      if (ev.runtime) keywords.push(ev.runtime as string);
      if (ev.version) keywords.push(ev.version as string);
      return keywords;
    }
    case 'convention': {
      const keywords: string[] = [];
      if (ev.convention) keywords.push(ev.convention as string);
      if (ev.framework) keywords.push(ev.framework as string);
      return keywords;
    }
    default:
      return [];
  }
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}
