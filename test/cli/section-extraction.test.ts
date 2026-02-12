import { describe, it, expect } from 'vitest';
import { findSection, listHeadings } from '../../src/cli/local-pipeline';

const SAMPLE_DOC = `# Project Name

Some intro text.

## Installation

Install with npm:

\`\`\`bash
npm install mypackage
\`\`\`

Requires Node.js 18+.

## Usage

Import and use:

\`\`\`typescript
import { foo } from 'mypackage';
\`\`\`

### Advanced Usage

More details here.

## API Reference

### GET /api/users

Returns a list of users.

### POST /api/users

Creates a new user.

## Contributing

PRs welcome.
`;

describe('findSection', () => {
  it('finds a top-level section by heading', () => {
    const section = findSection(SAMPLE_DOC, 'Installation');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Installation');
    expect(section!.level).toBe(2);
    expect(section!.startLine).toBe(5);
    // Ends before "## Usage" which is on line 15
    expect(section!.endLine).toBe(14);
  });

  it('finds a section case-insensitively', () => {
    const section = findSection(SAMPLE_DOC, 'installation');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Installation');
  });

  it('finds the last section (extends to end of file)', () => {
    const section = findSection(SAMPLE_DOC, 'Contributing');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Contributing');
    const totalLines = SAMPLE_DOC.split('\n').length;
    expect(section!.endLine).toBe(totalLines);
  });

  it('finds a subsection within a parent section', () => {
    const section = findSection(SAMPLE_DOC, 'Advanced Usage');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Advanced Usage');
    expect(section!.level).toBe(3);
    // Ends before "## API Reference" (next H2)
  });

  it('finds nested subsection (H3 under API Reference)', () => {
    const section = findSection(SAMPLE_DOC, 'GET /api/users');
    expect(section).not.toBeNull();
    expect(section!.level).toBe(3);
    // Ends before "### POST /api/users" (next H3)
  });

  it('returns null for non-existent section', () => {
    const section = findSection(SAMPLE_DOC, 'Nonexistent Section');
    expect(section).toBeNull();
  });

  it('handles section with no content between headings', () => {
    const doc = '# Title\n## Empty\n## Next\nContent here.';
    const section = findSection(doc, 'Empty');
    expect(section).not.toBeNull();
    expect(section!.startLine).toBe(2);
    expect(section!.endLine).toBe(2);
  });

  it('section range includes all lines until next same-level heading', () => {
    const section = findSection(SAMPLE_DOC, 'Usage');
    expect(section).not.toBeNull();
    // Usage starts at its heading, includes "Advanced Usage" subsection
    // Ends before "## API Reference"
    const apiRef = findSection(SAMPLE_DOC, 'API Reference');
    expect(section!.endLine).toBe(apiRef!.startLine - 1);
  });
});

describe('listHeadings', () => {
  it('returns all headings with text, level, and line number', () => {
    const headings = listHeadings(SAMPLE_DOC);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0].text).toBe('Project Name');
    expect(headings[0].level).toBe(1);
    expect(headings[0].line).toBe(1);
  });

  it('finds all headings in the sample doc', () => {
    const headings = listHeadings(SAMPLE_DOC);
    const texts = headings.map((h) => h.text);
    expect(texts).toContain('Installation');
    expect(texts).toContain('Usage');
    expect(texts).toContain('Advanced Usage');
    expect(texts).toContain('API Reference');
    expect(texts).toContain('Contributing');
  });

  it('returns empty array for content with no headings', () => {
    const headings = listHeadings('Just some text\nwith no headings.');
    expect(headings).toEqual([]);
  });

  it('includes heading levels', () => {
    const headings = listHeadings(SAMPLE_DOC);
    const h1 = headings.find((h) => h.text === 'Project Name');
    const h2 = headings.find((h) => h.text === 'Installation');
    const h3 = headings.find((h) => h.text === 'Advanced Usage');
    expect(h1?.level).toBe(1);
    expect(h2?.level).toBe(2);
    expect(h3?.level).toBe(3);
  });
});
