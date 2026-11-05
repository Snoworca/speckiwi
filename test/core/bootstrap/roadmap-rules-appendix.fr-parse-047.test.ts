import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBundledRulesDocument } from "../../../src/core/bootstrap/templates.js";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import {
  ROADMAP_DIAGNOSTIC_CODES,
  ROADMAP_FIELDS,
  ROADMAP_HISTORY_COLUMNS,
  ROADMAP_KINDS,
  ROADMAP_LIFECYCLES,
  ROADMAP_PATH,
  ROADMAP_SECTIONS
} from "../../../src/core/roadmap/roadmap-grammar.js";

// FR-PARSE-047 — the roadmap grammar and its ROADMAP- codes live in one appendix section of the bundled
// SRS-MD rules document, read here from the document the package ships and installs.

const APPENDIX_HEADING = /^## Appendix [A-Z]\. Roadmap Document/;

async function appendix(): Promise<{ count: number; text: string }> {
  const lines = (await loadBundledRulesDocument()).split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (APPENDIX_HEADING.test(line) ? [index] : []));
  if (starts.length === 0) return { count: 0, text: "" };
  const start = starts[0]!;
  let fenced = false;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s{0,3}```/.test(lines[index]!)) fenced = !fenced;
    if (!fenced && /^## /.test(lines[index]!)) {
      end = index;
      break;
    }
  }
  return { count: starts.length, text: lines.slice(start, end).join("\n") };
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? sourceFiles(path.join(dir, entry.name)) : Promise.resolve(entry.name.endsWith(".ts") ? [path.join(dir, entry.name)] : []))));
  return nested.flat();
}

describe("FR-PARSE-047 AC-1 — one appendix defines the roadmap document", () => {
  // @req FR-PARSE-047 AC-1
  it("has exactly one roadmap appendix section", async () => {
    expect((await appendix()).count).toBe(1);
  });

  // @req FR-PARSE-047 AC-1
  it("states the location, the item heading, every field with its value forms, the sections and the history columns", async () => {
    const { text } = await appendix();
    expect(text).toContain(`\`${ROADMAP_PATH}\``);
    expect(text).toContain("### RM-<n> — <title>");
    for (const field of ROADMAP_FIELDS) expect(text, field).toMatch(new RegExp(`^\\| \`${field}\` \\|`, "m"));
    // Each row names the value forms the parser accepts for that field.
    const row = (field: string) => text.split("\n").find((line) => line.startsWith(`| \`${field}\` |`)) ?? "";
    for (const value of ROADMAP_KINDS) expect(row("Kind"), value).toContain(`\`${value}\``);
    for (const value of ROADMAP_LIFECYCLES) expect(row("Lifecycle"), value).toContain(`\`${value}\``);
    for (const field of ["Planned Start", "Planned End"]) {
      for (const form of ["`-`", "`YYYY-MM-DD`", "`YYYY-MM`", "`YYYY-Qn`"]) expect(row(field), `${field} ${form}`).toContain(form);
    }
    for (const field of ["Actual Start", "Actual End"]) {
      expect(row(field), field).toContain("`-` or `YYYY-MM-DD` |");
      expect(row(field), field).not.toContain("YYYY-Qn");
    }
    for (const section of ROADMAP_SECTIONS) expect(text, section).toContain(`#### ${section}`);
    expect(text).toContain(`| ${ROADMAP_HISTORY_COLUMNS.join(" | ")} |`);
  });

  // @req FR-PARSE-047 AC-1
  it("ships no separate roadmap rules document", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as { files?: string[] };
    expect((manifest.files ?? []).filter((entry) => /roadmap/i.test(entry))).toEqual([]);
    expect((await readdir(path.join("docs", "rule"))).filter((name) => /roadmap/i.test(name))).toEqual([]);
  });
});

describe("FR-PARSE-047 AC-2 — the appendix and the checker name the same codes", () => {
  // @req FR-PARSE-047 AC-2
  it("lists every ROADMAP- code the roadmap check can emit, with its registered severity and title", async () => {
    const { text } = await appendix();
    for (const code of ROADMAP_DIAGNOSTIC_CODES) {
      const definition = DIAGNOSTIC_DEFINITIONS.find((entry) => entry.code === code);
      expect(definition, `${code} is registered`).toBeDefined();
      expect(text, code).toContain(`| \`${code}\` | ${definition?.severity} | ${definition?.title} |`);
    }
  });

  // @req FR-PARSE-047 AC-2
  it("lists no ROADMAP- code that the diagnostic registry does not define", async () => {
    const { text } = await appendix();
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((entry) => entry.code));
    expect([...new Set(text.match(/ROADMAP-[EW]\d{3}/g) ?? [])].filter((code) => !registered.has(code))).toEqual([]);
  });

  // @req FR-PARSE-047 AC-2
  it("derives the emittable list from the sources, so a code emitted but not listed fails", async () => {
    const emitted = new Set<string>();
    for (const file of await sourceFiles("src")) {
      for (const match of (await readFile(file, "utf8")).matchAll(/"(ROADMAP-[EW]\d{3})"/g)) emitted.add(match[1]!);
    }
    expect([...emitted].sort()).toEqual([...ROADMAP_DIAGNOSTIC_CODES].sort());
  });
});

describe("FR-PARSE-047 AC-3 — the roadmap is not a second requirement source", () => {
  // @req FR-PARSE-047 AC-3
  it("states what the roadmap never holds and that only paused and cancelled are written by hand", async () => {
    const { text } = await appendix();
    expect(text).toContain("holds no requirement status, no target status, no target goal, no acceptance criterion and no requirement statement");
    expect(text).toContain("Only `paused` and `cancelled` are written by hand, through `Lifecycle`");
  });
});
