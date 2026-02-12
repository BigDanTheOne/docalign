/**
 * Version comparison logic.
 * TDD-3 Appendix B.
 *
 * V2: Proper semver range handling for ^, ~, >=, <=, > specifiers.
 */
export interface VersionComparison {
  matches: boolean;
  comparison_type: 'major_only' | 'major_minor' | 'exact' | 'range';
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

  // If the actual version has a range prefix, use range matching
  if (source === 'manifest' && hasRangePrefix(actual)) {
    return compareWithRange(documented, actual, source);
  }

  const parts = cleanDocumented.split('.');
  let comparison_type: 'major_only' | 'major_minor' | 'exact';
  let matches: boolean;

  if (parts.length === 1) {
    comparison_type = 'major_only';
    matches = cleanActual.startsWith(cleanDocumented + '.') || cleanActual === cleanDocumented;
  } else if (parts.length === 2) {
    comparison_type = 'major_minor';
    matches = cleanActual.startsWith(cleanDocumented + '.') || cleanActual === cleanDocumented;
  } else {
    comparison_type = 'exact';
    matches = cleanActual === cleanDocumented;
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
 * Compare a documented version against a semver range in the manifest.
 * Handles ^, ~, >=, >, <=, < prefixes.
 */
function compareWithRange(
  documented: string,
  actual: string,
  source: string,
): VersionComparison {
  const cleanDoc = stripVersionPrefix(documented);
  const docSegments = cleanDoc.split('.');
  const docPrecision = docSegments.length; // 1=major, 2=major.minor, 3=exact

  const rangePrefix = extractRangePrefix(actual);
  const rangeBase = stripVersionPrefix(actual);
  const rangeParts = parseSemver(rangeBase);

  if (!rangeParts) {
    return { matches: false, comparison_type: 'range', documented_version: documented, actual_version: actual, source };
  }

  // For partial versions (e.g., "4" or "4.18"), check if the range base
  // shares the same major (and minor if specified). This is the common case:
  // doc says "Express 4", manifest has "^4.18.0" → match.
  if (docPrecision <= 2) {
    const docMajor = parseInt(docSegments[0], 10);
    if (isNaN(docMajor)) {
      return { matches: false, comparison_type: 'range', documented_version: documented, actual_version: actual, source };
    }
    let matches = docMajor === rangeParts.major;
    if (docPrecision === 2) {
      const docMinor = parseInt(docSegments[1], 10);
      matches = matches && !isNaN(docMinor) && docMinor === rangeParts.minor;
    }
    return { matches, comparison_type: 'range', documented_version: documented, actual_version: actual, source };
  }

  // Exact version (3 segments) — use proper semver range matching
  const docParts = parseSemver(cleanDoc);
  if (!docParts) {
    return { matches: false, comparison_type: 'range', documented_version: documented, actual_version: actual, source };
  }

  let matches = false;

  switch (rangePrefix) {
    case '^':
      matches = satisfiesCaret(docParts, rangeParts);
      break;
    case '~':
      matches = satisfiesTilde(docParts, rangeParts);
      break;
    case '>=':
      matches = compareParts(docParts, rangeParts) >= 0;
      break;
    case '>':
      matches = compareParts(docParts, rangeParts) > 0;
      break;
    case '<=':
      matches = compareParts(docParts, rangeParts) <= 0;
      break;
    case '<':
      matches = compareParts(docParts, rangeParts) < 0;
      break;
    default:
      matches = compareAgainstBaseSimple(cleanDoc, rangeBase);
      break;
  }

  return {
    matches,
    comparison_type: 'range',
    documented_version: documented,
    actual_version: actual,
    source,
  };
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): SemverParts | null {
  const parts = version.split('.');
  const major = parseInt(parts[0], 10);
  if (isNaN(major)) return null;
  const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const patch = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  if (isNaN(minor) || isNaN(patch)) return null;
  return { major, minor, patch };
}

/** Compare two version tuples. Returns -1, 0, or 1. */
function compareParts(a: SemverParts, b: SemverParts): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

/** Caret range: ^X.Y.Z allows changes that don't modify leftmost non-zero */
function satisfiesCaret(doc: SemverParts, range: SemverParts): boolean {
  // doc must be >= range
  if (compareParts(doc, range) < 0) return false;

  // Find upper bound
  if (range.major !== 0) {
    return doc.major === range.major;
  }
  if (range.minor !== 0) {
    return doc.major === 0 && doc.minor === range.minor;
  }
  return doc.major === 0 && doc.minor === 0 && doc.patch === range.patch;
}

/** Tilde range: ~X.Y.Z allows patch-level changes */
function satisfiesTilde(doc: SemverParts, range: SemverParts): boolean {
  if (compareParts(doc, range) < 0) return false;
  return doc.major === range.major && doc.minor === range.minor;
}

function compareAgainstBaseSimple(documented: string, base: string): boolean {
  const docParts = documented.split('.');
  const baseParts = base.split('.');

  for (let i = 0; i < docParts.length; i++) {
    if (i >= baseParts.length) return false;
    if (docParts[i] !== baseParts[i]) return false;
  }
  return true;
}

/**
 * Strip version prefixes like v, ^, ~, >=, etc.
 */
export function stripVersionPrefix(version: string): string {
  return version.replace(/^[v^~>=<!]+/, '').trim();
}

function hasRangePrefix(version: string): boolean {
  return /^[~^>=<!]/.test(version);
}

function extractRangePrefix(version: string): string {
  const match = version.match(/^([~^>=<!]+)/);
  return match ? match[1] : '';
}
