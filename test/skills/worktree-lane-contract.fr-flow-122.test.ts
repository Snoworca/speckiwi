import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-122
//
// Both orchestrating skills need the same worktree procedure and neither had it. Writing it into
// each would put one responsibility in two places — the failure mode where one copy gets corrected
// and the other silently diverges — so the procedure lives in one shared contract and each skill
// declares it.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLES = ["claude", "codex", "etc"] as const;
const CONTRACT = path.posix.join("_shared", "kiwi", "worktree-lane.md");

function contractPath(bundle: string): string {
  return path.join(REPO_ROOT, "skills", bundle, "_shared", "kiwi", "worktree-lane.md");
}

function readContract(bundle: string): string {
  return readFileSync(contractPath(bundle), "utf8");
}

function readSkill(bundle: string, skill: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", bundle, skill, "SKILL.md"), "utf8");
}

/** The §0 table rows, which is where every other SSOT in these skills is declared. */
function sectionZeroRows(text: string): string {
  return text
    .split("\n")
    .filter((line) => /^\|\s*§0\./.test(line))
    .join("\n");
}

describe("FR-FLOW-122 — the shared worktree-lane contract", () => {
  for (const bundle of BUNDLES) {
    describe(`bundle: ${bundle}`, () => {
      it("AC-1: ships the contract with a version marker", () => {
        expect(existsSync(contractPath(bundle)), `${bundle}: ${CONTRACT} is missing`).toBe(true);
        expect(/v\d+\.\d+\.\d+/.test(readContract(bundle)), `${bundle}: contract carries no version marker`).toBe(true);
      });

      it("AC-2: separates the run root from the lane workspace and puts SRS mutation at the run root", () => {
        const text = readContract(bundle);
        expect(/run root/i.test(text)).toBe(true);
        expect(/lane workspace/i.test(text)).toBe(true);
        // The claim is that the run root OWNS SRS mutation, so the assertion reads the run-root row
        // itself. A proximity window instead of the row was the first version and it was vacuous:
        // "never calls an SRS mutation" in §3 sits near the word "host" and satisfied it on its own.
        const runRootRow = /^\|\s*\*\*run root\*\*\s*\|.*$/m.exec(text)?.[0] ?? "";
        expect(runRootRow, `${bundle}: no run-root row found in the ownership table`).not.toBe("");
        expect(
          /SRS mutation/i.test(runRootRow),
          `${bundle}: the run-root row must name SRS mutation among what it owns`
        ).toBe(true);
      });

      it("AC-3: requires an explicit checkout and says why the default head is not trustworthy", () => {
        const text = readContract(bundle);
        expect(/checkout/i.test(text)).toBe(true);
        expect(/origin\//.test(text), `${bundle}: must name the measured default baseline`).toBe(true);
      });

      it("AC-4: forbids the three things a lane may never do", () => {
        const text = readContract(bundle);
        expect(/docs\/spec\//.test(text)).toBe(true);
        expect(/--root/.test(text)).toBe(true);
        expect(/--defer-srs-mutation/.test(text)).toBe(true);
      });

      it("AC-5: replays deferred mutations at the host root, admitted set only", () => {
        const text = readContract(bundle);
        expect(/replay|재생/i.test(text)).toBe(true);
        for (const tool of ["add_trace_link", "add_verification_evidence", "update_status", "add_completed_work"]) {
          expect(text.includes(tool), `${bundle}: the admitted set must name ${tool}`).toBe(true);
        }
      });

      it("AC-6: the host, not the lane, obtains the verification verdict", () => {
        const text = readContract(bundle);
        expect(/verification_cmd|verification command|검증 명령/i.test(text)).toBe(true);
      });

      it("AC-7: pins --include=dev and names the NODE_ENV failure it prevents", () => {
        const text = readContract(bundle);
        expect(/--include=dev/.test(text)).toBe(true);
        expect(/NODE_ENV=production/.test(text)).toBe(true);
        expect(/devDependencies/.test(text)).toBe(true);
      });

      for (const skill of ["kiwi-orchestrator", "kiwi-wave-master"] as const) {
        it(`AC-8: ${skill} declares the contract in its §0 table`, () => {
          const rows = sectionZeroRows(readSkill(bundle, skill));
          expect(
            rows.includes("worktree-lane.md"),
            `${bundle}/${skill}: §0 must declare _shared/kiwi/worktree-lane.md as the SSOT`
          ).toBe(true);
        });

        it(`AC-9: ${skill} gains no phase-1 profile vocabulary from this change`, () => {
          const body = readSkill(bundle, skill);
          expect(/\bbranch-serial-lane\b/.test(body), `${bundle}/${skill}`).toBe(false);
          expect(/\bpatch-lane\b/.test(body), `${bundle}/${skill}`).toBe(false);
        });
      }
    });
  }
});
