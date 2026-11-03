import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-4 verification: kiwi-tdd and kiwi-step invoke kiwi-prd (FR-FLOW-204 AC-12), and kiwi-step
// hands contradiction resolutions to it through the kiwi-tdd rules, but kiwi-prd declares a
// different set of callers: its description names only kiwi-srs · kiwi-orchestrator ·
// kiwi-wave-master, and its step 4 accepts resolutions only from kiwi-srs or kiwi-tdd.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const CALLERS = ["kiwi-srs", "kiwi-tdd", "kiwi-step", "kiwi-orchestrator", "kiwi-wave-master"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const has = (rel: string): boolean => existsSync(path.join(REPO_ROOT, rel));

describe("kiwi-prd names the skills that invoke it (verify-r4)", () => {
  for (const root of RENDERINGS) {
    const prd = read(`${root}/kiwi-prd/SKILL.md`);
    const description = (/^description: "(.*)"$/m.exec(prd) ?? [])[1] ?? "";
    it(`${root}: precondition — kiwi-prd description present`, () => {
      expect(description.length).toBeGreaterThan(0);
    });
    for (const caller of CALLERS) {
      const rel = `${root}/${caller}/SKILL.md`;
      if (!has(rel) || !/invoke `kiwi-prd`|`kiwi-prd` 를 불러/.test(read(rel))) continue;
      // @req FR-FLOW-204 AC-12 — every skill that invokes kiwi-prd is a caller kiwi-prd declares
      it(`${root}: kiwi-prd description names its caller ${caller}`, () => {
        expect(description).toContain(caller);
      });
    }
    const step = `${root}/kiwi-step/SKILL.md`;
    if (has(step) && /contradiction resolved:/.test(read(step))) {
      // @req FR-FLOW-205 AC-6 — kiwi-step records resolutions through kiwi-prd, so kiwi-prd accepts them
      it(`${root}: kiwi-prd step 4 accepts a contradiction resolution from kiwi-step`, () => {
        const step4 = prd.split("\n").find((l) => l.startsWith("4. ")) ?? "";
        expect(step4).toMatch(/contradiction resolved:/);
        expect(step4).toContain("kiwi-step");
      });
    }
  }
});
