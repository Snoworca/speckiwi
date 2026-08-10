import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../../src/core/orchestrator/canonical-json.js";
import {
  REPLAY_ACTIONS,
  replayDeferredMutations,
  type DeferredMutation,
  type ReplayIndex,
  type ReplayPlan
} from "../../../src/core/orchestrator/replay.js";

// @req FR-NODE-182 — the host-root replay planner for a lane's deferred SRS mutations.
//
// The producer shipped first: `kiwi-coder --defer-srs-mutation` (FR-FLOW-121) records the four
// mandatory §0.12 mutations instead of calling them, because a lane agent's MCP write lands at the
// HOST root and would violate charter C1. This is the consumer that makes those records reach the
// host again.
//
// Two facts about the key are load-bearing and each is asserted by a case that fails when it is
// wrong rather than by a comment:
//
//   1. The tool name is NOT inside the hash. `kiwi-coder SKILL.md:569` already writes
//      `args_hash: sha1(canonicalJson(args))`. A planner that hashed `tool | args` would compute a
//      different key for every recorded entry, so every dedupe lookup would MISS and a resume after
//      `integrate-lane` would re-apply every lane's evidence and completed-work rows.
//   2. The dedupe key is nonetheless the PAIR `(tool, argsHash)`, because the hash alone is not
//      tool-unique: `update_status` and `add_completed_work` share an `{id, target}` args shape, so
//      keying on the hash alone would let one silently skip the other.
//
// Those two pull in opposite directions, which is exactly why both are pinned here.

const REPO_ROOT = process.cwd();
const MODULE_PATH = path.join(REPO_ROOT, "src", "core", "orchestrator", "replay.ts");

/** The hash as the requirement defines it, computed independently of the implementation. */
function expectedHash(args: unknown): string {
  return createHash("sha1").update(canonicalJson(args), "utf8").digest("hex");
}

function entry(tool: string, args: unknown): DeferredMutation {
  return { tool, args };
}

/** `add_trace_link`, `add_verification_evidence`, `update_status`, `add_completed_work`. */
const TRACE = "add_trace_link";
const STATUS = "update_status";
const COMPLETED = "add_completed_work";

/** The one args value whose canonical bytes and digest are pinned literally, below. */
const PINNED_ARGS = { target: "2.6.0-phase2-parallel-lanes", id: "FR-NODE-182" };

// ---------------------------------------------------------------------------------------------

describe("FR-NODE-182 AC-1 — declared surface a fixture author can build against", () => {
  it("takes exactly two arguments", () => {
    expect(replayDeferredMutations).toHaveLength(2);
  });

  it("annotates both parameters with a named type the module itself exports", () => {
    // A structural annotation written inline — `Array<{tool: string; args: unknown}>` — would satisfy
    // the compiler and defeat the criterion: a fixture author cannot import an unnameable type. This
    // is the same oracle FR-NODE-108's purity suite applies to the phase-1 six.
    const source = ts.createSourceFile(MODULE_PATH, readFileSync(MODULE_PATH, "utf8"), ts.ScriptTarget.Latest, true);

    const exported = new Set<string>();
    for (const match of readFileSync(MODULE_PATH, "utf8").matchAll(/export\s+(?:type|interface)\s+(\w+)/g)) {
      exported.add(match[1] as string);
    }

    const namedTypeOf = (node: ts.TypeNode | undefined): string | undefined => {
      if (node === undefined) return undefined;
      if (ts.isArrayTypeNode(node)) return namedTypeOf(node.elementType);
      if (ts.isTypeOperatorNode(node)) return namedTypeOf(node.type);
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const name = node.typeName.text;
        if (name === "Record" || name === "Map" || name === "Set") return undefined;
        if (name === "ReadonlyArray" && node.typeArguments?.[0]) return namedTypeOf(node.typeArguments[0]);
        return name;
      }
      return undefined;
    };

    let found = false;
    const offending: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "replayDeferredMutations") {
        found = true;
        for (const parameter of node.parameters) {
          const named = namedTypeOf(parameter.type);
          const label = ts.isIdentifier(parameter.name) ? parameter.name.text : "?";
          if (named === undefined) offending.push(`${label}: annotation is not a named type`);
          else if (!exported.has(named)) offending.push(`${label}: ${named} is not exported by the module`);
        }
        const returned = namedTypeOf(node.type);
        // Checked against the exported set as well as by name: identity alone would stay green if
        // `ReplayPlan` lost its `export`, which is precisely the property this criterion is about.
        if (returned !== "ReplayPlan") offending.push(`return: ${String(returned)} is not ReplayPlan`);
        else if (!exported.has(returned)) offending.push(`return: ${returned} is not exported by the module`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    expect(found, "replayDeferredMutations was not found in replay.ts").toBe(true);
    expect(exported.size, "no exported type names were found, so the check above is over an empty set").toBeGreaterThan(2);
    expect(offending, "a parameter or the return type cannot be named by a fixture author").toEqual([]);
  });

  it("builds a plan from values annotated with the exported types alone", () => {
    const queue: DeferredMutation[] = [entry(TRACE, { id: "FR-NODE-182", reference: "src/core/orchestrator/replay.ts" })];
    const index: ReplayIndex = {};
    const plan: ReplayPlan = replayDeferredMutations(queue, index);
    expect(plan.calls).toHaveLength(1);
    expect(plan.indexAfter[TRACE]).toEqual([plan.calls[0]?.argsHash]);
  });
});

describe("FR-NODE-182 AC-2 — argsHash is sha1(canonicalJson(args)) and the tool is outside it", () => {
  it("matches the formula the requirement states", () => {
    const args = { id: "FR-NODE-182", target: "2.6.0-phase2-parallel-lanes" };
    const [call] = replayDeferredMutations([entry(STATUS, args)], {}).calls;
    expect(call?.argsHash).toBe(expectedHash(args));
  });

  it("gives two different tools carrying identical args the SAME argsHash", () => {
    // This is the case that fails if the tool name is folded into the hashed input. It is not a
    // contrived pairing: `update_status` and `add_completed_work` genuinely share an `{id, target}`
    // args shape, which is why AC-3's pair key exists.
    const args = { id: "FR-NODE-182", target: "2.6.0-phase2-parallel-lanes" };
    const { calls } = replayDeferredMutations([entry(STATUS, args), entry(COMPLETED, args)], {});
    expect(calls[0]?.argsHash).toBe(calls[1]?.argsHash);
    expect(calls[0]?.argsHash).toBe(expectedHash(args));
  });

  it("is byte-compatible with the key kiwi-coder records, pinned as a literal", () => {
    // The two assertions above both route through this repository's own `canonicalJson`, so they
    // would stay green if its serialisation changed — and the queue is written by a SKILL, not by
    // this code. A literal digest is what actually pins the bytes both sides must agree on.
    // Derived from the shipped canonicalJson, whose output for these args is
    // {"id":"FR-NODE-182","target":"2.6.0-phase2-parallel-lanes"}.
    const [call] = replayDeferredMutations([entry(STATUS, PINNED_ARGS)], {}).calls;
    expect(canonicalJson(PINNED_ARGS)).toBe('{"id":"FR-NODE-182","target":"2.6.0-phase2-parallel-lanes"}');
    expect(call?.argsHash).toBe("89ad0b6a168c10bd76e4070ca66669e51d4d0ac0");
  });

  it("hashes args by value, so member order in the recorded object does not change the key", () => {
    const a = { id: "FR-NODE-182", target: "t" };
    const b = { target: "t", id: "FR-NODE-182" };
    const { calls } = replayDeferredMutations([entry(STATUS, a), entry(TRACE, b)], {});
    expect(calls[0]?.argsHash).toBe(calls[1]?.argsHash);
  });
});

describe("FR-NODE-182 AC-3 — the dedupe key is the pair, matched against the supplied index", () => {
  it("skips an entry whose (tool, argsHash) pair is already in the index", () => {
    const args = { id: "FR-NODE-182", target: "t" };
    const index: ReplayIndex = { [STATUS]: [expectedHash(args)] };
    const [call] = replayDeferredMutations([entry(STATUS, args)], index).calls;
    expect(call?.action).toBe("skip-duplicate");
  });

  it("applies an entry whose argsHash is in the index only under a DIFFERENT tool", () => {
    // The whole reason the key is a pair. Keying on the hash alone marks this `skip-duplicate`, and
    // a lane's `add_completed_work` would silently vanish because its `update_status` ran first.
    const args = { id: "FR-NODE-182", target: "t" };
    const index: ReplayIndex = { [STATUS]: [expectedHash(args)] };
    const [call] = replayDeferredMutations([entry(COMPLETED, args)], index).calls;
    expect(call?.action).toBe("apply");
  });

  it("applies an entry when the tool is present in the index but the hash is not", () => {
    const args = { id: "FR-NODE-182", target: "t" };
    const index: ReplayIndex = { [STATUS]: [expectedHash({ id: "FR-NODE-999", target: "t" })] };
    const [call] = replayDeferredMutations([entry(STATUS, args)], index).calls;
    expect(call?.action).toBe("apply");
  });

  it("draws every action from the exported vocabulary, which is exactly the two declared values", () => {
    // Pinned against the exported constant rather than a hand-copied pair: a copy asserts nothing
    // about `REPLAY_ACTIONS`, and the value is typed, so `toContain` over a literal pair cannot fail.
    // The equality below is what actually guards the vocabulary.
    expect([...REPLAY_ACTIONS]).toEqual(["apply", "skip-duplicate"]);
    const args = { id: "FR-NODE-182", target: "t" };
    const { calls } = replayDeferredMutations([entry(STATUS, args), entry(STATUS, args), entry(TRACE, args)], {});
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(REPLAY_ACTIONS as readonly string[]).toContain(call.action);
  });
});

describe("FR-NODE-182 AC-4 — duplicates inside the queue itself are deduped", () => {
  it("applies the first occurrence of a pair and skips every later one", () => {
    // Without this, a queue that recorded the same mutation twice — which is precisely what
    // kiwi-coder's own `args_hash` dedupe is there to make harmless — applies it twice at the host.
    const args = { id: "FR-NODE-182", target: "t" };
    const { calls } = replayDeferredMutations([entry(STATUS, args), entry(STATUS, args), entry(STATUS, args)], {});
    expect(calls.map((call) => call.action)).toEqual(["apply", "skip-duplicate", "skip-duplicate"]);
  });

  it("does not let a within-queue skip suppress a different tool carrying the same args", () => {
    const args = { id: "FR-NODE-182", target: "t" };
    const { calls } = replayDeferredMutations([entry(STATUS, args), entry(STATUS, args), entry(COMPLETED, args)], {});
    expect(calls.map((call) => call.action)).toEqual(["apply", "skip-duplicate", "apply"]);
  });
});

describe("FR-NODE-182 AC-5 — one call per entry, in order, and the resulting index", () => {
  it("emits one call per queue entry in input order, dropping nothing", () => {
    const queue: DeferredMutation[] = [
      entry(TRACE, { id: "A" }),
      entry(STATUS, { id: "A" }),
      entry(STATUS, { id: "A" }),
      entry(COMPLETED, { id: "B" })
    ];
    const { calls } = replayDeferredMutations(queue, {});
    expect(calls).toHaveLength(queue.length);
    expect(calls.map((call) => call.tool)).toEqual([TRACE, STATUS, STATUS, COMPLETED]);
    expect(calls.map((call) => call.args)).toEqual(queue.map((item) => item.args));
  });

  it("unions the incoming index with every applied hash, per tool, sorted and duplicate-free", () => {
    // The fixture is chosen so INSERTION order and SORTED order differ — the carried-in hash sorts
    // AFTER the newly applied one. With a pair that happens to arrive already ordered, `toEqual` of
    // a sorted array is satisfied by an implementation that never sorts at all. Measured: the first
    // version of this case used `{id:"OLD"}` and `{id:"A"}`, stayed green against an unsorted
    // implementation, and asserted nothing. The precondition below is what stops that recurring.
    const carriedIn = expectedHash({ id: "C" });
    const applied = expectedHash({ id: "ZZ" });
    expect(carriedIn > applied, "fixture is vacuous unless insertion order differs from sorted order").toBe(true);

    const index: ReplayIndex = { [STATUS]: [carriedIn] };
    const { indexAfter } = replayDeferredMutations([entry(STATUS, { id: "ZZ" }), entry(STATUS, { id: "ZZ" })], index);
    expect(indexAfter[STATUS]).toEqual([applied, carriedIn]);
  });

  it("emits a duplicate-free list even when the incoming index repeats a hash", () => {
    // "duplicate-free" was otherwise asserted only for duplicates arising within the queue. A
    // repeated hash in the index the caller loaded from disk is the other way one gets there.
    const hash = expectedHash({ id: "A" });
    const { indexAfter } = replayDeferredMutations([entry(STATUS, { id: "A" })], { [STATUS]: [hash, hash] });
    expect(indexAfter[STATUS]).toEqual([hash]);
  });

  it("carries a tool forward that the queue never mentions", () => {
    const untouched = expectedHash({ id: "OLD" });
    const { indexAfter } = replayDeferredMutations([entry(STATUS, { id: "A" })], { [TRACE]: [untouched] });
    expect(indexAfter[TRACE]).toEqual([untouched]);
  });

  it("adds no hash for an entry that was skipped", () => {
    const args = { id: "A" };
    const index: ReplayIndex = { [STATUS]: [expectedHash(args)] };
    const { indexAfter } = replayDeferredMutations([entry(STATUS, args)], index);
    expect(indexAfter[STATUS]).toEqual([expectedHash(args)]);
  });

  it("records a hash under every tool name, including ones that collide with Object.prototype", () => {
    // `({})["__proto__"] = [...]` sets the PROTOTYPE and creates no own property, so the hash would
    // vanish from `indexAfter` while the call was still reported `apply` — the plan would claim to
    // have applied something the persisted index does not remember, and the next run would apply it
    // again. That defeats the module's whole `idempotent-by-key` contract, silently.
    for (const tool of ["__proto__", "constructor", "toString"]) {
      const { calls, indexAfter } = replayDeferredMutations([entry(tool, { id: "A" })], {});
      expect(calls[0]?.action).toBe("apply");
      expect(Object.keys(indexAfter), `${tool} must be an own key of indexAfter`).toContain(tool);
      expect(indexAfter[tool]).toEqual([expectedHash({ id: "A" })]);
      expect(JSON.parse(JSON.stringify(indexAfter))[tool], `${tool} must survive serialisation`).toEqual([
        expectedHash({ id: "A" })
      ]);
    }
  });

  it("skips a repeat under such a tool name too, so the index it emits is honoured on re-entry", () => {
    // The other half: the plan must also READ back what it wrote. If `indexAfter` were emitted
    // correctly but lookups still went through the prototype chain, a resumed run would re-apply.
    const first = replayDeferredMutations([entry("__proto__", { id: "A" })], {});
    const second = replayDeferredMutations([entry("__proto__", { id: "A" })], first.indexAfter);
    expect(second.calls[0]?.action).toBe("skip-duplicate");
  });

  it("does not mutate the dedupeIndex argument, nor alias its arrays into the result", () => {
    // Aliasing matters as much as mutation: the caller persists `indexAfter` to replay-index.json
    // and may still hold the input. A shared array makes the two silently the same object.
    const index: ReplayIndex = { [STATUS]: [expectedHash({ id: "OLD" })] };
    const before = canonicalJson(index);
    const { indexAfter } = replayDeferredMutations([entry(STATUS, { id: "A" })], index);
    expect(canonicalJson(index)).toBe(before);
    expect(indexAfter[STATUS]).not.toBe(index[STATUS]);
  });
});

describe("FR-NODE-182 AC-6 — the planner is pure", () => {
  it("returns byte-identical output for identical input", () => {
    const queue: DeferredMutation[] = [entry(STATUS, { id: "A" }), entry(COMPLETED, { id: "A" })];
    const index: ReplayIndex = { [TRACE]: [expectedHash({ id: "OLD" })] };
    expect(canonicalJson(replayDeferredMutations(queue, index))).toBe(canonicalJson(replayDeferredMutations(queue, index)));
  });

  it("reaches node:crypto and canonical-json only, and canonical-json reaches nothing", () => {
    // A subset oracle, not a denylist: `node:child_process` is not on a list of banned specifiers,
    // it is simply not one of the two permitted. A denylist needs extending every time Node grows a
    // module. Two files are the WHOLE closure — canonical-json.js imports nothing — so this is an
    // exact closure check rather than a one-file approximation.
    const specifiers = (file: string): string[] => {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const found: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          if (node.importClause?.isTypeOnly !== true) found.push(node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
          found.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          found.push("dynamic-import");
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return found;
    };

    const permitted = ["node:crypto", "./canonical-json.js"];
    const reached = specifiers(MODULE_PATH);
    // A floor, so the loop below is not vacuously satisfied by an empty list — the sibling AC-1 case
    // carries the same guard for the same reason.
    expect(reached.length, "no value imports were read, so the subset check would be over nothing").toBeGreaterThan(0);
    for (const specifier of reached) expect(permitted).toContain(specifier);
    expect(specifiers(path.join(REPO_ROOT, "src", "core", "orchestrator", "canonical-json.ts"))).toEqual([]);
  });

  it("names no clock, environment or process global in its source", () => {
    const source = readFileSync(MODULE_PATH, "utf8");
    for (const forbidden of ["Date.now", "new Date", "Math.random", "process.env", "process.cwd"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
