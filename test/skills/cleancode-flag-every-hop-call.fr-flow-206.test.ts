import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-206 AC-5 — every written call that can reach a review hop carries the clean-code answer.
// Rounds 19–22 found the same defect on a new path each time: some call that ends in a kiwi-review-fix-loop hop
// was written without `--skip-clean-code` / `--keep-clean-code`. The denominator is therefore not a literal list:
// it is every invocation statement the skill files contain for a skill that runs a review hop, found by pattern, so
// a call added later is checked without editing this test. A statement passes when the source lines it is written on
// carry both flag slots (a call quoted inside a prose line may name them in that line's prose), or
// when it tells the child that the caller owns the review hop (`--review-hop-owned-by-parent`, `--no-final`,
// `SPAWN_CONTEXT=pm-child`) — then the child runs no hop and the caller's own hop call is checked instead.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

/** Skills that run kiwi-review-fix-loop (or are it), plus kiwi-pipeline's generic spawn of the chosen skill. */
const HOP_SKILL = "kiwi-(?:review-fix-loop|pm|coder|tdd|orchestrator|wave-master|<chosen>)";
const SKILL_CALL = new RegExp(`Skill\\(\\{?\\s*skill\\s*[:=]\\s*"${HOP_SKILL}"`, "g");
const USE_CALL = new RegExp(`Use (?:\\$|the )${HOP_SKILL}(?![\\w-])`, "g");
/** A command line in a code block (`/kiwi-pm …`, `$kiwi-pm …`) that a skill fills in — it has a `{…}` slot. */
const COMMAND_LINE = new RegExp(`^(\\s*)[/$]${HOP_SKILL}(?![\\w-])`);

const EXEMPT = ["--review-hop-owned-by-parent", "--no-final", "SPAWN_CONTEXT=pm-child"];

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...markdownFiles(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** The whole source lines from the one holding `from` to the one holding `to`. */
function wholeLines(text: string, from: number, to: number): string {
  const end = text.indexOf("\n", to);
  return text.slice(text.lastIndexOf("\n", from) + 1, end < 0 ? undefined : end);
}

/** The source lines a `Skill(` call occupies, from its own line to the line of its matching `)`. */
function balancedCall(text: string, at: number): string {
  const open = text.indexOf("(", at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && --depth === 0) return wholeLines(text, at, i);
  }
  return wholeLines(text, at, text.length);
}

type Statement = { where: string; text: string };

function statements(root: string): Statement[] {
  const found: Statement[] = [];
  for (const file of markdownFiles(path.join(REPO_ROOT, root))) {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    const lineOf = (at: number): number => text.slice(0, at).split("\n").length;
    for (const m of text.matchAll(SKILL_CALL)) found.push({ where: `${rel}:${lineOf(m.index)}`, text: balancedCall(text, m.index) });
    for (const m of text.matchAll(USE_CALL)) found.push({ where: `${rel}:${lineOf(m.index)}`, text: wholeLines(text, m.index, m.index) });
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const m = COMMAND_LINE.exec(line);
      if (!m) return;
      const indent = m[1].length;
      let stmt = line;
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && lines[j].search(/\S/) > indent; j += 1) stmt += `\n${lines[j]}`;
      if (stmt.includes("{")) found.push({ where: `${rel}:${i + 1}`, text: stmt });
    });
  }
  return found;
}

const carriesAnswer = (s: string): boolean => s.includes("--skip-clean-code") && s.includes("--keep-clean-code");
const parentOwnsHop = (s: string): boolean => EXEMPT.some((marker) => s.includes(marker));

describe("FR-FLOW-206 AC-5 — every call that can reach a review hop carries the clean-code answer", () => {
  for (const root of ROOTS) {
    // @req FR-FLOW-206 AC-5
    it(`${root}: each review-hop-reaching invocation passes --skip-clean-code / --keep-clean-code or leaves the hop to its caller`, () => {
      const found = statements(root);
      // The pattern must keep seeing the calls: the review hand-offs and kiwi-pipeline's single-step spawn (verify-r22).
      expect(found.length, `${root}: no invocation statement found`).toBeGreaterThan(5);
      expect(found.some((s) => s.where.includes("/kiwi-pipeline/")), `${root}: kiwi-pipeline spawn not found`).toBe(true);
      expect(found.some((s) => /kiwi-review-fix-loop/.test(s.text)), `${root}: no review hop call found`).toBe(true);
      const missing = found.filter((s) => !carriesAnswer(s.text) && !parentOwnsHop(s.text)).map((s) => s.where);
      expect(missing, `${root}: calls without the clean-code answer`).toEqual([]);
    });
  }
});
