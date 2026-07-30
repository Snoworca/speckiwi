import { describe, expect, it } from "vitest";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-096 AC-1 — the §14.2 statement about status transitions, pinned against the runtime rather
// than against the document's own words.
//
// This suite exists because the first correction of §14.2 was itself false. It claimed
// "`update_status` writes whatever status it is given, so `planned -> verified` succeeds"; the runtime
// refuses that write with MUTATION_DENIED. A document-string assertion cannot catch that class of
// error — only executing the call can. Every claim §14.2 now makes about a write is exercised here, so
// the sentence and the runtime cannot drift apart again in either direction.

async function root(fixture = "valid-basic") {
  return resolveProjectRoot(await copyFixtureWorkspace(fixture));
}

describe("FR-NODE-096 AC-1 — the verified transition is refused at the write", () => {
  it("refuses planned -> verified for a requirement whose criteria are unchecked", async () => {
    const result = await updateStatus(await root(), { id: "FR-ARCH-001", status: "verified" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
    // The refusal is about shape, which is what §14.2 now says.
    expect(result.ok === false && result.error.message).toMatch(/verified without checked AC and evidence/);
  });

  it("refuses it for a requirement with every criterion checked but no evidence", async () => {
    const projectRoot = await root();
    const { setAcceptanceCriteriaChecked } = await import("../../../src/core/mutation/check-ac.js");
    const checked = await setAcceptanceCriteriaChecked(projectRoot, { id: "FR-ARCH-001", acIds: ["AC-1", "AC-2"], checked: true });
    expect(checked.ok, "the fixture's criteria must be checkable").toBe(true);

    const result = await updateStatus(projectRoot, { id: "FR-ARCH-001", status: "verified" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
  });

  it("allows it once the requirement is already in verified shape", async () => {
    const projectRoot = await root();
    const { setAcceptanceCriteriaChecked } = await import("../../../src/core/mutation/check-ac.js");
    const { addVerificationEvidence } = await import("../../../src/core/mutation/add-evidence.js");
    expect((await setAcceptanceCriteriaChecked(projectRoot, { id: "FR-ARCH-001", acIds: ["AC-1", "AC-2"], checked: true })).ok).toBe(true);
    expect(
      (await addVerificationEvidence(projectRoot, { id: "FR-ARCH-001", type: "test", reference: "test/example.test.ts" })).ok
    ).toBe(true);

    const result = await updateStatus(projectRoot, { id: "FR-ARCH-001", status: "verified" });

    // §14.2 says the transition succeeds only for a requirement already in verified shape. This is
    // that case, so it must succeed — otherwise the statement would be too permissive in the other
    // direction.
    expect(result.ok).toBe(true);
  });
});

describe("FR-NODE-096 AC-1 — the implemented transition has no write-time gate", () => {
  it("allows planned -> implemented with none of the §14.3 conditions present", async () => {
    const result = await updateStatus(await root(), { id: "FR-ARCH-001", status: "implemented" });

    expect(result.ok).toBe(true);
  });

  it("allows implemented -> in_progress, so the direction of travel is not gated either", async () => {
    const projectRoot = await root();
    expect((await updateStatus(projectRoot, { id: "FR-ARCH-001", status: "implemented" })).ok).toBe(true);

    expect((await updateStatus(projectRoot, { id: "FR-ARCH-001", status: "in_progress" })).ok).toBe(true);
  });

  it("allows a transition the conventional list omits, so the list itself is not consulted", async () => {
    // `blocked` is reachable from `in_progress` in the list but not from `planned`. The write succeeds,
    // which is exactly what "the list itself is not a gate" means.
    const result = await updateStatus(await root(), { id: "FR-ARCH-001", status: "blocked" });

    expect(result.ok).toBe(true);
  });
});

describe("FR-NODE-096 AC-1 — the discarded transition is guarded for a protected requirement", () => {
  it("refuses it without the explicit confirmation flag", async () => {
    const result = await updateStatus(await root(), { id: "FR-ARCH-001", status: "discarded" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
    expect(result.ok === false && result.error.message).toMatch(/confirmDiscardVerified/);
  });
});
