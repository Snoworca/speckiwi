import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_KIWI_SKILLS,
  EXPECTED_SKILL_ENTRYPOINTS,
  runPackageDoctor
} from "../../src/doctor/package-doctor.js";

// @req FR-NODE-130 — `package-doctor` requires `kiwi-orchestrator` under each of the three bundled
// variants, because a skill absent from the expectation set ships broken with no check firing.

const REPO_ROOT = path.resolve(".");
const VARIANTS = ["codex", "claude", "etc"] as const;

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** A package root holding only the files `runPackageDoctor` reads, so a variant can be removed. */
async function packageRootCopy(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), "speckiwi-package-doctor-"));
  for (const entry of ["package.json", "package-lock.json", "skills", "bin", "dist"]) {
    const source = path.join(REPO_ROOT, entry);
    if (await exists(source)) await cp(source, path.join(target, entry), { recursive: true });
  }
  return target;
}

function entrypointCheck(report: { checks: Array<{ id: string; status: string; details?: Record<string, unknown> }> }) {
  const check = report.checks.find((item) => item.id === "packed-skill-entrypoints");
  expect(check, "package-doctor must run the packed-skill-entrypoints check").toBeDefined();
  return check as NonNullable<typeof check>;
}

describe("FR-NODE-130 AC-1 / AC-2 — the expectation set and its three-variant expansion", () => {
  it("lists kiwi-orchestrator among the expected skills", () => {
    expect(EXPECTED_KIWI_SKILLS).toContain("kiwi-orchestrator");
  });

  it("derives exactly three kiwi-orchestrator entrypoints, one per bundled variant", () => {
    const orchestratorEntries = EXPECTED_SKILL_ENTRYPOINTS.filter((entry) => entry.includes("/kiwi-orchestrator/"));

    expect(orchestratorEntries).toHaveLength(3);
    expect([...orchestratorEntries].sort()).toEqual(
      [...VARIANTS].map((variant) => `skills/${variant}/kiwi-orchestrator/SKILL.md`).sort()
    );
    // The expansion is mechanical, not a hand-written trio.
    expect(EXPECTED_SKILL_ENTRYPOINTS).toHaveLength(EXPECTED_KIWI_SKILLS.length * VARIANTS.length);
  });
});

describe("FR-NODE-130 AC-3 / AC-4 — a missing variant is a doctor failure that names it", () => {
  it("passes once all three variants exist", async () => {
    const packageRoot = await packageRootCopy();

    const report = await runPackageDoctor({ root: REPO_ROOT }, { packageRoot });

    const check = entrypointCheck(report);
    expect(check.status, JSON.stringify(check.details)).toBe("pass");
  });

  for (const variant of VARIANTS) {
    it(`fails and names the missing ${variant} variant when its entrypoint is removed`, async () => {
      const entry = `skills/${variant}/kiwi-orchestrator/SKILL.md`;

      // The baseline must not already report the entry, or the removal below would prove nothing.
      const baseline = entrypointCheck(await runPackageDoctor({ root: REPO_ROOT }, { packageRoot: await packageRootCopy() }));
      expect(baseline.details?.missingSkillFiles ?? [], "baseline must have every variant present").not.toContain(entry);

      const packageRoot = await packageRootCopy();
      await rm(path.join(packageRoot, "skills", variant, "kiwi-orchestrator", "SKILL.md"), { force: true });

      const check = entrypointCheck(await runPackageDoctor({ root: REPO_ROOT }, { packageRoot }));

      expect(check.status).toBe("fail");
      expect(check.details?.missingSkillFiles).toEqual([entry]);
    });
  }
});
