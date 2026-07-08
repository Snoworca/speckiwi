import { describe, expect, it } from "vitest";
import {
  CODEX_APPLY_PATCH_HOOK_FLOOR,
  isCodexVersionBelowApplyPatchFloor
} from "../../../src/core/bootstrap/templates.js";

// FND-005 / FR-NODE-038 AC-3 — the Codex version gate decides whether the
// detected `codex --version` string is below the apply_patch hook floor
// (CODEX_APPLY_PATCH_HOOK_FLOOR). The boundary cases below pin the corrected
// semantics:
//   - the version must be read from the leading semver token (anchored), so a
//     noisy "codex-cli 0.19.0 (build abc)" line still compares 0.19.0;
//   - a prerelease suffix on an otherwise-equal X.Y.Z (e.g. 0.20.0-rc.1) is
//     BELOW the X.Y.Z floor, because the prerelease precedes the final release;
//   - an unparseable version surfaces uncertainty as below-floor (so the caller
//     warns) rather than silently passing.
// The two FR-NODE-038 AC-3 anchors (0.0.1 below, 999.0.0 not below) must keep
// passing.
describe("FND-005 — isCodexVersionBelowApplyPatchFloor boundary semantics", () => {
  it("treats a clearly-old version as below the floor (FR-NODE-038 AC-3 anchor)", () => {
    expect(isCodexVersionBelowApplyPatchFloor("0.0.1")).toBe(true);
  });

  it("treats a clearly-new version as at/above the floor (FR-NODE-038 AC-3 anchor)", () => {
    expect(isCodexVersionBelowApplyPatchFloor("999.0.0")).toBe(false);
  });

  it("treats the exact floor version as not below", () => {
    expect(isCodexVersionBelowApplyPatchFloor(CODEX_APPLY_PATCH_HOOK_FLOOR)).toBe(false);
  });

  it("treats a prerelease of the floor version as below the floor", () => {
    // 0.20.0-rc.1 precedes the final 0.20.0 release, so the apply_patch hook
    // support is not guaranteed yet.
    expect(isCodexVersionBelowApplyPatchFloor("0.20.0-rc.1")).toBe(true);
  });

  it("does not treat a prerelease of a newer version as below the floor", () => {
    // 0.21.0-rc.1 is still newer than the 0.20.0 floor.
    expect(isCodexVersionBelowApplyPatchFloor("0.21.0-rc.1")).toBe(false);
  });

  it("reads the version from the leading semver token in a noisy version line", () => {
    expect(isCodexVersionBelowApplyPatchFloor("0.19.0 (2026-06-01 build deadbeef)")).toBe(true);
    expect(isCodexVersionBelowApplyPatchFloor("0.21.0 (2026-06-01 build deadbeef)")).toBe(false);
  });

  it("surfaces an unparseable version as below the floor (uncertainty -> warn)", () => {
    expect(isCodexVersionBelowApplyPatchFloor("not-a-version")).toBe(true);
    expect(isCodexVersionBelowApplyPatchFloor("")).toBe(true);
  });
});
