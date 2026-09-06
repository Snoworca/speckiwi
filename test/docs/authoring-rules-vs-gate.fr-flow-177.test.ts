import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BUNDLED_SDS_RULES_FILENAME,
  BUNDLED_SRS_RULES_FILENAME,
  loadBundledSdsRulesDocument,
  renderAgentInstructionSnippet
} from "../../src/core/bootstrap/templates.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

/**
 * FR-FLOW-177 — the bundled authoring rules describe the record the gate actually reads.
 *
 * Counted before any edit of this item, over `docs/rule/SDS-MD-Rules-v2.5.0.md`: `SDS Skip` 0,
 * `Decision` 0 as a skip-record cell, `Reason` 0 as a skip-record cell, `SDS-E054` 0, and no
 * diagnostic code of any kind — the document matches `SDS-[EW]\d{3}` nowhere. Its skip-gate clause
 * names exactly one of the five things the gate reads (the EARS stub) and nothing else, so an author
 * following it exactly writes an EARS stub with no `## SDS Skip` section and is refused. Measured on
 * two fixtures before any edit: written as the rules say, `exit 1` with `SDS-E054`; written as the
 * gate wants, `exit 0`.
 *
 * What the gate requires is DERIVED from `sdsSkipRecordFailure` rather than transcribed here. A
 * transcription is the same drift one level up: it is written once against today's branches and
 * then agrees with the document forever, including after a sixth branch lands. Reading the branches
 * means a branch added to that function makes the document red rather than merely out of date.
 *
 * The derivation is FAIL-CLOSED. A branch this file cannot reduce to a nameable token fails as a
 * branch it cannot check, rather than passing as a branch with nothing to require — that silence is
 * how a derivation stops deriving without anyone noticing.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VALIDATOR_PATH = path.join("src", "core", "validator", "validate-scoped.ts");
const VALIDATOR_SOURCE = readFileSync(path.join(REPO_ROOT, VALIDATOR_PATH), "utf8").replace(/\r\n/g, "\n");

/**
 * A runtime value spliced into a message, replaced by a sentinel no document can carry.
 *
 * A printable placeholder would be wrong here: the spans this drops are dropped by SUBSTRING
 * test, and any printable choice is a substring some legitimate span also carries — a single
 * space would drop `SDS Skip` itself. NUL cannot be written in these messages at all, so the
 * check cannot mistake a rule for a value.
 */
const RUNTIME_HOLE = "\u0000";

/**
 * The label of the clause that owns the skip gate, which is how the section is located.
 *
 * Case-sensitive and hyphenated on purpose: §2 refers to "the trivial-change skip-gate (§6)" in
 * passing, and a looser anchor picks that cross-reference up as a second section. Locating by the
 * clause's own label rather than by "§6" keeps the assertion pointed at the subject rather than at
 * a number a renumbering would move.
 */
const SKIP_GATE_LABEL = "Trivial-change skip-gate";

/** The body of one named function declaration, brace-matched from its signature. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${VALIDATOR_PATH} no longer declares ${name}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Module-level `const NAME = "value";` bindings, so a message interpolating one resolves. */
function moduleConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/^const ([A-Za-z_][A-Za-z0-9_]*) = "([^"]*)";$/gm)) {
    constants.set(match[1] as string, match[2] as string);
  }
  return constants;
}

/**
 * One refusal branch of the gate: the message it returns and the tokens a document must name for an
 * author to be able to satisfy it.
 */
interface GateBranch {
  message: string;
  tokens: string[];
}

/**
 * The tokens one refusal message names.
 *
 * A quoted span is the message's own way of pointing at a literal the author must write, so those
 * are the tokens — minus any span carrying a runtime hole, which names a value rather than a rule. A
 * span containing an ellipsis is a PATTERN rather than a literal, so it contributes the identifiers
 * inside it (an all-caps keyword, or an `SDS-AC` id reduced to its stem) instead of itself: no
 * document is going to carry `SDS-AC-n: WHEN … SHALL …` byte for byte, and requiring it would push
 * the check into demanding prose rather than content. A file name is named by any message that
 * mentions it, quoted or not, because the first branch names one and quotes nothing.
 */
function messageTokens(message: string): string[] {
  const tokens: string[] = [];
  for (const match of message.matchAll(/'([^']*)'/g)) {
    const span = (match[1] as string).replace(/^#+\s*/, "").trim();
    if (span === "" || span.includes(RUNTIME_HOLE)) continue;
    if (!span.includes("…")) {
      tokens.push(span);
      continue;
    }
    for (const word of span.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? []) {
      if (word.startsWith("SDS-AC")) tokens.push("SDS-AC");
      else if (word === word.toUpperCase() && word.length > 1) tokens.push(word);
    }
  }
  for (const file of message.match(/\b[a-z][A-Za-z0-9._-]*\.md\b/g) ?? []) tokens.push(file);
  return [...new Set(tokens)];
}

/** Every refusal branch of `sdsSkipRecordFailure`, read from its source. */
function gateBranches(): GateBranch[] {
  const body = functionBody(VALIDATOR_SOURCE, "sdsSkipRecordFailure");
  const constants = moduleConstants(VALIDATOR_SOURCE);
  const branches: GateBranch[] = [];
  for (const match of body.matchAll(/return\s+(`[^`]*`|"[^"]*")\s*;/g)) {
    const literal = (match[1] as string).slice(1, -1);
    const message = literal.replace(/\$\{([^}]*)\}/g, (_, expression: string) => constants.get(expression.trim()) ?? RUNTIME_HOLE);
    branches.push({ message, tokens: messageTokens(message) });
  }
  return branches;
}

/** The diagnostic code the emitter raises when a branch of the gate refuses. */
function gateDiagnosticCode(): string {
  const body = functionBody(VALIDATOR_SOURCE, "sdsAdvisories");
  const match = /code:\s*"([A-Z][A-Z0-9_-]*)"[\s\S]{0,400}?\$\{failure\}/.exec(body);
  expect(match, "sdsAdvisories no longer turns a skip-record failure into a coded diagnostic").not.toBeNull();
  return (match as RegExpExecArray)[1] as string;
}

/** Everything an author must find in the bundled document to satisfy the gate. */
function requiredTokens(): string[] {
  const branches = gateBranches();
  expect(branches.length, "sdsSkipRecordFailure returns no refusal message at all").toBeGreaterThan(0);
  for (const [index, branch] of branches.entries()) {
    expect(branch.tokens.length, `refusal branch ${index + 1} names nothing a document could carry: «${branch.message}»`).toBeGreaterThan(0);
  }
  return [...new Set([...branches.flatMap((branch) => branch.tokens), gateDiagnosticCode()])];
}

/**
 * One section of a markdown document, from its heading to the next heading at the same or a higher
 * level, with fenced blocks skipped so an embedded sample's headings do not end the section.
 */
function sectionAt(text: string, startIndex: number, lines: readonly string[]): string {
  const level = (/^#+/.exec((lines[startIndex] as string).trim()) ?? ["#"])[0].length;
  let fenced = false;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#+)\s/.exec(line.trim());
    if (match && (match[1] as string).length <= level) return lines.slice(startIndex, index).join("\n");
  }
  return lines.slice(startIndex).join("\n");
}

/** The one section of `text` whose body carries `anchor`, or a failure naming how many did. */
function sectionCarrying(text: string, anchor: string, label: string): string {
  const lines = text.split("\n");
  const matches: string[] = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !/^#+\s/.test(line.trim())) continue;
    const body = sectionAt(text, index, lines);
    if (body.includes(anchor)) matches.push(body);
  }
  // Keep only the innermost match, so a parent section does not count as a second hit.
  const innermost = matches.filter((body) => !matches.some((other) => other !== body && other.length < body.length && body.includes(other)));
  expect(innermost.length, `${label}: expected exactly one section carrying «${anchor}»`).toBe(1);
  return innermost[0] as string;
}

/** The required tokens one document's skip-gate section fails to name, in derivation order. */
function missingTokens(document: string): string[] {
  const section = sectionCarrying(document.replace(/\r\n/g, "\n"), SKIP_GATE_LABEL, BUNDLED_SDS_RULES_FILENAME);
  return requiredTokens().filter((token) => !section.includes(token));
}

/**
 * The same document with the skip-gate section's naming MOVED to the end of the file.
 *
 * Every required word is still somewhere in the document, and the section an author is pointed at
 * names none of them. A check that passes on this is a word search over a file rather than a claim
 * about the clause a reader is sent to.
 */
function relocateSkipGateNaming(document: string): string {
  const normalised = document.replace(/\r\n/g, "\n");
  const section = sectionCarrying(normalised, SKIP_GATE_LABEL, BUNDLED_SDS_RULES_FILENAME);
  const heading = section.split("\n")[0] as string;
  const emptied = [heading, "", `- **${SKIP_GATE_LABEL}**: see the appendix.`, ""].join("\n");
  const appendix = section.split(SKIP_GATE_LABEL).join("Relocated skip note");
  return `${normalised.replace(section, emptied)}\n\n## 99. Appendix\n\n${appendix}\n`;
}

/** The shipped SDS rules document as `init` writes it, and the section that owns the skip gate. */
async function skipGateSection(): Promise<string> {
  // Line endings normalised because a checkout under `core.autocrlf` hands back CRLF, and every
  // scan below is written against `\n`. A CRLF checkout is not a contradiction to report.
  const document = (await loadBundledSdsRulesDocument()).replace(/\r\n/g, "\n");
  return sectionCarrying(document, SKIP_GATE_LABEL, BUNDLED_SDS_RULES_FILENAME);
}

describe("FR-FLOW-177 AC-4 — what the gate requires is derived from the code that raises it", () => {
  it("reads every refusal branch, and every branch names something a document can carry", () => {
    const branches = gateBranches();
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) {
      expect(branch.tokens, `«${branch.message}» reduces to no nameable token`).not.toEqual([]);
    }
  });

  it("the bundled document names every token the branches require", async () => {
    const missing = missingTokens(await loadBundledSdsRulesDocument());
    expect(missing, `${BUNDLED_SDS_RULES_FILENAME} skip-gate section does not name: ${missing.join(", ")}`).toEqual([]);
  });

  it("the diagnostic the gate raises is one of them", async () => {
    expect(await skipGateSection()).toContain(gateDiagnosticCode());
  });
});

describe("FR-FLOW-177 AC-5 — the denominator is the shipped document, not the tree", () => {
  it("stays red when the same words are moved out of the section that ships them", () => {
    // Measured rather than assumed: the neighbouring SRS rules document ALREADY names every token
    // once its own §32.1 bullet and its embedded agent block are corrected, so "a neighbour does not
    // carry the words" would be a vacuous proof of scoping. Relocating the words inside the shipped
    // document is the same proof without that hole — the text a reader would find by searching is
    // present, and the section an author is sent to is empty.
    const relocated = relocateSkipGateNaming(readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SDS_RULES_FILENAME), "utf8"));
    expect(missingTokens(relocated)).toEqual(requiredTokens());
  });

  it("the neighbouring document is not what the check reads, even though it names the same things", () => {
    const neighbour = readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8");
    // It names them — that is what makes the scoping load-bearing rather than incidental.
    expect(requiredTokens().filter((token) => !neighbour.includes(token))).toEqual([]);
    // And it is still not the document the check has in hand.
    expect(() => sectionCarrying(neighbour.replace(/\r\n/g, "\n"), SKIP_GATE_LABEL, BUNDLED_SRS_RULES_FILENAME)).toThrow();
  });

  it("reads the document through the loader `init` writes from", async () => {
    const loaded = await loadBundledSdsRulesDocument();
    const onDisk = readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SDS_RULES_FILENAME), "utf8");
    expect(loaded).toBe(onDisk);
  });
});

describe("FR-FLOW-177 AC-1 — an author who follows the document passes the step gate", () => {
  const STEP = "tdd-step-from-the-rules";

  /**
   * The copyable `intent.md` the document embeds in its skip-gate section.
   *
   * Taking the fixture FROM the document is what makes this a test of the document rather than of a
   * record this file happens to know how to write. Anything the document forgets to show, the
   * fixture forgets too, and the gate refuses it.
   */
  async function documentedIntent(): Promise<string> {
    const section = await skipGateSection();
    const fence = /^```markdown\n([\s\S]*?)^```/m.exec(section);
    expect(fence, `${BUNDLED_SDS_RULES_FILENAME} skip-gate section embeds no copyable intent.md`).not.toBeNull();
    return ((fence as RegExpExecArray)[1] as string).trimEnd();
  }

  async function scopedResult(rootPath: string) {
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    return validateWorkspaceScoped(workspace, {
      step: STEP,
      design: await loadStepDesign(root, STEP),
      intent: await loadStepIntent(root, STEP)
    });
  }

  it("validates clean with no design.md, on an intent.md copied out of the document", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const stepsDir = path.join(rootPath, "docs", "spec", "steps");
    await mkdir(path.join(stepsDir, STEP), { recursive: true });
    await writeFile(
      path.join(stepsDir, "state.md"),
      [
        "# Step State",
        "",
        "Mode: tdd",
        `Active Task: ${STEP}`,
        "",
        "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        `| ${STEP} | active | - | ARCH | - | 2026-09-06 | 2026-09-06 |`,
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(stepsDir, STEP, "intent.md"), `${await documentedIntent()}\n`, "utf8");

    const result = await scopedResult(rootPath);
    expect(result.errors.map((error) => error.code)).not.toContain(gateDiagnosticCode());
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("SDS-W050");
  });
});

describe("FR-FLOW-177 AC-2 — the SRS rules stop calling the step validator's output advisory", () => {
  /** Every diagnostic code the step-local validator can emit, with the severity it emits it at. */
  function stepValidatorCodes(): Map<string, string> {
    const codes = new Map<string, string>();
    for (const match of VALIDATOR_SOURCE.matchAll(/advisory\(\s*"([A-Z][A-Z0-9_-]*)"/g)) codes.set(match[1] as string, "warning");
    for (const match of VALIDATOR_SOURCE.matchAll(/code:\s*"([A-Z][A-Z0-9_-]*)",\s*\n\s*severity:\s*"([a-z]+)"/g)) {
      codes.set(match[1] as string, match[2] as string);
    }
    return codes;
  }

  /** The one bullet of the SRS rules that accounts for step validation's diagnostics. */
  function stepValidationBullet(): string {
    const text = readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8").replace(/\r\n/g, "\n");
    const bullets = text.split("\n").filter((line) => line.trim().startsWith("- Step validation"));
    expect(bullets.length, `${BUNDLED_SRS_RULES_FILENAME}: expected exactly one step-validation bullet`).toBe(1);
    return bullets[0] as string;
  }

  /** `X` through `Y` names every code between them, so a range counts as naming its members. */
  function namesCode(bullet: string, code: string): boolean {
    if (bullet.includes(code)) return true;
    for (const range of bullet.matchAll(/`([A-Z]+-[EW])(\d+)`\s+through\s+`\1(\d+)`/g)) {
      const prefix = range[1] as string;
      const low = Number(range[2]);
      const high = Number(range[3]);
      const member = new RegExp(`^${prefix}(\\d+)$`).exec(code);
      if (member && Number(member[1]) >= low && Number(member[1]) <= high) return true;
    }
    return false;
  }

  it("enumerates every code the step validator can emit", () => {
    const bullet = stepValidationBullet();
    const codes = [...stepValidatorCodes().keys()];
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !namesCode(bullet, code))).toEqual([]);
  });

  it("says the error-severity ones are errors rather than advisories", () => {
    const bullet = stepValidationBullet();
    const errors = [...stepValidatorCodes().entries()].filter(([, severity]) => severity === "error").map(([code]) => code);
    expect(errors.length, "the step validator emits nothing at error severity, so this claim has no subject").toBeGreaterThan(0);
    for (const code of errors) {
      expect(namesCode(bullet, code), `${code} is an error the bullet never names`).toBe(true);
      expect(bullet).toMatch(/\berror\b/);
    }
    expect(bullet.startsWith("- Step validation reports step-scoped advisories"), "the bullet still classifies the whole output as advisory").toBe(false);
  });
});

describe("FR-FLOW-177 AC-3 — the shipped agent block stops forbidding the recorded skip in silence", () => {
  /** The instruction line, wherever it is written: a numbered item, quoted or not. */
  const ANCHOR = /^["'`]?\d+\.\s+tdd gates \(all mandatory\)/;

  const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage", ".vitest", "build"]);

  /** Every file in the tree carrying the instruction line, with the line it carries. */
  function copies(): Array<{ relPath: string; line: string }> {
    const found: Array<{ relPath: string; line: string }> = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (IGNORED_DIRECTORIES.has(entry)) continue;
        const full = path.join(dir, entry);
        let stats;
        try {
          stats = statSync(full);
        } catch {
          continue;
        }
        if (stats.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(?:ts|md|js|mjs|cjs|json|txt)$/.test(entry)) continue;
        let text: string;
        try {
          text = readFileSync(full, "utf8");
        } catch {
          continue;
        }
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (ANCHOR.test(trimmed)) found.push({ relPath: path.relative(REPO_ROOT, full).split(path.sep).join("/"), line: trimmed });
        }
      }
    };
    walk(REPO_ROOT);
    return found;
  }

  it("every copy the tree carries names the recorded skip and the diagnostic that refuses it", () => {
    const carriers = copies();
    expect(carriers.length, "no file carries the tdd-gates instruction line at all").toBeGreaterThan(1);
    const section = messageTokens(gateBranches()[1]?.message ?? "").find((token) => token.includes("Skip"));
    expect(section, "the gate no longer names a skip-record section").toBeDefined();
    const silent = carriers.filter((copy) => !copy.line.includes(section as string) || !copy.line.includes(gateDiagnosticCode()));
    expect(silent.map((copy) => copy.relPath), "these copies still forbid the recorded skip in silence").toEqual([]);
  });

  it("the renderer `init` writes from carries the same correction", () => {
    const line = renderAgentInstructionSnippet()
      .split("\n")
      .find((candidate) => ANCHOR.test(candidate.trim()));
    expect(line, "the rendered snippet carries no tdd-gates instruction line").toBeDefined();
    expect(line as string).toContain(gateDiagnosticCode());
  });

  it("the markdown copies are byte-identical to the rendered line, so none of them drifts alone", () => {
    const rendered = renderAgentInstructionSnippet()
      .split("\n")
      .find((candidate) => ANCHOR.test(candidate.trim())) as string;
    const drifted = copies()
      .filter((copy) => copy.relPath.endsWith(".md"))
      .filter((copy) => copy.line !== rendered.trim());
    expect(drifted.map((copy) => copy.relPath)).toEqual([]);
  });
});
