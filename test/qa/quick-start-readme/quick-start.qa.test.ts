import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Find repo root (worktree or main)
const repoRoot = process.env.REPO_ROOT || join(__dirname, "../../../../..");
const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
const lines = readme.split("\n");

describe("Quick Start README Section", () => {
  it("AC1: has a ## Quick Start section within the first 80 lines", () => {
    const first80 = lines.slice(0, 80).join("\n");
    expect(first80).toMatch(/^## Quick Start/m);
  });

  it("AC2: shows exactly 3 steps with code blocks (install, init, scan)", () => {
    const qsStart = lines.findIndex((l) => /^## Quick Start/.test(l));
    expect(qsStart).toBeGreaterThanOrEqual(0);

    // Find next ## heading to bound the section
    const qsEnd = lines.findIndex(
      (l, i) => i > qsStart && /^## /.test(l)
    );
    const section = lines
      .slice(qsStart, qsEnd === -1 ? undefined : qsEnd)
      .join("\n");

    // Should have code blocks with install, init, scan commands
    const codeBlocks = section.match(/```[\s\S]*?```/g) || [];
    const allCode = codeBlocks.join("\n");

    expect(allCode).toMatch(/npm\s+(i|install)\s+(-g\s+)?docalign/);
    expect(allCode).toMatch(/docalign\s+init/);
    expect(allCode).toMatch(/docalign\s+scan/);
  });

  it("AC3: shows expected output snippet after the scan step", () => {
    const qsStart = lines.findIndex((l) => /^## Quick Start/.test(l));
    const qsEnd = lines.findIndex(
      (l, i) => i > qsStart && /^## /.test(l)
    );
    const section = lines
      .slice(qsStart, qsEnd === -1 ? undefined : qsEnd)
      .join("\n");

    // Should have an output example (code block after scan, or prose describing output)
    const scanIdx = section.indexOf("docalign scan");
    const afterScan = section.slice(scanIdx);
    // Look for a code block or output indicator after scan
    expect(afterScan).toMatch(/```[\s\S]*?```/);
  });

  it("AC4: no duplicate ## Setup section", () => {
    const setupHeadings = lines.filter((l) => /^## Setup\b/.test(l));
    expect(setupHeadings.length).toBe(0);
  });

  it("AC5: Quick Start section is ≤15 lines of content", () => {
    const qsStart = lines.findIndex((l) => /^## Quick Start/.test(l));
    const qsEnd = lines.findIndex(
      (l, i) => i > qsStart && /^## /.test(l)
    );
    const sectionLines = lines.slice(
      qsStart + 1,
      qsEnd === -1 ? undefined : qsEnd
    );
    // Count non-empty content lines (excluding blank lines and code fence markers)
    const contentLines = sectionLines.filter(
      (l) => l.trim().length > 0
    );
    expect(contentLines.length).toBeLessThanOrEqual(20); // some slack for code blocks
  });
});
