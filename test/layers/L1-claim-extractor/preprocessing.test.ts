import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  preProcess,
  isBinaryContent,
} from '../../../src/layers/L1-claim-extractor/preprocessing';

describe('detectFormat', () => {
  it('detects markdown', () => {
    expect(detectFormat('README.md')).toBe('markdown');
    expect(detectFormat('/path/to/docs/api.md')).toBe('markdown');
  });

  it('detects mdx', () => {
    expect(detectFormat('page.mdx')).toBe('mdx');
  });

  it('detects rst', () => {
    expect(detectFormat('docs/index.rst')).toBe('rst');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(detectFormat('file.txt')).toBe('plaintext');
    expect(detectFormat('CHANGELOG')).toBe('plaintext');
    expect(detectFormat('file.html')).toBe('plaintext');
  });

  it('handles uppercase extensions', () => {
    expect(detectFormat('README.MD')).toBe('markdown');
  });
});

describe('preProcess', () => {
  describe('YAML frontmatter stripping', () => {
    it('strips frontmatter', () => {
      const content = '---\ntitle: Test\ndate: 2024-01-01\n---\n# Hello\nWorld';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toBe('# Hello\nWorld');
      expect(result.original_line_map[0]).toBe(5);
      expect(result.original_line_map[1]).toBe(6);
    });

    it('does not strip if no closing ---', () => {
      const content = '---\ntitle: Test\n# Hello';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toContain('title: Test');
    });

    it('handles content with no frontmatter', () => {
      const content = '# Hello\nWorld';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toBe('# Hello\nWorld');
      expect(result.original_line_map[0]).toBe(1);
    });
  });

  describe('HTML tag stripping', () => {
    it('strips HTML tags', () => {
      const content = 'Hello <strong>bold</strong> world';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toBe('Hello bold world');
    });

    it('strips multi-line HTML tags', () => {
      const content = '<div class="note">\nSome content\n</div>';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toBe('\nSome content\n');
    });
  });

  describe('base64 image stripping', () => {
    it('strips markdown base64 images', () => {
      const content = '![alt](data:image/png;base64,abc123) text';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toBe(' text');
    });

    it('strips src base64 images', () => {
      const content = 'img src="data:image/png;base64,abc123" end';
      const result = preProcess(content, 'markdown');
      expect(result.cleaned_content).toBe('img  end');
    });
  });

  describe('inline SVG stripping', () => {
    it('strips multi-line SVG', () => {
      const content = 'Before\n<svg xmlns="...">\n<rect />\n</svg>\nAfter';
      const result = preProcess(content, 'markdown');
      // SVG lines should be blanked
      expect(result.cleaned_content).toContain('Before');
      expect(result.cleaned_content).toContain('After');
      expect(result.cleaned_content).not.toContain('rect');
    });
  });

  describe('JSX component stripping (MDX only)', () => {
    it('strips self-closing JSX components in mdx', () => {
      const content = 'Hello\n<Alert type="warning" />\nWorld';
      const result = preProcess(content, 'mdx');
      expect(result.cleaned_content).toContain('Hello');
      expect(result.cleaned_content).toContain('World');
      expect(result.cleaned_content).not.toContain('Alert');
    });

    it('strips JSX opening/closing tags in mdx', () => {
      const content = '<Tabs>\nContent\n</Tabs>';
      const result = preProcess(content, 'mdx');
      expect(result.cleaned_content).not.toContain('Tabs');
      expect(result.cleaned_content).toContain('Content');
    });

    it('does not strip JSX in non-mdx formats', () => {
      const content = 'Hello\n<Alert type="warning" />\nWorld';
      const result = preProcess(content, 'markdown');
      // HTML stripping will remove the tag, but not JSX-specific behavior
      expect(result.cleaned_content).toContain('Hello');
      expect(result.cleaned_content).toContain('World');
    });
  });

  describe('line map', () => {
    it('maps cleaned lines to original line numbers', () => {
      const content = '---\ntitle: T\n---\nLine 4\nLine 5';
      const result = preProcess(content, 'markdown');
      // After stripping 3-line frontmatter, line 0 should map to original line 4
      expect(result.original_line_map[0]).toBe(4);
      expect(result.original_line_map[1]).toBe(5);
    });

    it('preserves 1-based numbering', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const result = preProcess(content, 'markdown');
      expect(result.original_line_map[0]).toBe(1);
      expect(result.original_line_map[1]).toBe(2);
      expect(result.original_line_map[2]).toBe(3);
    });
  });

  describe('output structure', () => {
    it('returns correct format', () => {
      const result = preProcess('content', 'markdown');
      expect(result.format).toBe('markdown');
    });

    it('calculates file_size_bytes', () => {
      const content = 'Hello world';
      const result = preProcess(content, 'markdown');
      expect(result.file_size_bytes).toBe(Buffer.byteLength(content, 'utf8'));
    });

    it('handles empty content', () => {
      const result = preProcess('', 'markdown');
      expect(result.cleaned_content).toBe('');
      expect(result.original_line_map).toHaveLength(1);
    });
  });
});

describe('isBinaryContent', () => {
  it('detects binary content with null bytes', () => {
    expect(isBinaryContent('hello\0world')).toBe(true);
  });

  it('returns false for regular text', () => {
    expect(isBinaryContent('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBinaryContent('')).toBe(false);
  });
});
