import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUN_ROOT_REFUSAL_REASONS,
  normaliseRoot,
  preflightRunRoot,
  type GitToplevelProbe,
  type RealpathProbe
} from "../../../src/core/orchestrator/preflight.js";

// @req FR-NODE-178 — the preflight corroborates the `--git-root` it is handed against the repository
// that path names, so the gate can no longer be satisfied by passing one value twice.

/** A realpath probe that resolves nothing, so every comparison is decided by the string rules. */
const identityRealpath: RealpathProbe = (value) => value;

/** Builds a toplevel probe from an explicit map; an unlisted path lies in no repository. */
function toplevelProbe(answers: Record<string, string>): GitToplevelProbe {
  return (value) => answers[value];
}

const REPO = "C:/Work/git/example";
const MODULE = "C:/Work/git/example/server";

describe("FR-NODE-178 — run-root preflight corroborates the passed git root", () => {
  it("AC-1 refuses a git root that is inside a repository but is not its top level", () => {
    // Both roots are the module path — the exact forgery the four normalisation rules grant today.
    const verdict = preflightRunRoot(MODULE, MODULE, {
      realpath: identityRealpath,
      gitToplevel: toplevelProbe({ [MODULE]: REPO })
    });

    expect(verdict.ok, "a module path is not the top level of the repository containing it").toBe(false);
    expect(verdict.reason).toBe("git-root-not-toplevel");
    expect(verdict.gitToplevel, "the verdict reports the top level the probe named").toBe(REPO);
    expect(
      verdict.comparison.match,
      "the two-root comparison still matched — which is precisely why it alone cannot decide this"
    ).toBe(true);
  });

  it("AC-2 refuses a git root that lies in no repository at all", () => {
    const verdict = preflightRunRoot("C:/tmp/scratch", "C:/tmp/scratch", {
      realpath: identityRealpath,
      gitToplevel: toplevelProbe({})
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("git-root-not-a-repository");
    expect(verdict.gitToplevel, "there is no top level to report").toBeNull();
  });

  it("AC-3 still passes a genuine top level, including one an earlier normalisation rule decides", () => {
    const corroborated = { realpath: identityRealpath, gitToplevel: toplevelProbe({ [REPO]: REPO }) };

    const identical = preflightRunRoot(REPO, REPO, corroborated);
    expect(identical.ok, "the corroboration adds a refusal; it removes no existing pass").toBe(true);
    expect(identical.reason).toBeNull();

    // A pass the `separators` rule grants must survive the corroboration unchanged.
    const separators = preflightRunRoot("C:\\Work\\git\\example", REPO, corroborated);
    expect(separators.ok).toBe(true);
    expect(separators.comparison.rule).toBe("separators");
  });

  it("AC-3 refuses two roots that genuinely differ, reporting the comparison rather than the corroboration", () => {
    const verdict = preflightRunRoot("C:/Work/git/other", REPO, {
      realpath: identityRealpath,
      gitToplevel: toplevelProbe({ [REPO]: REPO })
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason, "the git root corroborated; what failed is the two-root comparison").toBe("roots-differ");
  });

  it("reports the corroboration failure when both conditions fail at once", () => {
    // Without a fixed order the reason would depend on evaluation accident, and the operator would be
    // told to reconcile two roots when the real repair is to name the repository instead of a module.
    const verdict = preflightRunRoot("C:/Work/git/other", MODULE, {
      realpath: identityRealpath,
      gitToplevel: toplevelProbe({ [MODULE]: REPO })
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("git-root-not-toplevel");
  });

  it("AC-5 corroborates through the injected probe alone, touching no disk", async () => {
    // Paths that exist on no filesystem still decide the verdict, so nothing was resolved for real.
    const verdict = preflightRunRoot("/nowhere/at/all", "/nowhere/at/all", {
      realpath: identityRealpath,
      gitToplevel: toplevelProbe({ "/nowhere/at/all": "/nowhere/at/all" })
    });
    expect(verdict.ok).toBe(true);

    // FR-NODE-153 AC-4's other half, guarded here because this requirement is what would break it:
    // the module declares no import, so it holds no facility to reach a filesystem or a subprocess.
    const source = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../src/core/orchestrator/preflight.ts"),
      "utf8"
    );
    expect(
      /^\s*import\s/m.test(source),
      "preflight.ts must keep declaring no import; both probes arrive as parameters"
    ).toBe(false);
    expect(/require\(|child_process|node:fs/.test(source), "nor reach one by another name").toBe(false);
  });

  it("keeps normaliseRoot a pure two-root comparison with no probe beyond realpath", () => {
    const comparison = normaliseRoot("C:/a", "c:/A/", identityRealpath);
    expect(comparison.match).toBe(true);
    expect(normaliseRoot.length, "normaliseRoot still takes exactly its two roots and the realpath probe").toBe(3);
  });

  it("draws the reason from a closed set", () => {
    expect([...RUN_ROOT_REFUSAL_REASONS]).toEqual(["git-root-not-a-repository", "git-root-not-toplevel", "roots-differ"]);

    const reasons = new Set<string | null>();
    for (const [mcp, git, answers] of [
      [MODULE, MODULE, { [MODULE]: REPO }],
      ["C:/tmp/x", "C:/tmp/x", {}],
      [REPO, REPO, { [REPO]: REPO }],
      ["C:/other", REPO, { [REPO]: REPO }]
    ] as Array<[string, string, Record<string, string>]>) {
      reasons.add(preflightRunRoot(mcp, git, { realpath: identityRealpath, gitToplevel: toplevelProbe(answers) }).reason);
    }
    for (const reason of reasons) {
      if (reason === null) continue;
      expect(RUN_ROOT_REFUSAL_REASONS as readonly string[]).toContain(reason);
    }
  });
});
