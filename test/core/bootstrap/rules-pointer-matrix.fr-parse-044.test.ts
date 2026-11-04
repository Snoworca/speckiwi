import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { findRulesPointers, pointerNeedsRefresh, scanSpecRulesPointers, specDocumentRole } from "../../../src/core/bootstrap/rules-references.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { findMarkdownLinksInDocument, referenceKey } from "../../../src/core/parser/markdown-links.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";

// FR-PARSE-044 AC-6 — the reference-style pointer class, as a generated matrix rather than one case per
// shape found. Three review rounds in a row found a new shape of the same class; each combination below
// is held to the same invariants, so a new shape is a new row, not a new defect.
//
//   link form   × position         × definition shape          × use distribution × line endings
//   inline        Rules row (scope)  one line                    pointer once       LF
//   image         index entry        title on the same line      pointer + pointer  CRLF
//   shortcut                         title on the next line      pointer + author   no final newline
//   collapsed                        angle-bracketed target      duplicate definition
//   full
//
// Invariants after `upgrade`: no tool-owned pointer still needs a refresh; doctor's rules check is ok;
// every SRS-W073 on a stale rules file name sends the line to a hand edit (only author text is left);
// an author line's reference resolves to the same target as before; a second upgrade changes no byte;
// the plan reports what the apply reports.

const OLD = "SRS-MD-Rules-v2.5.0.md";
const NEW = "SRS-MD-Rules-v2.6.0.md";
const SCOPE = "docs/spec/01.alpha.srs.md";
const INDEX = "docs/spec/00.index.md";

type Form = "inline" | "image" | "shortcut" | "collapsed" | "full";
type Position = "rules-row" | "index-entry";
type Shape = "one-line" | "title-same-line" | "title-next-line" | "angle";
type Uses = "pointer-once" | "pointer-twice" | "pointer-and-author" | "duplicate-definition";
type Ending = "lf" | "crlf" | "no-final-newline";
/** Whether the planted pointer names the old rules or already the bundled ones. */
type State = "stale" | "current";

const fileOf = (state: State) => (state === "stale" ? OLD : NEW);
const labelOf = (state: State) => `SRS-MD Authoring Rules v${state === "stale" ? "2.5.0" : "2.6.0"}`;
const linkOf = (state: State) => `../rule/${fileOf(state)}`;
const keyOf = (form: Form, state: State) => (form === "full" ? "rules" : labelOf(state));

function link(form: Form, state: State): string {
  if (form === "inline") return `[${labelOf(state)}](${linkOf(state)})`;
  if (form === "image") return `![${labelOf(state)}](${linkOf(state)})`;
  if (form === "shortcut") return `[${labelOf(state)}]`;
  if (form === "collapsed") return `[${labelOf(state)}][]`;
  return `[${labelOf(state)}][rules]`;
}

function definitionLines(key: string, shape: Shape, state: State): string[] {
  if (shape === "one-line") return [`[${key}]: ${linkOf(state)}`];
  if (shape === "title-same-line") return [`[${key}]: ${linkOf(state)} "SRS rules"`];
  if (shape === "title-next-line") return [`[${key}]: ${linkOf(state)}`, `  "SRS rules"`];
  return [`[${key}]: <${linkOf(state)}>`];
}

interface Case {
  name: string;
  form: Form;
  position: Position;
  shape: Shape;
  uses: Uses;
  ending: Ending;
  state: State;
}

const referenceStyle = (form: Form) => form !== "inline" && form !== "image";

/**
 * For each pointer state, every pair of the other axes' values that can occur together, each covered
 * by at least one case (a greedy all-pairs cover per state). The state is crossed with every pair rather
 * than paired like the others because the defects found so far each needed a state and two other axes
 * at once — a stale index entry with no Rules row, a stale definition two pointer lines share, a current
 * image row. Shape and use distribution apply to reference-style links only, so an inline or image case
 * carries a single value for them. The full product is 552 cases.
 */
function cases(): Case[] {
  const all: Case[] = [];
  for (const form of ["inline", "image", "shortcut", "collapsed", "full"] as const)
    for (const position of ["rules-row", "index-entry"] as const)
      for (const shape of referenceStyle(form) ? (["one-line", "title-same-line", "title-next-line", "angle"] as const) : (["one-line"] as const))
        for (const uses of referenceStyle(form) ? (["pointer-once", "pointer-twice", "pointer-and-author", "duplicate-definition"] as const) : (["pointer-once"] as const))
          for (const ending of ["lf", "crlf", "no-final-newline"] as const)
            for (const state of ["stale", "current"] as const)
              all.push({ name: `${state} · ${form} · ${position} · ${shape} · ${uses} · ${ending}`, form, position, shape, uses, ending, state });
  const axes = (c: Case): string[] => [`f=${c.form}`, `p=${c.position}`, `s=${c.shape}`, `u=${c.uses}`, `e=${c.ending}`];
  const pairsOf = (c: Case): string[] => {
    const values = axes(c);
    const out: string[] = [];
    for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) out.push(`${values[i]}&${values[j]}`);
    return out;
  };
  const chosen: Case[] = [];
  for (const state of ["stale", "current"] as const) {
    const pool = all.filter((c) => c.state === state);
    const uncovered = new Set(pool.flatMap(pairsOf));
    while (uncovered.size > 0) {
      let best = pool[0]!;
      let bestGain = -1;
      for (const candidate of pool) {
        const gain = pairsOf(candidate).filter((pair) => uncovered.has(pair)).length;
        if (gain > bestGain) {
          best = candidate;
          bestGain = gain;
        }
      }
      chosen.push(best);
      for (const pair of pairsOf(best)) uncovered.delete(pair);
    }
  }
  return chosen;
}

function withEnding(text: string, ending: Ending): string {
  const lf = text.replace(/\r\n/g, "\n");
  if (ending === "crlf") return lf.replace(/\n/g, "\r\n");
  if (ending === "no-final-newline") return lf.replace(/\n+$/, "");
  return lf;
}

const AUTHOR_LINE = (key: string) => `Requirements before 2026-11 cite [the old rules][${key}].`;

/** Plants one case into a fresh project and returns the planted file. */
async function plant(root: string, c: Case): Promise<string> {
  const key = referenceStyle(c.form) ? keyOf(c.form, c.state) : "";
  const definitions = referenceStyle(c.form)
    ? [
        ...definitionLines(key, c.shape, c.state),
        // The duplicate is void whatever it says; it names the old file so it is visibly author text.
        ...(c.uses === "duplicate-definition" ? [`[${key}]: ../rule/${OLD}`] : [])
      ]
    : [];
  const author = c.uses === "pointer-and-author" ? [AUTHOR_LINE(key), ""] : [];
  if (c.position === "rules-row") {
    const row = c.uses === "pointer-twice" ? `| Rules | ${link(c.form, c.state)} (see also ${link(c.form, c.state)}) |` : `| Rules | ${link(c.form, c.state)} |`;
    const text = [
      "# Alpha SRS",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Document Type | scope_srs |",
      "| Scope | ALPHA |",
      "| Scope Name | Alpha |",
      row,
      "",
      "## 1. Scope",
      "",
      "Alpha.",
      "",
      ...author,
      ...definitions,
      ""
    ].join("\n");
    const file = path.join(root, ...SCOPE.split("/"));
    await writeFile(file, withEnding(text, c.ending), "utf8");
    return file;
  }
  const file = path.join(root, ...INDEX.split("/"));
  const lines = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const entryAt = lines.findIndex((line) => line.startsWith("- [SRS-MD Authoring Rules v"));
  expect(entryAt, "init writes the index rules entry").toBeGreaterThan(-1);
  lines[entryAt] = `- ${link(c.form, c.state)}`;
  const rowAt = lines.findIndex((line) => line.startsWith("| Rules |"));
  // Lead decision (round 11): a reference-style index Rules row is author text, so the index keeps its
  // own inline Rules row whatever the entry is; "pointer-twice" adds nothing at this position.
  if (c.uses === "pointer-once") {
    // No Rules row at all, so upgrade inserts one above the entry it repairs: the plan and the apply
    // must still report the entry at the same line.
    lines.splice(rowAt, 1);
  }
  const text = [...lines, "", ...author, ...definitions, ""].join("\n");
  await writeFile(file, withEnding(text, c.ending), "utf8");
  return file;
}

/** Each author-line reference, keyed by its line text, and the target its definition gives it. */
function authorTargets(text: string): Map<string, string | undefined> {
  const lines = text.split(/\r?\n/);
  const links = findMarkdownLinksInDocument(lines);
  const definitions = new Map<string, string>();
  for (const found of links.flat()) {
    if (found.kind === "definition" && !definitions.has(referenceKey(found.label.value))) definitions.set(referenceKey(found.label.value), found.destination.value);
  }
  const out = new Map<string, string | undefined>();
  links.forEach((lineLinks, index) => {
    if (!lines[index]!.startsWith("Requirements before")) return;
    for (const found of lineLinks) {
      if (found.kind === "reference") out.set(lines[index]!, definitions.get(referenceKey((found.label ?? found.text).value)));
    }
  });
  return out;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");
      if (relative === "kiwi" || relative === ".git") continue;
      if (entry.isDirectory()) await walk(full);
      else out[relative] = await readFile(full, "utf8");
    }
  }
  await walk(root);
  return out;
}

async function upgrade(root: string, apply: boolean) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply, installSkills: false, registerMcp: false });
  if (!result.ok || !result.value) throw new Error(result.error?.message ?? "upgrade failed");
  return result.value;
}

let template = "";
const made: string[] = [];

beforeAll(async () => {
  template = await mkdtemp(path.join(os.tmpdir(), "speckiwi-pointer-matrix-template-"));
  await mkdir(path.join(template, ".git"), { recursive: true });
  expect((await initProject(await resolveProjectRoot(template), { installSkills: false, registerMcp: false })).ok).toBe(true);
}, 60_000);

afterAll(async () => {
  await Promise.all([template, ...made].map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FR-PARSE-044 AC-6 — reference-style rules pointers, every combination", () => {
  for (const c of cases()) {
    // @req FR-PARSE-044 AC-6
    it(c.name, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-pointer-matrix-"));
      made.push(root);
      await cp(template, root, { recursive: true });
      const file = await plant(root, c);
      const relative = path.relative(root, file).replace(/\\/g, "/");
      const planted = await readFile(file, "utf8");
      const authorBefore = authorTargets(planted);

      // The planted line is a tool-owned pointer: a Rules row always, an index entry when it is a link
      // (an image is not a link to the rules, so an image entry is author text).
      // Lead decision (round 11): only the forms the tool writes are its pointers — an inline link, or a
      // Rules row of prose or an image. A reference-style row or entry is author text.
      const ownedPointer = !referenceStyle(c.form) && (c.position === "rules-row" || c.form !== "image");
      const plantedLine = planted.split(/\r?\n/).findIndex((line) => line.includes(link(c.form, c.state)) && !line.startsWith("| Rules |") === (c.position === "index-entry")) + 1;
      expect(findRulesPointers(planted, specDocumentRole(relative)).some((pointer) => pointer.line === plantedLine)).toBe(ownedPointer);

      const plan = await upgrade(root, false);
      const applied = await upgrade(root, true);
      const once = await snapshot(root);
      await upgrade(root, true);

      // The plan reports what the apply reports.
      const report = (output: typeof plan) => output.references.map((finding) => `${finding.action} ${finding.location} ${finding.from} -> ${finding.to}`);
      expect(report(applied)).toEqual(report(plan));
      expect(applied.rulesRowInsertion).toEqual(plan.rulesRowInsertion);

      // A second upgrade changes nothing.
      expect(await snapshot(root)).toEqual(once);

      // No tool-owned pointer still needs a refresh, and doctor agrees.
      const workspace = await parseWorkspace({ root });
      expect(scanSpecRulesPointers(workspace.files).filter((pointer) => pointer.needsRefresh).map((pointer) => `${pointer.filePath}:${pointer.line}`)).toEqual([]);
      const after = await readFile(file, "utf8");
      expect(findRulesPointers(after, specDocumentRole(relative)).filter((pointer) => pointerNeedsRefresh(pointer, relative))).toEqual([]);
      const drift = (await diagnoseHealth(workspace)).checks.find((check) => check.label === "Rules version drift");
      expect({ state: drift?.state, message: drift?.message }).toMatchObject({ state: "ok" });

      // Only author text is left quoting the old file, and validate sends it to a hand edit.
      const w073 = validateWorkspace(workspace).diagnostics.filter((entry) => entry.code === "SRS-W073" && entry.message.includes("BUNDLED_SRS_RULES_FILENAME"));
      for (const entry of w073) expect(entry.message, `${entry.filePath}:${entry.line}`).toMatch(/by hand/);

      // An author line's reference still resolves where it did.
      expect(authorTargets(after)).toEqual(authorBefore);

      // A tool-owned pointer is rewritten and leaves no old file name. Author text — a reference-style
      // row or entry with its definitions, an image entry — is left byte for byte: every planted line is
      // still there, and as many old file names and definition titles as were planted.
      const count = (text: string, needle: string) => text.split(needle).length - 1;
      if (ownedPointer) {
        expect(count(after, OLD), "old file names left").toBe(0);
      } else {
        expect(count(after, OLD), "old file names left").toBe(count(planted, OLD));
        expect(count(after, '"SRS rules"'), "definition titles left").toBe(count(planted, '"SRS rules"'));
        const afterLines = new Set(after.split(/\r?\n/));
        expect(planted.split(/\r?\n/).filter((line) => !afterLines.has(line) && !line.startsWith("| Rules |")), "author lines kept").toEqual([]);
      }

      // A pointer that already points at the bundled rules is left as it is. The one exception is an
      // image in a Rules row: an image links nowhere, so the row is rewritten as a link.
      if (c.state === "current") {
        const plantedText = planted.split(/\r?\n/)[plantedLine - 1]!;
        expect(after.split(/\r?\n/).includes(plantedText), "current pointer line kept").toBe(!(ownedPointer && c.form === "image" && c.position === "rules-row"));
      }
    }, 60_000);
  }
});
