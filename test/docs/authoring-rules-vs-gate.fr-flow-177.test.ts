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
 * Since 4.1.0 the gate is FR-PARSE-042's acceptance-contract check: a tdd step without an authored
 * design.md must carry `## Acceptance` EARS lines in intent.md, or `STEP_ACCEPTANCE_MISSING` refuses
 * it. What the gate requires is DERIVED from the branches of `stepAcceptanceFailure` rather than
 * transcribed here, so a branch added to that function makes the document red rather than merely out
 * of date. The derivation is FAIL-CLOSED: a branch this file cannot reduce to a nameable token fails.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREDICATE_PATH = path.join("src", "core", "validator", "step-acceptance.ts");
const PREDICATE_SOURCE = readFileSync(path.join(REPO_ROOT, PREDICATE_PATH), "utf8").replace(/\r\n/g, "\n");
const VALIDATOR_PATH = path.join("src", "core", "validator", "validate-scoped.ts");
const VALIDATOR_SOURCE = readFileSync(path.join(REPO_ROOT, VALIDATOR_PATH), "utf8").replace(/\r\n/g, "\n");
const PREDICATE = "stepAcceptanceFailure";

/** A runtime value spliced into a message, replaced by a sentinel no document can carry. */
const RUNTIME_HOLE = "\u0000";

/**
 * The label of the clause that owns the acceptance record in the SDS rules, which is how the section
 * is located. Locating by the clause's own label rather than by a section number keeps the assertion
 * pointed at the subject rather than at a number a renumbering would move.
 */
const GATE_LABEL = "Step SDS opt-in";

/** The body of one named function declaration, brace-matched from its signature. */
function functionBody(source: string, name: string, label: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${label} no longer declares ${name}`).toBeGreaterThanOrEqual(0);
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

interface GateBranch {
  message: string;
  tokens: string[];
}

/**
 * The tokens one refusal message names: each quoted span (a `##` heading reduced to its name); a span
 * with an ellipsis is a pattern and contributes its all-caps identifiers instead; and any file name.
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
      if (word === word.toUpperCase() && word.length > 1) tokens.push(word);
    }
  }
  for (const file of message.match(/\b[a-z][A-Za-z0-9._-]*\.md\b/g) ?? []) tokens.push(file);
  return [...new Set(tokens)];
}

/** Every refusal branch of the predicate, read from `source`. */
function gateBranches(source = PREDICATE_SOURCE): GateBranch[] {
  const body = functionBody(source, PREDICATE, PREDICATE_PATH);
  const branches: GateBranch[] = [];
  for (const match of body.matchAll(/return\s+(`[^`]*`|"[^"]*")\s*;/g)) {
    const message = (match[1] as string).slice(1, -1).replace(/\$\{[^}]*\}/g, RUNTIME_HOLE);
    branches.push({ message, tokens: messageTokens(message) });
  }
  return branches;
}

/** The diagnostic code the step validator raises when the predicate refuses. */
function gateDiagnosticCode(): string {
  const body = functionBody(VALIDATOR_SOURCE, "sdsAdvisories", VALIDATOR_PATH);
  const match = /code:\s*"([A-Z][A-Z0-9_-]*)"[\s\S]{0,400}?\$\{failure\}/.exec(body);
  expect(match, "sdsAdvisories no longer turns a predicate failure into a coded diagnostic").not.toBeNull();
  return (match as RegExpExecArray)[1] as string;
}

/** Everything an author must find in the bundled document to satisfy the gate. */
function requiredTokens(source = PREDICATE_SOURCE): string[] {
  const branches = gateBranches(source);
  expect(branches.length, `${PREDICATE} returns no refusal message at all`).toBeGreaterThan(0);
  for (const [index, branch] of branches.entries()) {
    expect(branch.tokens.length, `refusal branch ${index + 1} names nothing a document could carry: «${branch.message}»`).toBeGreaterThan(0);
  }
  return [...new Set([...branches.flatMap((branch) => branch.tokens), gateDiagnosticCode()])];
}

/** One section, from its heading to the next heading at the same or a higher level, fences skipped. */
function sectionAt(startIndex: number, lines: readonly string[]): string {
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

/** The one innermost section of `text` whose body carries `anchor`, or a failure naming how many did. */
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
    const body = sectionAt(index, lines);
    if (body.includes(anchor)) matches.push(body);
  }
  const innermost = matches.filter((body) => !matches.some((other) => other !== body && other.length < body.length && body.includes(other)));
  expect(innermost.length, `${label}: expected exactly one section carrying «${anchor}»`).toBe(1);
  return innermost[0] as string;
}

/** The required tokens one document's gate section fails to name, in derivation order. */
function missingTokens(document: string, source = PREDICATE_SOURCE): string[] {
  const section = sectionCarrying(document.replace(/\r\n/g, "\n"), GATE_LABEL, BUNDLED_SDS_RULES_FILENAME);
  return requiredTokens(source).filter((token) => !section.includes(token));
}

/** The same document with the gate section's naming MOVED to an appendix at the end of the file. */
function relocateGateNaming(document: string): string {
  const normalised = document.replace(/\r\n/g, "\n");
  const section = sectionCarrying(normalised, GATE_LABEL, BUNDLED_SDS_RULES_FILENAME);
  const heading = section.split("\n")[0] as string;
  const emptied = [heading, "", `- **${GATE_LABEL}**: see the appendix.`, ""].join("\n");
  const appendix = section.split(GATE_LABEL).join("Relocated opt-in note");
  return `${normalised.replace(section, emptied)}\n\n## 99. Appendix\n\n${appendix}\n`;
}

/** The shipped SDS rules document as `init` writes it, and the section that owns the gate. */
async function gateSection(): Promise<string> {
  const document = (await loadBundledSdsRulesDocument()).replace(/\r\n/g, "\n");
  return sectionCarrying(document, GATE_LABEL, BUNDLED_SDS_RULES_FILENAME);
}

describe("FR-FLOW-177 AC-4 — what the gate requires is derived from the code that raises it", () => {
  it("FR-FLOW-177 AC-4: reads every refusal branch, and every branch names something a document can carry", () => {
    const branches = gateBranches();
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) {
      expect(branch.tokens, `«${branch.message}» reduces to no nameable token`).not.toEqual([]);
    }
  });

  it("FR-FLOW-177 AC-4: the bundled document names every token the branches require", async () => {
    const missing = missingTokens(await loadBundledSdsRulesDocument());
    expect(missing, `${BUNDLED_SDS_RULES_FILENAME} opt-in section does not name: ${missing.join(", ")}`).toEqual([]);
  });

  it("FR-FLOW-177 AC-4: a branch added in an isolated copy of the predicate turns the check red", async () => {
    const extended = PREDICATE_SOURCE.replace(
      `  if (!intent.present) return "intent.md is absent";`,
      `  if (!intent.present) return "intent.md is absent";\n  if (intent.lines.length > 9999) return "intent.md has no 'Frobnicate Ledger' row";`
    );
    expect(extended, "the isolated copy did not take the extra branch").not.toBe(PREDICATE_SOURCE);
    expect(missingTokens(await loadBundledSdsRulesDocument(), extended)).toEqual(["Frobnicate Ledger"]);
  });

  it("FR-FLOW-177 AC-1: the document names the section, the line shape and the diagnostic", async () => {
    const section = await gateSection();
    expect(section).toContain("## Acceptance");
    expect(section).toMatch(/AC-<n>:/);
    expect(section).toContain("WHEN");
    expect(section).toContain("SHALL");
    expect(section).toContain(gateDiagnosticCode());
    expect(gateDiagnosticCode()).toBe("STEP_ACCEPTANCE_MISSING");
  });
});

describe("FR-FLOW-177 AC-5 — the denominator is the shipped document, not the tree", () => {
  it("FR-FLOW-177 AC-5: stays red when the same words are moved out of the section that ships them", () => {
    const relocated = relocateGateNaming(readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SDS_RULES_FILENAME), "utf8"));
    expect(missingTokens(relocated)).toEqual(requiredTokens());
  });

  it("FR-FLOW-177 AC-5: the neighbouring document is not what the check reads, even though it names the same things", () => {
    const neighbour = readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8");
    expect(requiredTokens().filter((token) => !neighbour.includes(token))).toEqual([]);
    expect(() => sectionCarrying(neighbour.replace(/\r\n/g, "\n"), GATE_LABEL, BUNDLED_SRS_RULES_FILENAME)).toThrow();
  });

  it("FR-FLOW-177 AC-5: reads the document through the loader `init` writes from", async () => {
    const loaded = await loadBundledSdsRulesDocument();
    const onDisk = readFileSync(path.join(REPO_ROOT, "docs", "rule", BUNDLED_SDS_RULES_FILENAME), "utf8");
    expect(loaded).toBe(onDisk);
  });
});

describe("FR-FLOW-177 AC-1 — an author who follows the document passes the step gate", () => {
  const STEP = "tdd-step-from-the-rules";

  /** The copyable `intent.md` the document embeds in its opt-in section. */
  async function documentedIntent(): Promise<string> {
    const section = await gateSection();
    const fence = /^```markdown\n([\s\S]*?)^```/m.exec(section);
    expect(fence, `${BUNDLED_SDS_RULES_FILENAME} opt-in section embeds no copyable intent.md`).not.toBeNull();
    return ((fence as RegExpExecArray)[1] as string).trimEnd();
  }

  it("FR-FLOW-177 AC-1: validates clean with no design.md, on an intent.md copied out of the document", async () => {
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
        `| ${STEP} | active | - | ARCH | - | 2026-10-20 | 2026-10-20 |`,
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(stepsDir, STEP, "intent.md"), `${await documentedIntent()}\n`, "utf8");

    const root = await resolveProjectRoot(rootPath);
    const result = validateWorkspaceScoped(await parseWorkspace(root), {
      step: STEP,
      design: await loadStepDesign(root, STEP),
      intent: await loadStepIntent(root, STEP)
    });
    expect(result.errors).toEqual([]);
  });
});

describe("FR-FLOW-177 AC-2 — the SRS rules list the error the step validator can raise", () => {
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
      const member = new RegExp(`^${range[1] as string}(\\d+)$`).exec(code);
      if (member && Number(member[1]) >= Number(range[2]) && Number(member[1]) <= Number(range[3])) return true;
    }
    return false;
  }

  it("FR-FLOW-177 AC-2: enumerates every code the step validator can emit", () => {
    const bullet = stepValidationBullet();
    const codes = [...stepValidatorCodes().keys()];
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !namesCode(bullet, code))).toEqual([]);
  });

  it("FR-FLOW-177 AC-2: names STEP_ACCEPTANCE_MISSING as the error and no longer lists SDS-E054", () => {
    const bullet = stepValidationBullet();
    const errors = [...stepValidatorCodes().entries()].filter(([, severity]) => severity === "error").map(([code]) => code);
    expect(errors).toEqual(["STEP_ACCEPTANCE_MISSING"]);
    expect(bullet).toMatch(/`STEP_ACCEPTANCE_MISSING`[\s\S]{0,200}?`error` severity/);
    expect(bullet).not.toContain("SDS-E054");
  });
});

describe("FR-FLOW-177 AC-3 — every copy of the agent block states the gate as FR-NODE-219 AC-3 does", () => {
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
        const stats = statSync(full, { throwIfNoEntry: false });
        if (!stats) continue;
        if (stats.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(?:ts|md|js|mjs|cjs|json|txt)$/.test(entry)) continue;
        for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
          const trimmed = line.trim();
          if (ANCHOR.test(trimmed)) found.push({ relPath: path.relative(REPO_ROOT, full).split(path.sep).join("/"), line: trimmed });
        }
      }
    };
    walk(REPO_ROOT);
    return found;
  }

  it("FR-FLOW-177 AC-3: every copy the tree carries names the diagnostic and no retired skip record", () => {
    const carriers = copies();
    expect(carriers.length, "no file carries the tdd-gates instruction line at all").toBeGreaterThan(1);
    const stale = carriers.filter(
      (copy) => !copy.line.includes(gateDiagnosticCode()) || !copy.line.includes("acceptance contract") || copy.line.includes("SDS-E054") || copy.line.includes("SDS Skip")
    );
    expect(stale.map((copy) => copy.relPath), "these copies still state the retired gate").toEqual([]);
  });

  it("FR-FLOW-177 AC-3: the markdown copies are byte-identical to the rendered line, so none of them drifts alone", () => {
    const rendered = renderAgentInstructionSnippet()
      .split("\n")
      .find((candidate) => ANCHOR.test(candidate.trim())) as string;
    expect(rendered).toContain(gateDiagnosticCode());
    const drifted = copies()
      .filter((copy) => copy.relPath.endsWith(".md"))
      .filter((copy) => copy.line !== rendered.trim());
    expect(drifted.map((copy) => copy.relPath)).toEqual([]);
  });
});
