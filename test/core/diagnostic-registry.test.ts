import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnostic, splitDiagnostics, summarizeDiagnostics } from "../../src/core/diagnostic.js";
import { DIAGNOSTIC_DEFINITIONS, getDiagnosticDefinition } from "../../src/core/diagnostic-registry.js";

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseRulesDocDiagnosticRows(text: string): Array<{ code: string; severity: string; title: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => /^\|\s+`(SRS-[EW]\d{3})`\s+\|\s+(error|warning|info)\s+\|\s+(.+?)\s+\|$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ code: match[1]!, severity: match[2]!, title: match[3]! }));
}

describe("diagnostic registry", () => {
  it("defines each diagnostic code once with required metadata", () => {
    const codes = DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const definition of DIAGNOSTIC_DEFINITIONS) {
      expect(definition.code).toMatch(/^SRS-[EW]\d{3}$/);
      expect(definition.severity).toMatch(/^(error|warning|info)$/);
      expect(definition.title.trim()).not.toBe("");
      expect(definition.messageTemplate.trim()).not.toBe("");
      expect(definition.sourceRule.trim()).not.toBe("");
      expect(definition.since.trim()).not.toBe("");
      expect(getDiagnosticDefinition(definition.code)).toEqual(definition);
    }
  });

  it("rejects unknown codes and severity drift at emission time", () => {
    expect(() => diagnostic("SRS-X999", "error", "unknown")).toThrow(/Unknown diagnostic code/);
    expect(() => diagnostic("SRS-E001", "warning", "wrong severity")).toThrow(/severity mismatch/);
  });

  it("keeps the rules document diagnostic table aligned to the registry", async () => {
    const rules = await readFile("docs/rule/SRS-MD-Rules-v1.0.0.md", "utf8");
    const rows = parseRulesDocDiagnosticRows(rules).sort((a, b) => a.code.localeCompare(b.code));
    const registry = DIAGNOSTIC_DEFINITIONS.map(({ code, severity, title }) => ({ code, severity, title })).sort((a, b) => a.code.localeCompare(b.code));
    expect(rows).toEqual(registry);
  });

  it("keeps diagnostic call sites registered", async () => {
    const files = await collectTypeScriptFiles("src");
    const emitted = new Set<string>();
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/diagnostic\(\s*["'](SRS-[EW]\d{3})["']/g)) {
        emitted.add(match[1]!);
      }
    }
    expect([...emitted].sort()).toEqual(expect.arrayContaining(["SRS-E001", "SRS-E002", "SRS-E017", "SRS-W015"]));
    expect([...emitted].filter((code) => !DIAGNOSTIC_DEFINITIONS.some((definition) => definition.code === code))).toEqual([]);
  });

  it("summarizes diagnostics by severity and code", () => {
    const diagnostics = [
      diagnostic("SRS-E001", "error", "malformed"),
      diagnostic("SRS-W002", "warning", "target"),
      diagnostic("SRS-W002", "warning", "target")
    ];
    expect(splitDiagnostics(diagnostics).errors).toHaveLength(1);
    expect(splitDiagnostics(diagnostics).warnings).toHaveLength(2);
    expect(summarizeDiagnostics(diagnostics)).toEqual({
      errors: 1,
      warnings: 2,
      byCode: { "SRS-E001": 1, "SRS-W002": 2 }
    });
  });
});
