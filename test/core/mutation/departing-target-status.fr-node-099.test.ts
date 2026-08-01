import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { documentedTargetStatuses } from "../../support/rules-vocabulary.js";

// FR-NODE-099 — moving the Active Target used to demote the departing target to `planned`, which the
// rules document defines as "Not started yet". A target whose requirements are all verified is not
// unstarted, and the record only ever moved in the direction that loses information: this repository
// carries eleven rows in that false state, including one with a shipped git tag.

const SPEC = ["docs", "spec"] as const;

async function setRequirementStatus(rootPath: string, status: string): Promise<void> {
  const file = path.join(rootPath, ...SPEC, "10.product-architecture.srs.md");
  const body = await readFile(file, "utf8");
  await writeFile(file, body.replace("| Status | planned |", `| Status | ${status} |`), "utf8");
}

async function targetMapRow(rootPath: string, target: string): Promise<string | undefined> {
  const index = await readFile(path.join(rootPath, ...SPEC, "00.index.md"), "utf8");
  return index.split(/\r?\n/).find((line) => line.startsWith(`| ${target} |`));
}

describe("FR-NODE-099 AC-1 — a finished departing target becomes completed", () => {
  it("writes completed when every requirement of the departing target is verified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await setRequirementStatus(rootPath, "verified");

    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(result).toMatchObject({ ok: true, value: { activeTarget: "v1.1.0", previousActiveTarget: "v1.0.0" } });
    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | completed | Fixture release |");
  });
});

describe("FR-NODE-099 AC-2 — an unfinished departing target stays planned", () => {
  it("leaves planned when a requirement is not verified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | planned | Fixture release |");
  });

  it("leaves planned when only some requirements are verified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, ...SPEC, "10.product-architecture.srs.md");
    const body = await readFile(file, "utf8");
    // A second requirement on the same target, left unverified.
    const block = body.slice(body.indexOf("### FR-ARCH-001"));
    await writeFile(file, `${body.replace("| Status | planned |", "| Status | verified |")}\n${block.replace("FR-ARCH-001", "FR-ARCH-002")}`, "utf8");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | planned | Fixture release |");
  });
});

describe("FR-NODE-099 AC-1 — a discarded requirement does not block completion", () => {
  it("treats a target whose live requirements are all verified as complete", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, ...SPEC, "10.product-architecture.srs.md");
    const body = await readFile(file, "utf8");
    const second = body.slice(body.indexOf("### FR-ARCH-001")).replace("FR-ARCH-001", "FR-ARCH-002").replace("| Status | planned |", "| Status | discarded |");
    await writeFile(file, `${body.replace("| Status | planned |", "| Status | verified |")}\n${second}`, "utf8");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    // Every other completion rule in the codebase excludes discarded requirements —
    // release-readiness and the target summary both do. `supersede_requirement` produces this state
    // as a normal step, so counting it as unfinished would keep most real targets at "not started".
    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | completed | Fixture release |");
  });

  it("does not call a target complete when every requirement was discarded", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await setRequirementStatus(rootPath, "discarded");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | planned | Fixture release |");
  });
});

describe("FR-NODE-099 AC-1 — completion is not claimed from a workspace that will not parse", () => {
  it("stays planned when the workspace carries parse errors", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    // One verified requirement plus one that is NOT verified and whose heading is malformed. A
    // malformed block is dropped from `records` with a diagnostic rather than throwing, so the
    // unfinished requirement disappears and the target looks finished. Completion must not be
    // inferred from a parse the mutation never checked. One requirement alone would not show this:
    // dropping it empties the set, and the empty-set branch happens to return planned anyway.
    const file = path.join(rootPath, ...SPEC, "10.product-architecture.srs.md");
    const body = await readFile(file, "utf8");
    const broken = body.slice(body.indexOf("### FR-ARCH-001")).replace("### FR-ARCH-001 — Mutable requirement", "### FR-ARCH-002 Malformed heading");
    await writeFile(file, `${body.replace("| Status | planned |", "| Status | verified |")}\n${broken}`, "utf8");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | planned | Fixture release |");
  });
});

describe("FR-NODE-099 AC-1 — completion is not claimed over a validation error", () => {
  it("stays planned when a requirement's metadata does not parse", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, ...SPEC, "10.product-architecture.srs.md");
    const body = await readFile(file, "utf8");
    // A block whose Target row is missing is NOT dropped and emits no parse diagnostic: it survives
    // with an empty target, which silently removes it from v1.0.0's set. The target then looks
    // finished because its only unfinished requirement is no longer counted against it.
    const second = body
      .slice(body.indexOf("### FR-ARCH-001"))
      .replace("FR-ARCH-001", "FR-ARCH-002")
      .replace("| Target | v1.0.0 |\n", "");
    await writeFile(file, `${body.replace("| Status | planned |", "| Status | verified |")}\n${second}`, "utf8");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | planned | Fixture release |");
  });
});

describe("FR-NODE-099 AC-2 — each departing row is judged on its own requirements", () => {
  it("does not write one target's completion onto another active row", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(rootPath, ...SPEC, "00.index.md");
    const index = await readFile(indexPath, "utf8");
    // An invalid two-active state, which is what an author reaches for this command to repair.
    await writeFile(indexPath, index.replace("| v1.1.0 | version | planned |", "| v1.1.0 | version | active |"), "utf8");
    await setRequirementStatus(rootPath, "verified");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.2.0", create: true, targetType: "version", description: "Third" });

    // v1.0.0 owns the verified requirement; v1.1.0 owns none and must not inherit its completion.
    expect(await targetMapRow(rootPath, "v1.1.0")).toBe("| v1.1.0 | version | planned | Next fixture target |");
  });
});

describe("FR-NODE-099 AC-3 — a departing target with no requirements stays planned", () => {
  it("does not call an empty target complete", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    // Move the fixture's only requirement off the departing target.
    const file = path.join(rootPath, ...SPEC, "10.product-architecture.srs.md");
    const body = await readFile(file, "utf8");
    await writeFile(file, body.replace("| Target | v1.0.0 |", "| Target | v1.1.0 |"), "utf8");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(await targetMapRow(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | planned | Fixture release |");
  });
});

describe("FR-NODE-099 AC-4 — the written statuses come from the documented vocabulary", () => {
  it("writes only statuses the rules document defines", async () => {
    const statuses = await documentedTargetStatuses();
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await setRequirementStatus(rootPath, "verified");

    await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    const index = await readFile(path.join(rootPath, ...SPEC, "00.index.md"), "utf8");
    const rows = index.split(/\r?\n/).filter((line) => /^\| v\d/.test(line));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const status = row.split("|")[3]?.trim();
      expect(statuses, `"${status}" must be a documented target status`).toContain(status);
    }
  });

  it("draws completed from the document rather than from a literal in the source", async () => {
    const statuses = await documentedTargetStatuses();
    const source = await readFile(path.join("src", "core", "mutation", "set-active-target.ts"), "utf8");

    expect(statuses).toContain("completed");
    // Two status literals sitting together is the shape that lets one surface drift from another.
    const names = statuses.join("|");
    const twoLiteralsTogether = new RegExp('"(?:' + names + ')"[\\s\\S]{0,40}?"(?:' + names + ')"');
    expect(source, "the demotion must not enumerate the status vocabulary itself").not.toMatch(twoLiteralsTogether);
  });
});
