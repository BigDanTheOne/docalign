import path from 'path';
import type { PreProcessedDoc } from '../../shared/types';

type DocFormat = 'markdown' | 'mdx' | 'rst' | 'plaintext';

/**
 * Detect document format from file extension.
 * TDD-1 Section 4.1.
 */
export function detectFormat(filePath: string): DocFormat {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.md':
      return 'markdown';
    case '.mdx':
      return 'mdx';
    case '.rst':
      return 'rst';
    default:
      return 'plaintext';
  }
}

/**
 * Pre-process a documentation file for claim extraction.
 * Strips YAML frontmatter, HTML tags, base64 images, inline SVG,
 * and JSX components (for MDX). Builds a line map from cleaned
 * content back to original line numbers.
 *
 * TDD-1 Appendix A.
 */
export function preProcess(content: string, format: DocFormat): PreProcessedDoc {
  const fileSizeBytes = Buffer.byteLength(content, 'utf8');
  let lines = content.split('\n');
  let frontmatterOffset = 0;

  // Step 1: Strip YAML frontmatter
  if (lines.length > 0 && lines[0].trim() === '---') {
    const endIdx = lines.indexOf('---', 1);
    if (endIdx > 0) {
      frontmatterOffset = endIdx + 1;
      lines = lines.slice(endIdx + 1);
    }
  }

  // Step 2: Strip HTML tags
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/<[^>]+>/g, '');
  }

  // Step 3: Strip base64 images
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '');
    lines[i] = lines[i].replace(/src="data:image\/[^"]+"/g, '');
  }

  // Step 4: Strip inline SVG
  let inSvg = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<svg')) {
      inSvg = true;
    }
    if (inSvg) {
      lines[i] = '';
    }
    if (lines[i] === '' && inSvg && content.split('\n')[i + frontmatterOffset]?.includes('</svg>')) {
      inSvg = false;
    }
  }
  // Second pass for SVG closing on same line or other cases
  if (inSvg) {
    // Reset and redo properly using original content lines
    lines = content.split('\n');
    if (frontmatterOffset > 0) {
      lines = lines.slice(frontmatterOffset);
    }
    // Re-apply steps 2-3
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i].replace(/<[^>]+>/g, '');
      lines[i] = lines[i].replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '');
      lines[i] = lines[i].replace(/src="data:image\/[^"]+"/g, '');
    }
    // Redo SVG stripping properly
    inSvg = false;
    const origLines = content.split('\n').slice(frontmatterOffset);
    for (let i = 0; i < lines.length; i++) {
      const origLine = origLines[i] || '';
      if (origLine.includes('<svg')) {
        inSvg = true;
      }
      if (inSvg) {
        lines[i] = '';
      }
      if (origLine.includes('</svg>')) {
        inSvg = false;
      }
    }
  }

  // Step 5: Strip JSX component tags (MDX only)
  if (format === 'mdx') {
    for (let i = 0; i < lines.length; i++) {
      // Remove self-closing: <Component prop="value" />
      lines[i] = lines[i].replace(/<[A-Z][a-zA-Z]*\s[^>]*\/>/g, '');
      // Remove lines that are pure JSX opening/closing
      if (/^\s*<\/?[A-Z]/.test(lines[i])) {
        lines[i] = '';
      }
    }
  }

  // Step 6: Build line map (cleaned line index -> original 1-based line number)
  const originalLineMap: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    originalLineMap[i] = i + frontmatterOffset + 1;
  }

  // Step 7: Detect code fence blocks (``` or ~~~)
  const codeFenceLines = new Set<number>();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (inFence) {
        // Closing fence — mark it too
        codeFenceLines.add(i);
        inFence = false;
      } else {
        // Opening fence
        codeFenceLines.add(i);
        inFence = true;
      }
    } else if (inFence) {
      codeFenceLines.add(i);
    }
  }

  return {
    cleaned_content: lines.join('\n'),
    original_line_map: originalLineMap,
    format,
    file_size_bytes: fileSizeBytes,
    code_fence_lines: codeFenceLines,
  };
}

/**
 * Check if content appears to be binary (contains null bytes).
 */
export function isBinaryContent(content: string): boolean {
  return content.includes('\0');
}
