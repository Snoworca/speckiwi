import { describe, expect, it } from "vitest";
import { ROOT_NORMALISATION_RULES, normaliseRoot, type RealpathProbe } from "../../../src/core/orchestrator/preflight.js";

/** A probe that never rewrites anything, for the three rules that decide before `realpath` runs. */
const identityProbe: RealpathProbe = (value) => value;

/** A probe that maps two distinct spellings onto one real path, and touches no disk to do it. */
function linkProbe(mapping: Record<string, string>): RealpathProbe {
  return (value) => mapping[value] ?? value;
}

describe("FR-NODE-153 run-root preflight comparison", () => {
  // AC-1 — one match fixture per rule, each asserting the rule that decided it.
  it("matches two roots differing only in path separators under rule separators", () => {
    const result = normaliseRoot("C:\\Work\\git\\speckiwi", "C:/Work/git/speckiwi", identityProbe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("separators");
    expect(result.normalisedA).toBe("C:/Work/git/speckiwi");
    expect(result.normalisedB).toBe("C:/Work/git/speckiwi");
  });

  it("matches two roots differing only in a trailing separator under rule trailing-separator", () => {
    const result = normaliseRoot("C:/Work/git/speckiwi/", "C:/Work/git/speckiwi", identityProbe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("trailing-separator");
    expect(result.normalisedA).toBe("C:/Work/git/speckiwi");
    expect(result.normalisedB).toBe("C:/Work/git/speckiwi");
  });

  it("matches two roots differing only in letter case, drive letter included, under rule windows-case", () => {
    const result = normaliseRoot("C:/Work/Git/SpecKiwi", "c:/work/git/speckiwi", identityProbe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("windows-case");
    expect(result.normalisedA).toBe("c:/work/git/speckiwi");
    expect(result.normalisedB).toBe("c:/work/git/speckiwi");
  });

  it("matches two roots that resolve through the injected probe to one real path under rule realpath", () => {
    const probe = linkProbe({
      "C:/Users/beom/link-to-repo": "C:/Work/git/speckiwi",
      "C:/Work/git/speckiwi": "C:/Work/git/speckiwi"
    });

    const result = normaliseRoot("C:/Users/beom/link-to-repo", "C:/Work/git/speckiwi", probe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("realpath");
    expect(result.normalisedA).toBe("c:/work/git/speckiwi");
    expect(result.normalisedB).toBe("c:/work/git/speckiwi");
  });

  it("reports the first rule for two roots that are already byte-identical, so the rule stays inside the closed set", () => {
    const result = normaliseRoot("C:/Work/git/speckiwi", "C:/Work/git/speckiwi", identityProbe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("separators");
  });

  // AC-2 — one mismatch fixture per rule: the two roots genuinely differ under that rule's subject.
  it("reports no match when the separator-shaped roots genuinely differ", () => {
    const result = normaliseRoot("C:\\Work\\git\\speckiwi", "C:\\Work\\git\\other-repo", identityProbe);

    expect(result.match).toBe(false);
    expect(result.normalisedA).toBe("c:/work/git/speckiwi");
    expect(result.normalisedB).toBe("c:/work/git/other-repo");
  });

  it("reports no match when a trailing separator hides a genuinely different last segment", () => {
    const result = normaliseRoot("C:/Work/git/speckiwi/", "C:/Work/git/speckiwi-fork", identityProbe);

    expect(result.match).toBe(false);
  });

  it("reports no match when case-folding still leaves two different roots", () => {
    const result = normaliseRoot("C:/Work/Git/SpecKiwi", "d:/work/git/speckiwi", identityProbe);

    expect(result.match).toBe(false);
  });

  it("reports no match when the probe resolves the two roots to two different real paths", () => {
    const probe = linkProbe({
      "C:/Users/beom/link-a": "C:/Work/git/speckiwi",
      "C:/Users/beom/link-b": "C:/Work/git/speckiwi-fork"
    });

    const result = normaliseRoot("C:/Users/beom/link-a", "C:/Users/beom/link-b", probe);

    expect(result.match).toBe(false);
    expect(result.normalisedA).toBe("c:/work/git/speckiwi");
    expect(result.normalisedB).toBe("c:/work/git/speckiwi-fork");
  });

  // AC-3 — the rule vocabulary is closed at four values, on every path through the function.
  it("returns a rule inside the closed four-value set for every match and mismatch fixture", () => {
    const probe = linkProbe({ "C:/link": "C:/Work/git/speckiwi" });
    const fixtures: Array<[string, string]> = [
      ["C:\\Work\\repo", "C:/Work/repo"],
      ["C:/Work/repo/", "C:/Work/repo"],
      ["C:/Work/Repo", "c:/work/repo"],
      ["C:/link", "C:/Work/git/speckiwi"],
      ["C:/Work/repo", "C:/Work/elsewhere"],
      ["", ""],
      ["/", "/"],
      ["C:/", "c:\\"]
    ];

    expect(ROOT_NORMALISATION_RULES).toEqual(["separators", "trailing-separator", "windows-case", "realpath"]);
    for (const [a, b] of fixtures) {
      const result = normaliseRoot(a, b, probe);
      expect(ROOT_NORMALISATION_RULES).toContain(result.rule);
    }
  });

  // AC-4 — no filesystem access: the realpath answer arrives only through the probe.
  it("consults the injected probe rather than the disk, and reports a match for two paths only the probe relates", () => {
    const consulted: string[] = [];
    const probe: RealpathProbe = (value) => {
      consulted.push(value);
      return "C:/definitely/not/on/this/disk";
    };

    const result = normaliseRoot("C:/no/such/path/a", "C:/no/such/path/b", probe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("realpath");
    expect(consulted).toEqual(["C:/no/such/path/a", "C:/no/such/path/b"]);
  });

  it("does not consult the probe at all when an earlier rule already decided the comparison", () => {
    const consulted: string[] = [];
    const probe: RealpathProbe = (value) => {
      consulted.push(value);
      return value;
    };

    const result = normaliseRoot("C:\\Work\\repo\\", "C:/Work/repo", probe);

    expect(result.match).toBe(true);
    expect(result.rule).toBe("trailing-separator");
    expect(consulted).toEqual([]);
  });
});
