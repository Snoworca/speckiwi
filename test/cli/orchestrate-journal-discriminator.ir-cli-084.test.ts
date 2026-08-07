import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { EVENT_KINDS, WAVES_EVENT_FIELDS } from "../../src/core/orchestrator/journal-schema.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "../core/orchestrator/resume-fixtures.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// @req IR-CLI-084 AC-6 — "use of the option is recorded in the run journal". A line is *recorded*
// only if the journal's own readers can interpret it, so the assertions below run the reader rather
// than looking for a substring.
//
// Two field names carry that: `event` is the intent/result discriminator (`waves-event.md` §2.2, read
// by `resume.ts`, `lane-state.ts`, `resume-card.ts`, `unit-gate.ts` and `waves-validate.ts`), and
// `strict_grounding` is the fact the criterion asks to be recorded, which must be a declared field —
// FR-NODE-129's parity harness compares document to schema, so a field absent from BOTH sides is
// symmetric and invisible to it. @req FR-NODE-140, FR-NODE-150, FR-NODE-129

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ORCHESTRATE_COMMAND = path.join(REPO_ROOT, "src", "cli", "commands", "orchestrate.ts");

/** The three skill variants plus the `.agents` mirror, as `waves-event-parity` reads them. */
const CONTRACT_COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
] as const;

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = io();
  const exit = await main([...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/**
 * Runs `orchestrate schedule plan --strict-grounding --run-id run-a` over a sidecar whose one
 * declared path is absent, which is what `--strict-grounding` refuses. The journal line is written
 * before the refusal, so the refusal is the expected exit and not a failure of the fixture.
 */
async function planUnderStrictGrounding(): Promise<{ root: string; exit: number }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-journal-discriminator-"));
  await write(
    root,
    "plan.sidecar.json",
    JSON.stringify({
      schema_version: "1.1.0",
      plan_contract: "1.2.0",
      tasks: [
        {
          id: "T1",
          type: "code",
          action: "implement T1",
          req_ids: ["FR-ARCH-001"],
          files: [{ path: "src/core/new-thing.ts" }],
          test_files: [],
          covers_ac: ["AC-1"],
          depends_on_task: []
        }
      ]
    })
  );
  await write(root, "existing.json", JSON.stringify(["src/core/lane-plan.ts"]));

  const result = await run([
    "--root", root, "orchestrate", "schedule", "plan",
    "--plan", "plan.sidecar.json",
    "--existing-paths", "existing.json",
    "--strict-grounding",
    "--run-id", "run-a"
  ]);
  return { root, exit: result.exit };
}

async function journalLines(root: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path.join(root, "kiwi", "waves.jsonl"), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("IR-CLI-084 AC-6 — the recorded line is one the journal's readers can interpret", () => {
  it("is read by `orchestrate resume` as an interrupted freeze-lane-plan", async () => {
    const { root, exit } = await planUnderStrictGrounding();
    expect(exit, "--strict-grounding refuses the absent path, after journalling").toBe(2);

    await write(root, "card.json", JSON.stringify(await pinResumeRunRoot(minimalCard(), root)));
    await write(root, "facts.json", JSON.stringify({ gitFacts: emptyGitFacts(), driftInputs: emptyDriftInputs() }));

    const resumed = await run([
      "--root", root, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json"
    ]);

    expect(resumed.exit, JSON.stringify(resumed.payload)).toBe(0);
    const next = (resumed.payload.resume as { nextAction: { verb: string | null; interrupted: boolean; recoveryClass: string | null } })
      .nextAction;

    // §4.3: the last line of a `(verb, wave, stage, lane)` key being an intent means that verb was
    // interrupted. A line whose discriminator is spelled anything other than `event` reads as a verb
    // that never started, and the run resumes past a freeze it never finished.
    expect(next.interrupted).toBe(true);
    expect(next.verb).toBe("freeze-lane-plan");
    expect(next.recoveryClass).toBe("idempotent-by-key");
  });

  it("writes the intent/result discriminator under the contract's own field name", async () => {
    const { root } = await planUnderStrictGrounding();
    const lines = await journalLines(root);

    const frozen = lines.find((line) => line.verb === "freeze-lane-plan");
    expect(frozen, JSON.stringify(lines)).toBeDefined();
    expect((frozen as Record<string, unknown>).event).toBe("intent");
    expect(EVENT_KINDS).toContain((frozen as Record<string, unknown>).event);
    // `kind` names a nested proof's type (`proof.kind`, `lane_disposition.kind`) and nothing at the
    // top level; a top-level `kind` is a field no reader consults.
    expect(Object.keys(frozen as Record<string, unknown>)).not.toContain("kind");
  });

  it("records the option's use in a field the contract declares", async () => {
    const { root } = await planUnderStrictGrounding();
    const lines = await journalLines(root);

    const frozen = lines.find((line) => line.verb === "freeze-lane-plan") as Record<string, unknown>;
    expect(frozen.strict_grounding).toBe(true);

    // Declared on both sides, which is what makes FR-NODE-129's parity harness able to see it: the
    // harness asserts set-equality, so a field on neither side is symmetric and passes silently.
    expect([...WAVES_EVENT_FIELDS.optional]).toContain("strict_grounding");
    for (const relativePath of CONTRACT_COPIES) {
      const text = await readFile(path.join(REPO_ROOT, relativePath), "utf8");
      expect(text, relativePath).toMatch(/^\|\s*`strict_grounding`\s*\|/m);
    }
  });
});

describe("IR-CLI-084 AC-6 — every journal payload the orchestrate command writes uses `event`", () => {
  it("spells no discriminator literal `kind`", async () => {
    const source = await readFile(ORCHESTRATE_COMMAND, "utf8");
    const matches = [...source.matchAll(/\b(kind|event): "(intent|result)"/g)];

    // Anti-vacuity: a probe that matches nothing would report a clean census over an empty set.
    expect(matches.length, "no journal payload literal was found, so the census is empty").toBeGreaterThan(0);
    expect([...new Set(matches.map((match) => match[1] as string))]).toEqual(["event"]);
  });
});
