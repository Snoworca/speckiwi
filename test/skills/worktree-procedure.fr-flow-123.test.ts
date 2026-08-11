import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-123
//
// Declaring the contract in §0 gave the skills a pointer and no procedure: an agent reading either
// skill top to bottom found nothing it could run. A contract with no caller in the body is the
// documentation form of the kernel with no caller in `src/`, and this target has now met that shape
// twice. The steps must name real commands, because the failure the contract exists to prevent was a
// command sequence that looked right and detached HEAD — prose that stops short of the command
// cannot be checked against the tool at all.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLES = ["claude", "codex", "etc"] as const;
const SKILLS = ["kiwi-orchestrator", "kiwi-wave-master"] as const;

function readSkill(bundle: string, skill: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", bundle, skill, "SKILL.md"), "utf8");
}

/** The worktree procedure section, located by its own marker rather than by a fixed number. */
function procedure(text: string): string {
  const start = /^## [^\n]*워크트리 절차[^\n]*$/m.exec(text);
  if (start === null) return "";
  const rest = text.slice(start.index);
  const next = /\n## /.exec(rest.slice(1));
  return next === null ? rest : rest.slice(0, next.index + 1);
}

describe("FR-FLOW-123 — an executable worktree procedure in both skills", () => {
  for (const bundle of BUNDLES) {
    for (const skill of SKILLS) {
      describe(`${bundle}/${skill}`, () => {
        it("AC-1: carries a numbered worktree procedure section", () => {
          expect(procedure(readSkill(bundle, skill)), `${bundle}/${skill}: no worktree procedure section`).not.toBe("");
        });

        it("AC-2: creates with the base on the same command and never checks it out separately", () => {
          const body = procedure(readSkill(bundle, skill));
          expect(
            /git worktree add[^\n]*<base_sha>/.test(body),
            `${bundle}/${skill}: the create step must pass <base_sha> to git worktree add`
          ).toBe(true);
          expect(
            /checkout <base_sha>/.test(body),
            `${bundle}/${skill}: a separate checkout of the base detaches HEAD — it must not be instructed`
          ).toBe(false);
        });

        it("AC-3: admits the placement through the role gate", () => {
          const body = procedure(readSkill(bundle, skill));
          expect(/orchestrate preflight/.test(body)).toBe(true);
          expect(/--role lane/.test(body), `${bundle}/${skill}: the placement must be admitted, not assumed`).toBe(true);
        });

        it("AC-4: lands the deferred mutations with the applier", () => {
          expect(/orchestrate replay apply/.test(procedure(readSkill(bundle, skill)))).toBe(true);
        });

        it("AC-5: releases only after the harvest, and names them in that order", () => {
          const body = procedure(readSkill(bundle, skill));
          const harvest = body.search(/harvest|수확/i);
          const release = body.search(/release|반납/i);
          expect(harvest, `${bundle}/${skill}: harvest is not named`).toBeGreaterThan(-1);
          expect(release, `${bundle}/${skill}: release is not named`).toBeGreaterThan(-1);
          expect(harvest, `${bundle}/${skill}: release must come after harvest`).toBeLessThan(release);
        });

        it("AC-6: names the target the procedure applies under", () => {
          expect(
            /2\.6\.0-phase2-parallel-lanes/.test(procedure(readSkill(bundle, skill))),
            `${bundle}/${skill}: without the target this reads as a claim about a phase that creates none`
          ).toBe(true);
        });

        it("AC-7: points at the shared contract instead of restating it", () => {
          expect(/worktree-lane\.md/.test(procedure(readSkill(bundle, skill)))).toBe(true);
        });
      });
    }
  }
});
