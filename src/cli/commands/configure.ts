/**
 * `docalign configure` — Create or update .docalign.yml configuration.
 *
 * Usage:
 *   docalign configure                          Create default .docalign.yml
 *   docalign configure --exclude=CHANGELOG.md   Add doc exclusion pattern
 *   docalign configure --min-severity=medium     Set minimum severity
 */

import fs from 'fs';
import path from 'path';
import { stringify as yamlStringify } from 'yaml';
import { loadDocAlignConfig, CONFIG_DEFAULTS } from '../../config/loader';
import type { DocAlignConfig } from '../../shared/types';

export interface ConfigureOptions {
  exclude?: string[];
  minSeverity?: string;
  reset?: boolean;
}

export async function runConfigure(
  options: ConfigureOptions,
  write: (msg: string) => void = console.log,
): Promise<number> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, '.docalign.yml');
  const exists = fs.existsSync(configPath);

  if (options.reset) {
    const config = buildDefaultConfig();
    writeConfig(configPath, config);
    write('Created .docalign.yml with default settings.');
    return 0;
  }

  // Load existing or start from defaults
  let config: DocAlignConfig;
  if (exists) {
    const { config: loaded, warnings } = loadDocAlignConfig(configPath);
    config = loaded;
    if (warnings.length > 0) {
      for (const w of warnings) {
        write(`  Warning: ${w.message}`);
      }
    }
  } else {
    config = buildDefaultConfig();
  }

  let modified = false;

  // Apply --exclude
  if (options.exclude && options.exclude.length > 0) {
    if (!config.doc_patterns) config.doc_patterns = {};
    if (!config.doc_patterns.exclude) config.doc_patterns.exclude = [...(CONFIG_DEFAULTS.doc_patterns.exclude ?? [])];

    for (const pattern of options.exclude) {
      if (!config.doc_patterns.exclude.includes(pattern)) {
        config.doc_patterns.exclude.push(pattern);
        write(`  Added doc exclusion: ${pattern}`);
        modified = true;
      } else {
        write(`  Already excluded: ${pattern}`);
      }
    }
  }

  // Apply --min-severity
  if (options.minSeverity) {
    const valid = ['low', 'medium', 'high'];
    if (!valid.includes(options.minSeverity)) {
      write(`Error: --min-severity must be one of: ${valid.join(', ')}`);
      return 2;
    }
    if (!config.verification) config.verification = {};
    config.verification.min_severity = options.minSeverity as 'low' | 'medium' | 'high';
    write(`  Set min_severity: ${options.minSeverity}`);
    modified = true;
  }

  // If no options provided and no existing config, create defaults
  if (!modified && !exists) {
    writeConfig(configPath, config);
    write('Created .docalign.yml with default settings.');
    write('');
    write('Edit this file to customize:');
    write('  - doc_patterns.exclude: Skip specific doc files');
    write('  - verification.min_severity: Set minimum severity (low, medium, high)');
    write('  - claim_types: Enable/disable specific claim types');
    write('  - suppress: Add suppression rules');
    return 0;
  }

  if (modified) {
    writeConfig(configPath, config);
    write(`\n${exists ? 'Updated' : 'Created'} .docalign.yml`);
  } else if (exists) {
    write('.docalign.yml already exists. Use options to modify:');
    write('  --exclude=PATTERN     Add doc exclusion pattern');
    write('  --min-severity=LEVEL  Set minimum severity (low, medium, high)');
    write('  --reset               Reset to defaults');
  }

  return 0;
}

function buildDefaultConfig(): DocAlignConfig {
  return {
    doc_patterns: {
      exclude: [...(CONFIG_DEFAULTS.doc_patterns.exclude ?? [])],
    },
    verification: {
      min_severity: CONFIG_DEFAULTS.verification.min_severity,
    },
    claim_types: { ...CONFIG_DEFAULTS.claim_types },
  };
}

function writeConfig(filePath: string, config: DocAlignConfig): void {
  const yaml = yamlStringify(config, { indent: 2, lineWidth: 100 });
  const content = `# DocAlign Configuration\n# See: https://github.com/BigDanTheOne/docalign#configuration\n\n${yaml}`;
  fs.writeFileSync(filePath, content, 'utf-8');
}
