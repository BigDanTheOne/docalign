/**
 * Version comparison logic.
 * TDD-3 Appendix B.
 */
export interface VersionComparison {
  matches: boolean;
  comparison_type: 'major_only' | 'major_minor' | 'exact';
  documented_version: string;
  actual_version: string;
  source: string;
}

/**
 * Compare documented version against actual version.
 */
export function compareVersions(
  documented: string,
  actual: string,
  source: string,
): VersionComparison {
  const cleanDocumented = stripVersionPrefix(documented);
  const cleanActual = stripVersionPrefix(actual);

  const parts = cleanDocumented.split('.');
  let comparison_type: 'major_only' | 'major_minor' | 'exact';
  let matches: boolean;

  if (parts.length === 1) {
    // "18" -> major-only
    comparison_type = 'major_only';
    matches = cleanActual.startsWith(cleanDocumented + '.') || cleanActual === cleanDocumented;
  } else if (parts.length === 2) {
    // "18.2" -> major.minor
    comparison_type = 'major_minor';
    matches = cleanActual.startsWith(cleanDocumented + '.') || cleanActual === cleanDocumented;
  } else {
    // "18.2.0" -> exact match
    comparison_type = 'exact';
    matches = cleanActual === cleanDocumented;
  }

  // Special case: source is 'manifest' and actual is a range specifier (^, ~)
  if (source === 'manifest' && hasRangePrefix(actual)) {
    const baseActual = stripVersionPrefix(actual);
    matches = compareAgainstBase(cleanDocumented, baseActual, comparison_type);
  }

  return {
    matches,
    comparison_type,
    documented_version: documented,
    actual_version: actual,
    source,
  };
}

/**
 * Strip version prefixes like v, ^, ~, >=, etc.
 */
export function stripVersionPrefix(version: string): string {
  return version.replace(/^[v^~>=<!]+/, '').trim();
}

function hasRangePrefix(version: string): boolean {
  return /^[^~>=<!]/.test(version) === false;
}

function compareAgainstBase(
  documented: string,
  baseActual: string,
  type: 'major_only' | 'major_minor' | 'exact',
): boolean {
  switch (type) {
    case 'major_only':
      return baseActual.startsWith(documented + '.') || baseActual === documented;
    case 'major_minor':
      return baseActual.startsWith(documented + '.') || baseActual === documented;
    case 'exact':
      return baseActual === documented;
  }
}
