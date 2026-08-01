import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../../src/core/orchestrator/canonical-json.js";

// The digest inputs of two different modules pass through this one function: `freeze.ts` seals a lock
// with `sha256(canonicalJson(unsealed))` and `resume-card.ts` computes `invariant_digest` the same
// way. It lived twice, once in each, which is the shape where a divergence surfaces as
// `run-invariant-drift` on a run where nothing drifted — the two digests would disagree while both
// sides believed they were comparing the same bytes. These cases pin the behaviour the two copies
// shared, so the extraction is checkable rather than asserted.

describe("canonicalJson — the shared digest serialisation", () => {
  it("sorts object keys, so key insertion order cannot move a digest", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it("keeps array order, because order is meaning in a declared-input list", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("emits no whitespace at any depth", () => {
    expect(canonicalJson({ outer: { inner: [1, { z: null, a: "s" }] } })).toBe('{"outer":{"inner":[1,{"a":"s","z":null}]}}');
  });

  it("sorts keys inside nested objects and inside array members", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("renders undefined as null rather than dropping it, so a member never vanishes from a digest", () => {
    // `JSON.stringify(undefined)` is undefined, not a string; both copies coalesced it to "null".
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson([undefined])).toBe("[null]");
  });

  it("renders null, strings, numbers and booleans as JSON does", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("a\"b")).toBe('"a\\"b"');
    expect(canonicalJson(12)).toBe("12");
    expect(canonicalJson(false)).toBe("false");
  });

  it("escapes keys, so a key containing a quote cannot forge a member boundary", () => {
    expect(canonicalJson({ 'a"b': 1 })).toBe('{"a\\"b":1}');
  });

  it("round-trips through JSON.parse, which freeze.ts relies on to normalise a lock body", () => {
    const value = { z: [1, 2], a: { c: true, b: null } };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });
});
