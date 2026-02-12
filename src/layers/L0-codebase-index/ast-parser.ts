import path from 'path';
import { Parser, Language, type Node } from 'web-tree-sitter';
import type {
  SupportedLanguage,
  ExtensionMap,
  ParsedFileResult,
  ParsedEntity,
} from '../../shared/types';

// === Extension map (TDD-0 Appendix B) ===

export const EXTENSION_MAP: ExtensionMap = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

const MANIFEST_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Makefile',
  'Dockerfile',
]);

export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = path.extname(filePath);
  return EXTENSION_MAP[ext] ?? null;
}

export function isSupportedCodeFile(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

export function isManifestFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return MANIFEST_FILES.has(basename);
}

// === Grammar loading ===

let parserInitialized = false;
const loadedGrammars = new Map<SupportedLanguage, Language>();

/**
 * Initialize the tree-sitter WASM runtime. Must be called once before parsing.
 */
export async function initParser(): Promise<void> {
  if (parserInitialized) return;
  await Parser.init();
  parserInitialized = true;
}

/**
 * Load a language grammar WASM file.
 */
async function loadGrammar(language: SupportedLanguage): Promise<Language> {
  const cached = loadedGrammars.get(language);
  if (cached) return cached;

  let wasmPath: string;
  switch (language) {
    case 'typescript':
      wasmPath = require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
      break;
    case 'javascript':
      wasmPath = require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');
      break;
    case 'python':
      wasmPath = require.resolve('tree-sitter-python/tree-sitter-python.wasm');
      break;
  }

  const grammar = await Language.load(wasmPath);
  loadedGrammars.set(language, grammar);
  return grammar;
}

// === Entity extraction ===

/**
 * Parse a source file and extract structural entities.
 */
export async function parseFile(
  filePath: string,
  content: string,
): Promise<ParsedFileResult | null> {
  const language = detectLanguage(filePath);
  if (!language) return null;

  if (!parserInitialized) {
    await initParser();
  }

  const grammar = await loadGrammar(language);
  const parser = new Parser();
  parser.setLanguage(grammar);

  const startTime = performance.now();
  const tree = parser.parse(content);
  const parseDuration = performance.now() - startTime;

  if (!tree) {
    parser.delete();
    return null;
  }

  const entities: ParsedEntity[] = [];

  if (language === 'typescript' || language === 'javascript') {
    extractTsJsEntities(tree.rootNode, content, entities);
  } else if (language === 'python') {
    extractPythonEntities(tree.rootNode, content, entities);
  }

  const result: ParsedFileResult = {
    file_path: filePath,
    language,
    entities,
    has_errors: tree.rootNode.hasError,
    parse_duration_ms: Math.round(parseDuration * 100) / 100,
  };

  parser.delete();
  tree.delete();

  return result;
}

// === TS/JS entity extraction ===

function extractTsJsEntities(
  root: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  // Walk top-level children looking for exports
  for (const child of root.children) {
    if (child.type === 'export_statement') {
      extractFromExport(child, source, entities);
    }
    // Also catch route definitions at top level
    if (child.type === 'expression_statement') {
      extractRouteFromExpression(child, source, entities);
    }
  }
}

function extractFromExport(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  for (const child of node.children) {
    switch (child.type) {
      case 'function_declaration':
        extractFunctionDeclaration(child, source, entities);
        break;
      case 'lexical_declaration':
        extractLexicalDeclaration(child, source, entities);
        break;
      case 'class_declaration':
        extractClassDeclaration(child, source, entities);
        break;
      case 'interface_declaration':
        extractInterfaceDeclaration(child, source, entities);
        break;
      case 'type_alias_declaration':
        extractTypeAliasDeclaration(child, source, entities);
        break;
    }
  }
}

function extractFunctionDeclaration(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  entities.push({
    name: nameNode.text,
    entity_type: 'function',
    line_number: node.startPosition.row + 1,
    end_line_number: node.endPosition.row + 1,
    signature: getSignature(node, source),
    raw_code: node.text,
  });
}

function extractLexicalDeclaration(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  for (const declarator of node.children) {
    if (declarator.type !== 'variable_declarator') continue;

    const nameNode = declarator.childForFieldName('name');
    const valueNode = declarator.childForFieldName('value');
    if (!nameNode || !valueNode) continue;

    if (valueNode.type === 'arrow_function') {
      entities.push({
        name: nameNode.text,
        entity_type: 'function',
        line_number: node.startPosition.row + 1,
        end_line_number: node.endPosition.row + 1,
        signature: getSignature(node, source),
        raw_code: node.text,
      });
    }
  }
}

function extractClassDeclaration(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  entities.push({
    name: nameNode.text,
    entity_type: 'class',
    line_number: node.startPosition.row + 1,
    end_line_number: node.endPosition.row + 1,
    signature: `class ${nameNode.text}`,
    raw_code: node.text,
  });
}

function extractInterfaceDeclaration(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  entities.push({
    name: nameNode.text,
    entity_type: 'type',
    line_number: node.startPosition.row + 1,
    end_line_number: node.endPosition.row + 1,
    signature: `interface ${nameNode.text}`,
    raw_code: node.text,
  });
}

function extractTypeAliasDeclaration(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  entities.push({
    name: nameNode.text,
    entity_type: 'type',
    line_number: node.startPosition.row + 1,
    end_line_number: node.endPosition.row + 1,
    signature: `type ${nameNode.text}`,
    raw_code: node.text,
  });
}

function extractRouteFromExpression(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const expr = node.children[0];
  if (!expr || expr.type !== 'call_expression') return;

  const funcNode = expr.childForFieldName('function');
  if (!funcNode || funcNode.type !== 'member_expression') return;

  const methodNode = funcNode.childForFieldName('property');
  if (!methodNode) return;

  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
  if (!httpMethods.has(methodNode.text)) return;

  const argsNode = expr.childForFieldName('arguments');
  if (!argsNode) return;

  // Find the first string argument (the route path)
  for (const arg of argsNode.children) {
    if (arg.type === 'string' || arg.type === 'template_string') {
      const routePath = extractStringContent(arg);
      if (!routePath) continue;

      const method = methodNode.text.toUpperCase();
      entities.push({
        name: `${method} ${routePath}`,
        entity_type: 'route',
        line_number: node.startPosition.row + 1,
        end_line_number: node.startPosition.row + 1,
        signature: node.text.trim(),
        raw_code: node.text,
      });
      break;
    }
  }
}

// === Python entity extraction ===

function extractPythonEntities(
  root: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  for (const child of root.children) {
    if (child.type === 'function_definition') {
      extractPythonFunction(child, source, entities);
    } else if (child.type === 'class_definition') {
      extractPythonClass(child, source, entities);
    } else if (child.type === 'decorated_definition') {
      extractPythonDecorated(child, source, entities);
    }
  }
}

function extractPythonFunction(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  entities.push({
    name: nameNode.text,
    entity_type: 'function',
    line_number: node.startPosition.row + 1,
    end_line_number: node.endPosition.row + 1,
    signature: getPythonSignature(node),
    raw_code: node.text,
  });
}

function extractPythonClass(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  entities.push({
    name: nameNode.text,
    entity_type: 'class',
    line_number: node.startPosition.row + 1,
    end_line_number: node.endPosition.row + 1,
    signature: `class ${nameNode.text}`,
    raw_code: node.text,
  });
}

function extractPythonDecorated(
  node: Node,
  source: string,
  entities: ParsedEntity[],
): void {
  // Check for route decorators
  const decorators: Node[] = [];
  let definition: Node | null = null;

  for (const child of node.children) {
    if (child.type === 'decorator') {
      decorators.push(child);
    } else if (child.type === 'function_definition') {
      definition = child;
    } else if (child.type === 'class_definition') {
      definition = child;
    }
  }

  if (!definition) return;

  // Check if any decorator is a route decorator
  let routeInfo: { method: string; routePath: string } | null = null;

  for (const dec of decorators) {
    routeInfo = extractPythonRouteDecorator(dec);
    if (routeInfo) break;
  }

  if (routeInfo && definition.type === 'function_definition') {
    entities.push({
      name: `${routeInfo.method} ${routeInfo.routePath}`,
      entity_type: 'route',
      line_number: node.startPosition.row + 1,
      end_line_number: node.startPosition.row + 1,
      signature: node.text.split('\n')[0],
      raw_code: node.text,
    });
  }

  // Also extract the function/class itself
  if (definition.type === 'function_definition') {
    extractPythonFunction(definition, source, entities);
  } else if (definition.type === 'class_definition') {
    extractPythonClass(definition, source, entities);
  }
}

function extractPythonRouteDecorator(
  decorator: Node,
): { method: string; routePath: string } | null {
  // Find the call node inside the decorator
  const callNode = findChildByType(decorator, 'call');
  if (!callNode) return null;

  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || funcNode.type !== 'attribute') return null;

  const attrNode = funcNode.childForFieldName('attribute');
  if (!attrNode) return null;

  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

  // Flask/FastAPI: @app.get('/path') or @app.route('/path')
  if (httpMethods.has(attrNode.text)) {
    const argsNode = callNode.childForFieldName('arguments');
    const routePath = extractFirstStringArg(argsNode);
    if (routePath) {
      return { method: attrNode.text.toUpperCase(), routePath };
    }
  }

  if (attrNode.text === 'route') {
    // Flask: @app.route('/path', methods=['GET'])
    const argsNode = callNode.childForFieldName('arguments');
    const routePath = extractFirstStringArg(argsNode);
    if (routePath) {
      // Try to find methods= keyword argument
      const methods = extractMethodsKwarg(argsNode);
      const method = methods.length > 0 ? methods[0] : 'GET';
      return { method, routePath };
    }
  }

  return null;
}

// === Helper functions ===

function getSignature(node: Node, _source: string): string {
  // Get first line of the node text as signature
  const text = node.text;
  const firstLine = text.split('\n')[0];
  // Cap at 200 chars
  return firstLine.length > 200 ? firstLine.slice(0, 200) + '...' : firstLine;
}

function getPythonSignature(node: Node): string {
  const nameNode = node.childForFieldName('name');
  const paramsNode = node.childForFieldName('parameters');
  const returnType = node.childForFieldName('return_type');

  let sig = `def ${nameNode?.text ?? '?'}`;
  if (paramsNode) sig += paramsNode.text;
  if (returnType) sig += ` -> ${returnType.text}`;
  return sig;
}

function extractStringContent(node: Node): string | null {
  // For string nodes, the content is inside string_fragment children
  for (const child of node.children) {
    if (child.type === 'string_fragment' || child.type === 'string_content') {
      return child.text;
    }
  }
  // Fallback: strip quotes
  const text = node.text;
  if ((text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return null;
}

function extractFirstStringArg(argsNode: Node | null): string | null {
  if (!argsNode) return null;
  for (const child of argsNode.children) {
    if (child.type === 'string') {
      return extractStringContent(child);
    }
  }
  return null;
}

function extractMethodsKwarg(argsNode: Node | null): string[] {
  if (!argsNode) return [];
  for (const child of argsNode.children) {
    if (child.type === 'keyword_argument') {
      const nameNode = child.childForFieldName('name');
      if (nameNode && nameNode.text === 'methods') {
        const valueNode = child.childForFieldName('value');
        if (valueNode && valueNode.type === 'list') {
          const methods: string[] = [];
          for (const item of valueNode.children) {
            if (item.type === 'string') {
              const text = extractStringContent(item);
              if (text) methods.push(text.toUpperCase());
            }
          }
          return methods;
        }
      }
    }
  }
  return [];
}

function findChildByType(node: Node, type: string): Node | null {
  for (const child of node.children) {
    if (child.type === type) return child;
    const found = findChildByType(child, type);
    if (found) return found;
  }
  return null;
}
