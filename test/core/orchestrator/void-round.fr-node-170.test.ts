import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VIOLATION_RULES } from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, type Json } from "./waves-fixtures.js";

// @req FR-NODE-170 — a void round is recordable, and a mismatch nobody declared is still refused.
//
// `evaluateRound` short-circuits on `rows.length !== frozenDenominator` and returns `invalid`.
// Recording that honestly means writing the mismatch into the journal — which `denominator-mismatch`
// refuses at error severity, so the only honest record of a void round was unwritable.

const COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
];

const CODE = "denominator-mismatch";

function line(verification: Record<string, unknown>): Json {
  return {
    ts: "2026-08-02T00:00:00Z",
    schema_version: "1.4.0",
    run_id: "run-a",
    engine: "kiwi-orchestrator",
    writer: "speckiwi-orchestrate/test",
    wave: "wave-1",
    order: 1,
    target: "wave-1",
    status: "in_progress",
    summary: "round",
    phase: "wave-verify",
    verb: "post-merge-verify",
    round: 1,
    verification
  } as unknown as Json;
}

/** Two rows enumerated against a frozen denominator of three: a mismatch, by construction. */
function mismatched(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: "in-progress",
    rounds: 1,
    cap: 5,
    residual: [],
    axis_b: { open: { critical: 0, high: 0, medium: 0, low: 0 } },
    axis_a: { checked: 2 },
    frozen_denominator: { round: 1, req_ac: 3 },
    ...extra
  };
}

async function codes(verification: Record<string, unknown>): Promise<string[]> {
  const root = await journalRoot([line(verification)]);
  const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
  return validateWavesJournal(view).map((entry) => entry.code);
}

function section23(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((entry) => entry.startsWith("### 2.3"));
  if (start < 0) throw new Error('no "### 2.3" heading');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((entry) => entry.startsWith("### ") || entry.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).filter((entry) => entry.startsWith("- "));
}

describe("FR-NODE-170 AC-1 — the declaration is a §2.3 bullet, claimed by the rule that reads it", () => {
  it("appears exactly once in every copy and resolves the rule's anchor", async () => {
    expect(COPIES).toHaveLength(4);
    const rule = VIOLATION_RULES.find((entry) => entry.code === CODE);
    expect(rule, "denominator-mismatch must be a VIOLATION_RULES row").toBeDefined();
    const anchors = [...(rule?.sourceBullets ?? [])];
    const voidAnchor = anchors.find((anchor) => anchor.includes("invalid_round"));
    expect(voidAnchor, "the rule must claim the bullet it is now drawn from").toBeDefined();

    for (const copy of COPIES) {
      const bullets = section23(await readFile(path.join(process.cwd(), copy), "utf8"));
      expect(bullets.filter((bullet) => bullet.includes(voidAnchor as string)), copy).toHaveLength(1);
    }
  });
});

describe("FR-NODE-170 AC-2 / AC-3 — the rule is narrowed, not disabled", () => {
  it("still refuses an UNDECLARED mismatch", async () => {
    expect(await codes(mismatched())).toContain(CODE);
  });

  it("does not refuse a mismatch the line declares void", async () => {
    expect(await codes(mismatched({ invalid_round: true }))).not.toContain(CODE);
  });

  it("ignores a falsy declaration, so the key is a claim and not a presence check", async () => {
    expect(await codes(mismatched({ invalid_round: false }))).toContain(CODE);
  });
});

describe("FR-NODE-170 AC-4 — the declaration exempts this rule only", () => {
  it("still refuses a declared-void line that violates a different rule", async () => {
    const codesFor = await codes(
      mismatched({
        invalid_round: true,
        verdict: "pass",
        // `truncated-residual`: terminal, open counts one HIGH, residual enumerates none.
        axis_b: { open: { critical: 0, high: 1, medium: 0, low: 0 } },
        residual: []
      })
    );
    expect(codesFor, "the exemption must not spread to other rules").toContain("truncated-residual");
    expect(codesFor).not.toContain(CODE);
  });
});
