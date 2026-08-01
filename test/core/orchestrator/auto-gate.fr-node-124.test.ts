// FR-NODE-124 — decideAutoGate: the recommended fast path, simple majority, and the halt on an
// unresolved tie or a degraded quorum (05 §12, as amended by 08 §2).
//
// A7 is DECLINED 5-0: the `tieRung` parameter ships `false` and no rung is implemented behind it.
// The parameter exists only so a later reversal is additive rather than structural.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import * as journalSchema from "../../../src/core/orchestrator/journal-schema.js";
import { decideAutoGate, AUTO_GATE_ACTIONS, type AutoGateInput } from "../../../src/core/orchestrator/auto-gate.js";
import { autoGateInputFromPayload } from "../../../src/cli/commands/orchestrate.js";

const SRC_ROOT = "src";

function input(overrides: Partial<AutoGateInput> = {}): AutoGateInput {
  return {
    gateId: "route-proposal",
    critical: false,
    options: [
      { id: "A", recommended: false, defaultIfAuto: false },
      { id: "B", recommended: false, defaultIfAuto: false }
    ],
    mode: "auto",
    votes: [
      { member: "m1", optionId: "A", confidence: 0.8 },
      { member: "m2", optionId: "A", confidence: 0.75 },
      { member: "m3", optionId: "B", confidence: 0.7 }
    ],
    quorum: { expected: 3, present: 3 },
    tieRung: false,
    ...overrides
  };
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(entryPath)));
    else if (entry.name.endsWith(".ts")) files.push(entryPath);
  }
  return files;
}

/** Every `tieRung` construction in a body of source, with the literal it was given. */
function tieRungConstructions(source: string): string[] {
  return [...source.matchAll(/tieRung\s*:\s*([A-Za-z0-9_.]+)/g)].map((match) => match[1]);
}

describe("FR-NODE-124 AC-1 — AutoGateInput declares exactly seven fields", () => {
  it("names the seven, and the type declaration is exhaustive in both directions", () => {
    // A missing key fails to compile; an extra key fails to compile. `npm run typecheck` is what
    // makes this assertion load-bearing, and the length check pins the number at seven.
    const fields: Record<keyof AutoGateInput, true> = {
      gateId: true,
      critical: true,
      options: true,
      mode: true,
      votes: true,
      quorum: true,
      tieRung: true
    };
    expect(Object.keys(fields).sort()).toEqual(["critical", "gateId", "mode", "options", "quorum", "tieRung", "votes"]);
    expect(Object.keys(fields)).toHaveLength(7);
  });

  it("constructs a fixture from the type declaration alone", () => {
    expect(Object.keys(input()).sort()).toEqual(["critical", "gateId", "mode", "options", "quorum", "tieRung", "votes"]);
  });
});

describe("FR-NODE-124 AC-2 — AutoGateAction is a closed five-value union", () => {
  it("declares exactly the five values", () => {
    expect([...AUTO_GATE_ACTIONS]).toEqual(["adopt-recommended", "adopt-default-if-auto", "adopt-majority", "escalate-critical", "add-two-and-revote"]);
    expect(AUTO_GATE_ACTIONS).toHaveLength(5);
  });

  it("is the array journal-schema.ts registers, by import and not by restatement", () => {
    // Identity, not deep equality: a restated literal in `journal-schema.ts` would satisfy `toEqual`
    // on the day it was written and drift silently afterwards, which is the failure this asserts away.
    expect(journalSchema.AUTO_GATE_ACTIONS).toBe(AUTO_GATE_ACTIONS);
  });

  it("only ever returns a member of it", () => {
    const results = [
      decideAutoGate(input()),
      decideAutoGate(input({ critical: true })),
      decideAutoGate(input({ options: [{ id: "A", recommended: true, defaultIfAuto: false }] })),
      decideAutoGate(input({ options: [{ id: "A", recommended: false, defaultIfAuto: true }] })),
      decideAutoGate(input({ votes: [] }))
    ];
    for (const result of results) expect(AUTO_GATE_ACTIONS).toContain(result.action);
  });
});

describe("FR-NODE-124 AC-3 — a recommended option adopts immediately with no committee", () => {
  it("returns adopt-recommended with a member count of zero", () => {
    const result = decideAutoGate(
      input({
        options: [
          { id: "A", recommended: true, defaultIfAuto: false },
          { id: "B", recommended: false, defaultIfAuto: false }
        ]
      })
    );

    expect(result.action).toBe("adopt-recommended");
    expect(result.memberCount).toBe(0);
    expect(result.rule).toBe("recommended-fastpath");
  });
});

describe("FR-NODE-124 AC-4 — precedence is recommended > default_if_auto > committee", () => {
  it("adopts the recommended option when both markers are present", () => {
    const result = decideAutoGate(
      input({
        options: [
          { id: "A", recommended: true, defaultIfAuto: false },
          { id: "B", recommended: false, defaultIfAuto: true }
        ]
      })
    );
    expect(result.action).toBe("adopt-recommended");
  });

  it("adopts the default-if-auto option when only that marker is present", () => {
    const result = decideAutoGate(
      input({
        options: [
          { id: "A", recommended: false, defaultIfAuto: true },
          { id: "B", recommended: false, defaultIfAuto: false }
        ]
      })
    );

    expect(result.action).toBe("adopt-default-if-auto");
    expect(result.memberCount).toBe(0);
    expect(result.rule).toBe("default-if-auto");
  });

  it("decides by committee when neither marker is present", () => {
    const result = decideAutoGate(input());
    expect(result.action).toBe("adopt-majority");
    expect(result.memberCount).toBe(3);
  });
});

describe("FR-NODE-124 AC-5 — simple majority of three, or of five under auto-max", () => {
  it("adopts a 2-1 under auto with a member count of three", () => {
    const result = decideAutoGate(input());
    expect(result.action).toBe("adopt-majority");
    expect(result.memberCount).toBe(3);
    expect(result.rule).toBe("majority");
  });

  it("adopts a 3-2 under auto-max with a member count of five", () => {
    const result = decideAutoGate(
      input({
        mode: "auto-max",
        quorum: { expected: 5, present: 5 },
        votes: [
          { member: "m1", optionId: "A", confidence: 0.8 },
          { member: "m2", optionId: "A", confidence: 0.8 },
          { member: "m3", optionId: "A", confidence: 0.8 },
          { member: "m4", optionId: "B", confidence: 0.7 },
          { member: "m5", optionId: "B", confidence: 0.7 }
        ]
      })
    );

    expect(result.action).toBe("adopt-majority");
    expect(result.memberCount).toBe(5);
    expect(result.rule).toBe("majority");
  });
});

describe("FR-NODE-124 AC-6 — with no tie rung, a tie and a degraded quorum both halt", () => {
  it("escalates a three-way split rather than re-voting", () => {
    const result = decideAutoGate(
      input({
        options: [
          { id: "A", recommended: false, defaultIfAuto: false },
          { id: "B", recommended: false, defaultIfAuto: false },
          { id: "C", recommended: false, defaultIfAuto: false }
        ],
        votes: [
          { member: "m1", optionId: "A", confidence: 0.8 },
          { member: "m2", optionId: "B", confidence: 0.8 },
          { member: "m3", optionId: "C", confidence: 0.8 }
        ]
      })
    );

    expect(result.action).toBe("escalate-critical");
    expect(result.action).not.toBe("add-two-and-revote");
  });

  it("escalates an even split rather than settling by one member's ranking", () => {
    const result = decideAutoGate(
      input({
        quorum: { expected: 4, present: 4 },
        votes: [
          { member: "m1", optionId: "A", confidence: 0.9 },
          { member: "m2", optionId: "A", confidence: 0.9 },
          { member: "m3", optionId: "B", confidence: 0.5 },
          { member: "m4", optionId: "B", confidence: 0.5 }
        ]
      })
    );
    expect(result.action).toBe("escalate-critical");
  });

  it("escalates a quorum whose present count is below its expected count", () => {
    const result = decideAutoGate(
      input({
        quorum: { expected: 3, present: 2 },
        votes: [
          { member: "m1", optionId: "A", confidence: 0.8 },
          { member: "m2", optionId: "A", confidence: 0.8 }
        ]
      })
    );

    expect(result.action).toBe("escalate-critical");
    expect(result.reason).toContain("quorum");
  });
});

describe("FR-NODE-124 AC-7 — a critical gate halts regardless of every bypass", () => {
  it("escalates even with a recommended option and a majority", () => {
    const result = decideAutoGate(
      input({
        critical: true,
        options: [
          { id: "A", recommended: true, defaultIfAuto: true },
          { id: "B", recommended: false, defaultIfAuto: false }
        ]
      })
    );

    expect(result.action).toBe("escalate-critical");
    expect(result.memberCount).toBe(0);
  });
});

describe("FR-NODE-124 AC-8 — the function judges no motivation for a recommendation", () => {
  it("produces identical results for a speed-motivated and a completeness-motivated recommendation", () => {
    const speed = decideAutoGate(input({ gateId: "route-proposal", options: [{ id: "fast", recommended: true, defaultIfAuto: false }] }));
    const completeness = decideAutoGate(input({ gateId: "route-proposal", options: [{ id: "thorough", recommended: true, defaultIfAuto: false }] }));

    expect({ ...speed, reason: "" }).toEqual({ ...completeness, reason: "" });
  });

  it("declares no field in which a motivation could be expressed", () => {
    const optionFields: Record<keyof AutoGateInput["options"][number], true> = { id: true, recommended: true, defaultIfAuto: true };
    expect(Object.keys(optionFields).sort()).toEqual(["defaultIfAuto", "id", "recommended"]);
  });
});

describe("FR-NODE-124 AC-9 — every shipped construction passes tieRung: false", () => {
  it("passes false at every call site in the shipped source", async () => {
    const files = await collectSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const literals: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (file.endsWith(`orchestrator${path.sep}auto-gate.ts`)) continue;
      literals.push(...tieRungConstructions(source));
    }

    // A scan that finds nothing is a broken scan, not a clean result: `[].every(...)` is `true`, and
    // this assertion shipped in that shape over a call site that constructed no `tieRung` at all.
    // The set form cannot be satisfied by an empty scan — `[]` is not `["false"]`.
    expect(literals.length).toBeGreaterThan(0);
    expect([...new Set(literals)]).toEqual(["false"]);
  });

  it("constructs it at the one call site that reaches the kernel, not merely somewhere in src", async () => {
    // Pinning the file keeps the scan honest the other way round: an unrelated module growing a
    // `tieRung: false` would re-satisfy the corpus assertion while the CLI went back to casting.
    const source = await readFile(path.join("src", "cli", "commands", "orchestrate.ts"), "utf8");
    expect(tieRungConstructions(source)).toEqual(["false"]);
  });

  it("would find a true construction if one existed, so the scan is not vacuous", () => {
    expect(tieRungConstructions("decideAutoGate({ gateId: 'g', tieRung: true })")).toEqual(["true"]);
    expect(tieRungConstructions("decideAutoGate({ gateId: 'g', tieRung: false })")).toEqual(["false"]);
  });

  it("declares the parameter as a boolean the caller must supply", () => {
    expect(input().tieRung).toBe(false);
  });
});

describe("FR-NODE-124 AC-9 — the CLI payload cannot smuggle a tie rung past the construction", () => {
  function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      gateId: "route-proposal",
      critical: false,
      options: [{ id: "A", recommended: false, defaultIfAuto: false }],
      mode: "auto",
      votes: [{ member: "m1", optionId: "A", confidence: 0.8 }],
      quorum: { expected: 3, present: 3 },
      ...overrides
    };
  }

  it("constructs false from a payload that says nothing about the rung", () => {
    expect(autoGateInputFromPayload(payload()).tieRung).toBe(false);
  });

  it("accepts an explicit false, which agrees with the shipped construction", () => {
    expect(autoGateInputFromPayload(payload({ tieRung: false })).tieRung).toBe(false);
  });

  it("refuses a payload that asks for the rung rather than honouring or silently dropping it", () => {
    expect(() => autoGateInputFromPayload(payload({ tieRung: true }))).toThrow(/tie rung/i);
  });

  it("refuses any non-false tieRung, so a truthy string cannot pass either", () => {
    expect(() => autoGateInputFromPayload(payload({ tieRung: "yes" }))).toThrow(/tie rung/i);
  });

  it("still refuses a gate id outside the closed vocabulary", () => {
    expect(() => autoGateInputFromPayload(payload({ gateId: "not-a-gate" }))).toThrow(/vocabulary/);
  });

  it("refuses a payload whose critical flag is absent, rather than defaulting the halt away", () => {
    const { critical, ...withoutCritical } = payload();
    expect(critical).toBe(false);
    expect(() => autoGateInputFromPayload(withoutCritical)).toThrow(/critical/);
  });

  it("produces an input the kernel accepts, with all seven fields", () => {
    const built = autoGateInputFromPayload(payload());
    expect(Object.keys(built).sort()).toEqual(["critical", "gateId", "mode", "options", "quorum", "tieRung", "votes"]);
    expect(AUTO_GATE_ACTIONS).toContain(decideAutoGate(built).action);
  });

  it("refuses through the registered verb, so the construction is on the path the kernel reaches", async () => {
    // The source scan above pins the text; only this pins the wiring. A call site reverted to
    // `decideAutoGate(input as never)` leaves `autoGateInputFromPayload` in the file, so the scan
    // stays green while the payload flows to the kernel unvalidated — which is the shipped defect.
    const decide = async (body: Record<string, unknown>): Promise<{ exit: number; payload: Record<string, unknown> }> => {
      const stdout = new PassThrough();
      const io = { stdout: stdout as unknown as NodeJS.WriteStream, stderr: new PassThrough() as unknown as NodeJS.WriteStream };
      const exit = await main(["orchestrate", "auto-gate", "decide", "--json", "--payload", JSON.stringify(body)], io);
      return { exit, payload: JSON.parse(stdout.read()?.toString() ?? "{}") as Record<string, unknown> };
    };

    const refused = await decide(payload({ tieRung: true }));
    expect(refused.exit).toBe(1);
    expect(refused.payload.ok).toBe(false);
    expect(refused.payload.error).toMatch(/tie rung/i);

    const accepted = await decide(payload());
    expect(accepted.exit).toBe(0);
    expect((accepted.payload.decision as { action: string }).action).toBe("adopt-majority");
  });
});
