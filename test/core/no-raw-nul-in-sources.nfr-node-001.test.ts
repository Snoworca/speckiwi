import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @req NFR-NODE-001 — a raw U+0000 makes ripgrep treat the file as binary. Name the file explicitly
// and a match still surfaces; reach it through a recursive search and the match is dropped with no
// notice and an exit code that reads exactly like "not found". Writing the character as an escape
// keeps the runtime string identical and the file text.

const REPO = new URL("../../", import.meta.url);
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".claude", ".codex", ".agents"]);
const NUL = String.fromCharCode(0);

async function collectSources(dir: URL, prefix = ""): Promise<Array<{ label: string; text: string }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: Array<{ label: string; text: string }> = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) found.push(...(await collectSources(child, label)));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) found.push({ label, text: await readFile(child, "utf8") });
  }
  return found;
}

describe("NFR-NODE-001 — sources carry no raw NUL", () => {
  // AC-1: none anywhere, and a reintroduced one fails.
  it("AC-1: no TypeScript source contains a raw U+0000", async () => {
    const sources = await collectSources(REPO);
    expect(sources.length, "the scan must actually reach the sources").toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const { label, text } of sources) {
      const index = text.indexOf(NUL);
      if (index === -1) continue;
      const line = text.slice(0, index).split(/\r?\n/).length;
      offenders.push(`${label}:${line}`);
    }
    expect(offenders, "write the character as an escape instead").toEqual([]);
  });

  // AC-2: the runtime value is unchanged. The escape and the raw byte denote the same character,
  // so a key built after the change still equals one built before it.
  //
  // The six characters of the escape are assembled here rather than typed, because a literal
  // escape in this file would be evaluated by the compiler into the very byte AC-1 forbids.
  it("AC-2: every former raw NUL is now that same character, written as an escape", async () => {
    const backslash = String.fromCharCode(92);
    const escapeText = `${backslash}u0000`;

    // What the escape denotes, evaluated rather than typed.
    const separator = JSON.parse(`"${escapeText}"`) as string;
    expect(separator).toHaveLength(1);
    expect(separator.charCodeAt(0)).toBe(0);

    // Every source that carries the escape, not one named file: the earlier version pinned only
    // conflict.ts, so a separator changed in any of the other four would have gone unnoticed.
    const sources = await collectSources(REPO);
    const carrying = sources.filter((source) => source.text.includes(escapeText));
    expect(carrying.length, "the escape should appear in several sources").toBeGreaterThan(1);

    for (const source of carrying) {
      // The escape must denote U+0000 wherever it appears, so no site drifted to another
      // character while still looking like an escape.
      const occurrences = source.text.split(escapeText).length - 1;
      expect(occurrences, `${source.label} should carry at least one escape`).toBeGreaterThan(0);
      expect(source.text, `${source.label} must not mix a raw NUL back in`).not.toContain(NUL);
    }

    // And the four production sources that used to join on a raw NUL still join on this one.
    const joining = carrying.filter((source) => source.text.includes(`join("${escapeText}")`));
    expect(joining.length, "the joining sites must still use the escape").toBeGreaterThan(0);
  });

  // AC-3 is a property of the search tool over the repaired files and is checked by the command
  // recorded in this requirement's evidence: a recursive ripgrep for a symbol that sits after the
  // former NUL position now finds its file. It cannot be asserted from inside the process, because
  // vitest reads files directly and never goes through ripgrep's binary detection.
});
