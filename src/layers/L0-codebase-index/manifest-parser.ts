import path from 'path';
import type { ParsedManifest } from '../../shared/types';

/**
 * Parse a package manifest file and extract dependencies and scripts.
 * TDD-0 Section 6 + Appendix B manifest parsing knowledge.
 */
export function parseManifest(filePath: string, content: string): ParsedManifest | null {
  const basename = path.basename(filePath);

  switch (basename) {
    case 'package.json':
      return parsePackageJson(filePath, content);
    case 'package-lock.json':
      return parsePackageLockJson(filePath, content);
    case 'requirements.txt':
      return parseRequirementsTxt(filePath, content);
    case 'pyproject.toml':
      return parsePyprojectToml(filePath, content);
    case 'Makefile':
      return parseMakefile(filePath, content);
    case 'yarn.lock':
      return parseYarnLock(filePath, content);
    case 'pnpm-lock.yaml':
      return parsePnpmLock(filePath, content);
    case 'Cargo.toml':
      return parseCargoToml(filePath, content);
    case 'go.mod':
      return parseGoMod(filePath, content);
    default:
      return null;
  }
}

// === package.json ===

function parsePackageJson(filePath: string, content: string): ParsedManifest | null {
  try {
    const pkg = JSON.parse(content);
    return {
      file_path: filePath,
      dependencies: flattenDeps(pkg.dependencies),
      dev_dependencies: flattenDeps(pkg.devDependencies),
      scripts: pkg.scripts && typeof pkg.scripts === 'object' ? { ...pkg.scripts } : {},
      source: 'manifest',
    };
  } catch {
    return null;
  }
}

function flattenDeps(deps: unknown): Record<string, string> {
  if (!deps || typeof deps !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version === 'string') {
      result[name] = version;
    }
  }
  return result;
}

// === package-lock.json (v3 format) ===

function parsePackageLockJson(filePath: string, content: string): ParsedManifest | null {
  try {
    const lock = JSON.parse(content);
    const dependencies: Record<string, string> = {};

    // v3 format: packages[""].dependencies
    if (lock.packages && lock.packages['']) {
      const root = lock.packages[''];
      if (root.dependencies) {
        for (const [name, version] of Object.entries(root.dependencies)) {
          if (typeof version === 'string') {
            dependencies[name] = version;
          }
        }
      }
      if (root.devDependencies) {
        for (const [name, version] of Object.entries(root.devDependencies)) {
          if (typeof version === 'string') {
            dependencies[name] = version;
          }
        }
      }
    }

    // Also extract resolved versions from packages
    if (lock.packages) {
      for (const [pkgPath, pkgData] of Object.entries(lock.packages)) {
        if (pkgPath === '' || !pkgPath.startsWith('node_modules/')) continue;
        const data = pkgData as Record<string, unknown>;
        const name = pkgPath.replace(/^node_modules\//, '');
        if (typeof data.version === 'string' && !dependencies[name]) {
          dependencies[name] = data.version;
        }
      }
    }

    return {
      file_path: filePath,
      dependencies,
      dev_dependencies: {},
      scripts: {},
      source: 'lockfile',
    };
  } catch {
    return null;
  }
}

// === requirements.txt ===

function parseRequirementsTxt(filePath: string, content: string): ParsedManifest | null {
  const dependencies: Record<string, string> = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;

    // Match: package==version, package>=version, package~=version, package!=version
    const match = line.match(/^([a-zA-Z0-9_-][a-zA-Z0-9._-]*)\s*([=<>!~]+)\s*(.+?)(?:\s*;.*)?$/);
    if (match) {
      dependencies[match[1]] = `${match[2]}${match[3]}`;
    } else {
      // Bare package name (no version constraint)
      const nameMatch = line.match(/^([a-zA-Z0-9_-][a-zA-Z0-9._-]*)/);
      if (nameMatch) {
        dependencies[nameMatch[1]] = '*';
      }
    }
  }

  return {
    file_path: filePath,
    dependencies,
    dev_dependencies: {},
    scripts: {},
    source: 'manifest',
  };
}

// === pyproject.toml ===

function parsePyprojectToml(filePath: string, content: string): ParsedManifest | null {
  const dependencies: Record<string, string> = {};
  const scripts: Record<string, string> = {};

  // Simple TOML parsing for dependencies (avoid external deps)
  // Match [project].dependencies array
  const depArrayMatch = content.match(/\[project\]\s*[\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depArrayMatch) {
    const items = depArrayMatch[1].match(/"([^"]+)"/g) || depArrayMatch[1].match(/'([^']+)'/g);
    if (items) {
      for (const item of items) {
        const clean = item.replace(/['"]/g, '');
        const parts = clean.match(/^([a-zA-Z0-9_-][a-zA-Z0-9._-]*)\s*([>=<~!]+.*)?$/);
        if (parts) {
          dependencies[parts[1]] = parts[2] || '*';
        }
      }
    }
  }

  // Match [tool.poetry.dependencies]
  const poetrySection = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetrySection) {
    const lines = poetrySection[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-][a-zA-Z0-9._-]*)\s*=\s*"([^"]+)"/);
      if (match) {
        dependencies[match[1]] = match[2];
      }
    }
  }

  // Match [project.scripts]
  const scriptsSection = content.match(/\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/);
  if (scriptsSection) {
    const lines = scriptsSection[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (match) {
        scripts[match[1]] = match[2];
      }
    }
  }

  // Match [tool.poetry.scripts]
  const poetryScripts = content.match(/\[tool\.poetry\.scripts\]([\s\S]*?)(?:\n\[|$)/);
  if (poetryScripts) {
    const lines = poetryScripts[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (match) {
        scripts[match[1]] = match[2];
      }
    }
  }

  return {
    file_path: filePath,
    dependencies,
    dev_dependencies: {},
    scripts,
    source: 'manifest',
  };
}

// === Makefile ===

function parseMakefile(filePath: string, content: string): ParsedManifest | null {
  const scripts: Record<string, string> = {};

  // Match Makefile targets: name:
  const targetRegex = /^([a-zA-Z_][a-zA-Z0-9_-]*):/gm;
  let match;
  while ((match = targetRegex.exec(content)) !== null) {
    const targetName = match[1];
    // Get the next line as the command (simplified)
    const afterColon = content.slice(match.index + match[0].length);
    const commandMatch = afterColon.match(/\n\t(.+)/);
    scripts[targetName] = commandMatch ? commandMatch[1].trim() : '';
  }

  return {
    file_path: filePath,
    dependencies: {},
    dev_dependencies: {},
    scripts,
    source: 'manifest',
  };
}

// === yarn.lock ===

function parseYarnLock(filePath: string, content: string): ParsedManifest | null {
  const dependencies: Record<string, string> = {};

  // yarn.lock v1 format: "package@version":\n  version "x.y.z"
  const blockRegex = /^"?([^@\s]+)@[^":\n]+(?:,\s*[^":\n]+)*"?:\s*\n\s+version\s+"([^"]+)"/gm;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const name = match[1];
    const version = match[2];
    if (!dependencies[name]) {
      dependencies[name] = version;
    }
  }

  return {
    file_path: filePath,
    dependencies,
    dev_dependencies: {},
    scripts: {},
    source: 'lockfile',
  };
}

// === pnpm-lock.yaml ===

function parsePnpmLock(filePath: string, content: string): ParsedManifest | null {
  const dependencies: Record<string, string> = {};

  // Simple line-based parsing for pnpm-lock.yaml
  // Look for packages under "dependencies:" or "devDependencies:" sections
  const lines = content.split('\n');
  let inDeps = false;

  for (const line of lines) {
    if (line.match(/^\s*dependencies:|^\s*devDependencies:/)) {
      inDeps = true;
      continue;
    }

    if (inDeps && line.match(/^\s{4}'?([^':]+)'?:\s+(.+)/)) {
      const match = line.match(/^\s{4}'?([^':]+)'?:\s+'?(\S+?)'?$/);
      if (match) {
        dependencies[match[1]] = match[2];
      }
    }

    // Exit deps section on non-indented line
    if (inDeps && line.match(/^\S/) && !line.match(/^\s*$/)) {
      inDeps = false;
    }
  }

  return {
    file_path: filePath,
    dependencies,
    dev_dependencies: {},
    scripts: {},
    source: 'lockfile',
  };
}

// === Cargo.toml ===

function parseCargoToml(filePath: string, content: string): ParsedManifest | null {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};

  // Match [dependencies] section
  const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (depsSection) {
    parseTomlDeps(depsSection[1], dependencies);
  }

  // Match [dev-dependencies] section
  const devDepsSection = content.match(/\[dev-dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (devDepsSection) {
    parseTomlDeps(devDepsSection[1], devDependencies);
  }

  return {
    file_path: filePath,
    dependencies,
    dev_dependencies: devDependencies,
    scripts: {},
    source: 'manifest',
  };
}

function parseTomlDeps(section: string, target: Record<string, string>): void {
  for (const line of section.split('\n')) {
    // Simple: name = "version"
    const simpleMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (simpleMatch) {
      target[simpleMatch[1]] = simpleMatch[2];
      continue;
    }
    // Table: name = { version = "x" }
    const tableMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{.*version\s*=\s*"([^"]+)"/);
    if (tableMatch) {
      target[tableMatch[1]] = tableMatch[2];
    }
  }
}

// === go.mod ===

function parseGoMod(filePath: string, content: string): ParsedManifest | null {
  const dependencies: Record<string, string> = {};

  // Match require blocks: require (\n  module version\n)
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/g);
  if (requireBlock) {
    for (const block of requireBlock) {
      const lines = block.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s+(\S+)\s+(v\S+)/);
        if (match) {
          dependencies[match[1]] = match[2];
        }
      }
    }
  }

  // Match single require: require module version
  const singleReq = content.matchAll(/^require\s+(\S+)\s+(v\S+)/gm);
  for (const match of singleReq) {
    dependencies[match[1]] = match[2];
  }

  return {
    file_path: filePath,
    dependencies,
    dev_dependencies: {},
    scripts: {},
    source: 'manifest',
  };
}
