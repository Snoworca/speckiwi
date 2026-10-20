import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../../src/core/orchestrator/canonical-json.js";
import {
  declarationEntryDigest,
  parseWaveDeclaration,
  waveReadiness,
  type WaveDeclaration
} from "../../../src/core/orchestrator/wave-declaration.js";

// FR-NODE-216 — the wave declaration file: its parse, the ready set read against the journal's wave
// statuses, and the per-entry digest the lanes lock records.

function entry(wave: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { wave, files: [`src/${wave}.ts`], requirements: ["FR-ARCH-001"], ...extra };
}

function doc(...waves: Array<Record<string, unknown>>): Record<string, unknown> {
  return { schema_version: "1.0.0", waves };
}

function parsed(value: unknown): WaveDeclaration {
  const result = parseWaveDeclaration(value);
  if (!result.ok) throw new Error(`expected a declaration, got ${result.message}`);
  return result.declaration;
}

function refusal(value: unknown): { gate: string | null; message: string } {
  const result = parseWaveDeclaration(value);
  if (result.ok) throw new Error("expected a refusal");
  return { gate: result.gate, message: result.message };
}

describe("FR-NODE-216 AC-1 the declaration file and its parse-time refusals", () => {
  it("FR-NODE-216 AC-1 parses wave, depends_on, files, requirements and an optional sds per entry", () => {
    const declaration = parsed(doc(entry("wave-1"), entry("wave-2", { depends_on: [], sds: ["docs/sds/x.sds.md"] })));
    expect(declaration.waves).toEqual([
      { wave: "wave-1", order: 1, dependsOn: [], files: ["src/wave-1.ts"], requirements: ["FR-ARCH-001"] },
      { wave: "wave-2", order: 2, dependsOn: [], files: ["src/wave-2.ts"], requirements: ["FR-ARCH-001"], sds: ["docs/sds/x.sds.md"] }
    ]);
  });

  it("FR-NODE-216 AC-1 makes an entry without depends_on depend on every entry with a smaller n, whatever the file order", () => {
    const declaration = parsed(doc(entry("wave-3"), entry("wave-1"), entry("wave-2")));
    expect(declaration.waves.map((wave) => [wave.wave, wave.dependsOn])).toEqual([
      ["wave-1", []],
      ["wave-2", ["wave-1"]],
      ["wave-3", ["wave-1", "wave-2"]]
    ]);
  });

  it("FR-NODE-216 AC-1 refuses a wave name outside wave-<n>", () => {
    for (const name of [1, "1", "api", "w1", "wave-0", "wave-01", "Wave-1"]) {
      const refused = refusal(doc(entry(name as string)));
      expect(refused.message, String(name)).toContain("wave-");
      expect(refused.gate).toBeNull();
    }
  });

  it("FR-NODE-216 AC-1 refuses a depends_on member outside wave-<n>", () => {
    expect(refusal(doc(entry("wave-1"), entry("wave-2", { depends_on: ["w1"] }))).message).toContain("w1");
  });

  it("FR-NODE-216 AC-1 refuses an unknown key on an entry and at the top level", () => {
    expect(refusal(doc(entry("wave-1", { order: 1 }))).message).toContain("order");
    expect(refusal({ ...doc(entry("wave-1")), extra: true }).message).toContain("extra");
  });

  it("FR-NODE-216 AC-1 refuses a malformed entry and a malformed document", () => {
    expect(refusal(doc({ wave: "wave-1", requirements: [] })).message).toContain("files");
    expect(refusal(doc({ wave: "wave-1", files: "src/a.ts", requirements: [] })).message).toContain("files");
    expect(refusal(doc({ wave: "wave-1", files: [] })).message).toContain("requirements");
    expect(refusal(doc(entry("wave-1", { sds: "x.sds.md" }))).message).toContain("sds");
    expect(refusal({ schema_version: "2.0.0", waves: [] }).message).toContain("schema_version");
    expect(refusal({ schema_version: "1.0.0" }).message).toContain("waves");
    expect(refusal([]).message).toContain("object");
  });

  it("FR-NODE-216 AC-1 refuses a duplicate wave with gate lane-plan-incomplete", () => {
    const refused = refusal(doc(entry("wave-1"), entry("wave-1")));
    expect(refused.gate).toBe("lane-plan-incomplete");
    expect(refused.message).toContain("wave-1");
  });

  it("FR-NODE-216 AC-1 refuses a depends_on member naming no entry", () => {
    const refused = refusal(doc(entry("wave-1", { depends_on: ["wave-7"] })));
    expect(refused.gate).toBeNull();
    expect(refused.message).toContain("wave-7");
  });

  it("FR-NODE-216 AC-1 refuses a dependency cycle with gate schedule-cycle", () => {
    const refused = refusal(doc(entry("wave-1", { depends_on: ["wave-2"] }), entry("wave-2", { depends_on: ["wave-1"] })));
    expect(refused.gate).toBe("schedule-cycle");
    expect(refused.message).toContain("wave-1 -> wave-2 -> wave-1");
  });
});

describe("FR-NODE-216 AC-1 files[] paths are normalised and range-checked as SDS Files paths are", () => {
  it("FR-NODE-216 AC-1 writes every files[] path with / separators and no . segment", () => {
    const [wave] = parsed(doc(entry("wave-1", { files: ["src\\a.ts", "./src/b.ts", "src//c.ts"] }))).waves;
    expect(wave?.files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("FR-NODE-216 AC-1 refuses an absolute path and a path that leaves the root, naming it", () => {
    for (const bad of ["/etc/passwd", "C:\\Windows\\x.ts", "c:/x.ts", "../../etc/passwd", "src/../../x.ts", " "]) {
      const refused = refusal(doc(entry("wave-1", { files: [bad] })));
      expect(refused.gate, bad).toBeNull();
      expect(refused.message, bad).toContain("wave-1");
    }
  });

  it("FR-NODE-216 AC-7 digests the normalised files, so two spellings of one path digest the same", () => {
    const [slash] = parsed(doc(entry("wave-1", { files: ["src/a.ts"] }))).waves;
    const [backslash] = parsed(doc(entry("wave-1", { files: ["src\\a.ts"] }))).waves;
    expect(declarationEntryDigest(backslash!)).toBe(declarationEntryDigest(slash!));
  });
});

describe("FR-NODE-216 AC-2 the ready set is read from the journal's wave statuses", () => {
  const declaration = (): WaveDeclaration =>
    parsed(doc(entry("wave-1", { depends_on: [] }), entry("wave-2", { depends_on: ["wave-1"] }), entry("wave-3", { depends_on: ["wave-2"] })));

  it("FR-NODE-216 AC-2 plans wave 2 once wave 1 is complete, excludes wave 1 and defers wave 3", () => {
    const readiness = waveReadiness(declaration(), new Map([[1, "complete"]]));
    expect(readiness.ready.map((wave) => wave.wave)).toEqual(["wave-2"]);
    expect(readiness.complete.map((wave) => wave.wave)).toEqual(["wave-1"]);
    expect(readiness.deferred.map((wave) => wave.wave)).toEqual(["wave-3"]);
  });

  it("FR-NODE-216 AC-2 a wave whose latest status is in_progress or failed is still ready, and only complete satisfies a dependency", () => {
    const readiness = waveReadiness(declaration(), new Map([[1, "in_progress"]]));
    expect(readiness.ready.map((wave) => wave.wave)).toEqual(["wave-1"]);
    expect(readiness.deferred.map((wave) => wave.wave)).toEqual(["wave-2", "wave-3"]);
  });

  it("FR-NODE-216 AC-2 an empty journal makes the dependency-free entries ready", () => {
    const independent = parsed(doc(entry("wave-1"), entry("wave-2", { depends_on: [] })));
    expect(waveReadiness(independent, new Map()).ready.map((wave) => wave.wave)).toEqual(["wave-1", "wave-2"]);
  });
});

describe("FR-NODE-216 AC-7 the declaration-entry digest", () => {
  it("FR-NODE-216 AC-7 is the sha256 of the canonical JSON of wave, depends_on, files and sds", () => {
    const [wave] = parsed(doc(entry("wave-1", { sds: ["docs/sds/a.sds.md"] }))).waves;
    const expected = createHash("sha256")
      .update(canonicalJson({ wave: "wave-1", depends_on: [], files: ["src/wave-1.ts"], sds: ["docs/sds/a.sds.md"] }))
      .digest("hex");
    expect(declarationEntryDigest(wave!)).toBe(expected);
  });

  it("FR-NODE-216 AC-7 does not change when files[] is only reordered or repeats a path", () => {
    const [ordered] = parsed(doc(entry("wave-1", { files: ["src/a.ts", "src/b.ts"] }))).waves;
    const [reordered] = parsed(doc(entry("wave-1", { files: ["src/b.ts", "src/a.ts", "src\\a.ts"] }))).waves;
    expect(declarationEntryDigest(reordered!)).toBe(declarationEntryDigest(ordered!));
  });

  it("FR-NODE-216 AC-7 does not change when depends_on is only reordered or repeats a wave", () => {
    const base = [entry("wave-1"), entry("wave-2")];
    const [, , ordered] = parsed(doc(...base, entry("wave-3", { depends_on: ["wave-1", "wave-2"] }))).waves;
    const [, , reordered] = parsed(doc(...base, entry("wave-3", { depends_on: ["wave-2", "wave-1", "wave-2"] }))).waves;
    expect(declarationEntryDigest(reordered!)).toBe(declarationEntryDigest(ordered!));
  });

  it("FR-NODE-216 AC-7 does not cover requirements[], and does cover files", () => {
    const [base] = parsed(doc(entry("wave-1"))).waves;
    const [moreReqs] = parsed(doc(entry("wave-1", { requirements: ["FR-ARCH-001", "FR-ARCH-002"] }))).waves;
    const [moreFiles] = parsed(doc(entry("wave-1", { files: ["src/wave-1.ts", "src/other.ts"] }))).waves;
    expect(declarationEntryDigest(moreReqs!)).toBe(declarationEntryDigest(base!));
    expect(declarationEntryDigest(moreFiles!)).not.toBe(declarationEntryDigest(base!));
  });
});
