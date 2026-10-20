import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-197 — the README (both languages) describes the 4.1.0 workflow: the SDS on request,
// the default chain over requirement IDs, tdd steps with acceptance lines, and the wave declaration.
// AC-4 (counts) is the REL-FLOW-003 doc-lint pass in test/release/doc-lint.rel-flow-003.test.ts.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KOREAN_HEADING = "# SpecKiwi (한국어)";

/** The README split at the Korean top-level heading, so each language is held on its own. */
function readmeHalves(): { en: string; ko: string } {
  const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const split = readme.indexOf(`\n${KOREAN_HEADING}\n`);
  expect(split, "README.md must carry the Korean section heading").toBeGreaterThan(0);
  return { en: readme.slice(0, split), ko: readme.slice(split) };
}

function linesWith(text: string, ...tokens: string[]): string[] {
  return text.split("\n").filter((line) => tokens.every((token) => line.includes(token)));
}

const ARROW = String.raw`\s*(?:→|->)\s*`;
/** The FR-FLOW-193 chain, in order, on one line — arrows written either way, feasibility in parentheses. */
const CHAIN_4_1 = new RegExp(
  String.raw`kiwi-srs\`?${ARROW}\(\`?kiwi-srs-feasibility\`?\)${ARROW}\`?kiwi-pm\`?${ARROW}\`?kiwi-review-fix-loop`
);
/** The 4.0.0 chain that put kiwi-sds between feasibility and kiwi-pm. */
const CHAIN_4_0 = new RegExp(String.raw`kiwi-srs-feasibility\`?\)?\`?${ARROW}\`?kiwi-sds\`?${ARROW}\`?kiwi-pm`);

const LANGUAGES = [
  {
    key: "en" as const,
    onlyOnRequest: /\bonly\b/i,
    weaker: /weaker/i,
    existingCode: /existing code/i,
    declaration: /declaration/i
  },
  {
    key: "ko" as const,
    onlyOnRequest: /(?:때만|에만)/,
    weaker: /약한/,
    existingCode: /기존 코드/,
    declaration: /선언/
  }
];

describe("FR-FLOW-197 AC-1 — the default chain, the SDS on request and kiwi-pm --req-filter", () => {
  for (const language of LANGUAGES) {
    it(`FR-FLOW-197 AC-1 (${language.key}): states the FR-FLOW-193 chain and no longer the 4.0.0 chain`, () => {
      const text = readmeHalves()[language.key];
      expect(text, "the FR-FLOW-193 chain on one line").toMatch(CHAIN_4_1);
      expect(text, "the 4.0.0 chain with kiwi-sds as a default stage").not.toMatch(CHAIN_4_0);
    });

    it(`FR-FLOW-197 AC-1 (${language.key}): says kiwi-sds runs only when the user invokes it or passes --sds`, () => {
      const text = readmeHalves()[language.key];
      const lines = linesWith(text, "kiwi-sds", "--sds").filter((line) => language.onlyOnRequest.test(line));
      expect(lines.length, "a line saying kiwi-sds runs only on /kiwi-sds or --sds").toBeGreaterThan(0);
    });

    it(`FR-FLOW-197 AC-1 (${language.key}): says an SDS can help a weaker implementer on existing code`, () => {
      const text = readmeHalves()[language.key];
      const lines = linesWith(text, "SDS").filter((line) => language.weaker.test(line) && language.existingCode.test(line));
      expect(lines.length, "a line tying the SDS to a weaker implementer on existing code").toBeGreaterThan(0);
    });

    it(`FR-FLOW-197 AC-1 (${language.key}): says how kiwi-pm takes --req-filter`, () => {
      const text = readmeHalves()[language.key];
      expect(linesWith(text, "kiwi-pm", "--req-filter").length, "a line naming kiwi-pm with --req-filter").toBeGreaterThan(0);
    });
  }
});

describe("FR-FLOW-197 AC-2 — tdd steps take acceptance lines; design.md only under --sds", () => {
  for (const language of LANGUAGES) {
    it(`FR-FLOW-197 AC-2 (${language.key}): intent.md ## Acceptance is checked by step validate`, () => {
      const text = readmeHalves()[language.key];
      expect(linesWith(text, "intent.md", "## Acceptance", "step validate").length).toBeGreaterThan(0);
    });

    it(`FR-FLOW-197 AC-2 (${language.key}): every line naming design.md ties it to --sds`, () => {
      const text = readmeHalves()[language.key];
      const designLines = linesWith(text, "design.md");
      expect(designLines.length, "the step SDS is still described").toBeGreaterThan(0);
      expect(designLines.filter((line) => !line.includes("--sds")), "a line naming design.md without --sds").toEqual([]);
    });
  }
});

describe("FR-FLOW-197 AC-3 — the wave declaration file and its tools", () => {
  for (const language of LANGUAGES) {
    it(`FR-FLOW-197 AC-3 (${language.key}): names the declaration file and the commands that read it`, () => {
      const text = readmeHalves()[language.key];
      const declarationLines = linesWith(text, "waves.json").filter((line) => language.declaration.test(line));
      expect(declarationLines.length, "a line naming the wave declaration file").toBeGreaterThan(0);
      expect(text).toMatch(/orchestrate schedule waves --waves/);
      expect(text).toMatch(/orchestrate wave status/);
    });

    it(`FR-FLOW-197 AC-3 (${language.key}): shows orchestrate resume with no --facts`, () => {
      const text = readmeHalves()[language.key];
      expect(text).toMatch(/speckiwi orchestrate resume/);
      expect(text, "--facts is collected by the tool, so the README never asks for it").not.toContain("--facts");
    });
  }
});
