import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { parse as parseYaml } from "yaml";

// QA-DISPUTE: Original path "../../../../.." (5 levels up) resolves to /Users/kotkot, not repo root.
// Test file is at test/qa/examples-directory/ — only 3 levels below repo root.
const ROOT = resolve(__dirname, "../../..");
const EXAMPLES = join(ROOT, "examples");

describe("examples/ Directory", () => {
  describe("Structure", () => {
    it("examples/ directory exists at repo root", () => {
      expect(existsSync(EXAMPLES)).toBe(true);
      expect(statSync(EXAMPLES).isDirectory()).toBe(true);
    });

    for (const sub of ["basic-scan", "github-action", "mcp-setup"]) {
      it(`${sub}/ subdirectory exists`, () => {
        const dir = join(EXAMPLES, sub);
        expect(existsSync(dir)).toBe(true);
        expect(statSync(dir).isDirectory()).toBe(true);
      });

      it(`${sub}/README.md exists and is ≤30 lines`, () => {
        const readme = join(EXAMPLES, sub, "README.md");
        expect(existsSync(readme)).toBe(true);
        const lines = readFileSync(readme, "utf-8").split("\n");
        expect(lines.length).toBeLessThanOrEqual(30);
      });
    }
  });

  describe("basic-scan/", () => {
    const dir = join(EXAMPLES, "basic-scan");

    it("contains at least one markdown file", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir);
      const mdFiles = files.filter(
        (f) => f.endsWith(".md") && f !== "README.md"
      );
      expect(mdFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("contains at least one source file (non-md, non-README)", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir, { recursive: true }) as string[];
      const sourceFiles = files.filter(
        (f) =>
          !f.toString().endsWith(".md") &&
          !f.toString().startsWith(".") &&
          statSync(join(dir, f.toString())).isFile()
      );
      expect(sourceFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("github-action/", () => {
    const dir = join(EXAMPLES, "github-action");

    it("contains a workflow YAML file", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir, { recursive: true }) as string[];
      const yamlFiles = files.filter(
        (f) => f.toString().endsWith(".yml") || f.toString().endsWith(".yaml")
      );
      expect(yamlFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("workflow YAML is valid and parseable", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir, { recursive: true }) as string[];
      const yamlFile = files.find(
        (f) => f.toString().endsWith(".yml") || f.toString().endsWith(".yaml")
      );
      if (!yamlFile) return;
      const content = readFileSync(join(dir, yamlFile.toString()), "utf-8");
      const parsed = parseYaml(content);
      expect(parsed).toBeDefined();
      // Should have jobs or be a valid workflow structure
      expect(parsed).toHaveProperty("name");
    });

    it("workflow references agent-action correctly", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir, { recursive: true }) as string[];
      const yamlFile = files.find(
        (f) => f.toString().endsWith(".yml") || f.toString().endsWith(".yaml")
      );
      if (!yamlFile) return;
      const content = readFileSync(join(dir, yamlFile.toString()), "utf-8");
      // Should reference the agent-action in some form
      expect(content).toMatch(/agent-action/i);
    });
  });

  describe("mcp-setup/", () => {
    const dir = join(EXAMPLES, "mcp-setup");

    it("contains MCP config file(s)", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir, { recursive: true }) as string[];
      const configFiles = files.filter(
        (f) =>
          f.toString().includes("settings.json") ||
          f.toString().includes("mcp") ||
          f.toString().endsWith(".json")
      );
      expect(configFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("MCP config references docalign-mcp server", () => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir, { recursive: true }) as string[];
      const jsonFiles = files.filter((f) => f.toString().endsWith(".json"));
      const anyRefsDocalign = jsonFiles.some((f) => {
        const content = readFileSync(join(dir, f.toString()), "utf-8");
        return content.includes("docalign");
      });
      expect(anyRefsDocalign).toBe(true);
    });
  });

  describe("Root README linkage", () => {
    it("root README.md links to examples/", () => {
      const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
      expect(readme).toMatch(/examples\//);
    });
  });
});
