import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { computeInvariantDigest, resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";

// @req FR-NODE-180 — a resume verifies it is in the repository the run was pinned to.
//
// The card has carried `run_root: { git_toplevel, mcp_workspace_root }` since it was designed and
// the invariant digest covers it, but the pair appears nowhere else in the source: nothing ever
// compares it to the world. The digest proves the card did not change; it says nothing about which
// repository is reading it.

const execFileAsync = promisify(execFile);
const RUN_ID = "run-a";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): Record<string, unknown> {
  return JSON.parse(stream.read()?.toString() ?? "{}") as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

const BASE = { schema_version: "1.4.0", run_id: RUN_ID, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

const JOURNAL: Record<string, unknown>[] = [
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } }
];

function card(pinnedToplevel: string): ResumeCard {
  const frozen = {
    engine: "kiwi-orchestrator",
    work_root: "docs/research/demo/",
    journal: "kiwi/waves.jsonl",
    run_root: { git_toplevel: pinnedToplevel, mcp_workspace_root: pinnedToplevel },
    isolation_profile: "none-serial",
    proof_strength: "strong",
    base_branch: "main",
    integration_branch: `kiwi/orch/${RUN_ID}/integration`,
    design_lock: "design/00.design.lock.json@sha256:4ab0",
    waves_lock: "waves/waves.lock.json@sha256:c17e",
    lane_lock: { "wave-1": "waves/wave-1/lanes.lock.json@sha256:5b3a" }
  } as ResumeCard["frozen"];
  return {
    schema_version: "1.0.0",
    run_id: RUN_ID,
    run_contract: "docs/research/demo/00.run-contract.md@sha256:9f1c",
    position: { wave: 1, stage: 1, phase: "execute" },
    next_action: {
      verb: "execute-unit",
      args: { wave: 1, stage: 1, lane: "lane-1" },
      preconditions: ["P-DESIGN-FROZEN", "P-LANE-PLAN-FROZEN", "P-HANDOFF-VERIFIED", "P-WAVE-ISSUES-CLOSED", "P-PRIOR-STAGES-INTEGRATED"]
    },
    frozen,
    done: [{ key: "intake", proof: { kind: "digest", ref: "design/00.design.lock.json@sha256:4ab0" } }],
    open: [],
    blocked_on: null,
    invariant_digest: computeInvariantDigest(frozen),
    written_at: "2026-08-02T09:12:44.201Z"
  } as ResumeCard;
}

function facts(): string {
  const recorded = {
    sidecarDigest: "sha256:sidecar",
    registryDigest: "sha256:registry",
    existingPathsDigest: "sha256:paths",
    designItemMapDigest: "sha256:map",
    priorPostmortemDigests: [],
    laneCap: 8,
    codeRoots: ["src/**"],
    testRoots: ["test/**"]
  };
  return JSON.stringify({
    gitFacts: { branches: [], worktrees: [], heartbeats: [], integrationHead: "aaaa111", hostStatusPaths: [], integrationCommits: [] },
    driftInputs: {
      lockDigests: {
        design: "design/00.design.lock.json@sha256:4ab0",
        waves: "waves/waves.lock.json@sha256:c17e",
        lanes: "waves/wave-1/lanes.lock.json@sha256:5b3a",
        handoff: {},
        issues: "",
        postmortem: ""
      },
      recordedLaneInputs: recorded,
      recomputedLaneInputDigests: {
        sidecarDigest: recorded.sidecarDigest,
        registryDigest: recorded.registryDigest,
        existingPathsDigest: recorded.existingPathsDigest,
        designItemMapDigest: recorded.designItemMapDigest,
        priorPostmortemDigests: []
      },
      freshIntentDigests: {},
      handoffProseDigests: {}
    }
  });
}

/** A run root that is a real repository, so the observed side of the comparison is genuine. */
async function runRoot(options: { git: boolean } = { git: true }): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "resume-run-root-pin-")));
  if (options.git) await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await write(root, "kiwi/waves.jsonl", JOURNAL.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await write(root, "facts.json", facts());
  return root;
}

async function resume(root: string, pinnedToplevel: string): Promise<{ exit: number; payload: Record<string, unknown> }> {
  await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(card(pinnedToplevel), null, 2)}\n`);
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", RUN_ID, "--facts", "facts.json", "--json"], pipes);
  return { exit, payload: drain(pipes.stdout) };
}

describe("FR-NODE-180 — resume checks the repository it is resuming in", () => {
  it("AC-1 resumes when the card pins the repository it is running in", async () => {
    const root = await runRoot();

    const result = await resume(root, root);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.resume, "the baseline must succeed, or every refusal below is uninformative").toBeDefined();
  });

  it("AC-2 refuses when the card pins a different repository, naming both roots", async () => {
    const root = await runRoot();
    const elsewhere = await runRoot();

    const result = await resume(root, elsewhere);

    expect(result.exit).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    const violations = JSON.stringify(result.payload.violations);
    expect(violations, "the pinned root must be named").toContain(path.basename(elsewhere));
    expect(violations, "so must the one actually observed").toContain(path.basename(root));
  });

  it("AC-3 refuses a resume from a root in no repository", async () => {
    const root = await runRoot({ git: false });

    const result = await resume(root, root);

    expect(result.exit, "nothing contradicting the card is not the same as the card being confirmed").toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
  });

  it("AC-4 treats a differently-spelt path as the same root", async () => {
    const root = await runRoot();

    // Backslashes, a trailing separator and upper case — three spellings of one directory. A card
    // written on any of them must not refuse every later resume.
    const result = await resume(root, `${root.replace(/\//g, "\\").toUpperCase()}\\`);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
  });

  it("AC-5 refuses on the run root even when the drift inputs would have resumed cleanly", async () => {
    const root = await runRoot();
    const elsewhere = await runRoot();

    // The same fixture resumes with exit 0 when the pin is honest (AC-1), so the journal and the
    // drift inputs are clean here. Only the run root differs, and only the run root may decide it.
    const result = await resume(root, elsewhere);

    expect(result.payload.gate, "a clean run must not be refused for some other reason").toBe("run-invariant-drift");
    expect(JSON.stringify(result.payload.violations)).toContain("run-root-moved");
    expect(result.payload.resume, "a refused resume dispatches nothing").toBeUndefined();
    expect(result.payload.rung).toBeUndefined();
  });

  it("AC-5 lets card validation refuse first when the card is both invalid and pinned elsewhere", async () => {
    const root = await runRoot();
    const elsewhere = await runRoot();

    // Ordering is the assertion: an invalid card pinned elsewhere must report the invalidity. If the
    // run-root check ran first, this would come back as run-invariant-drift and the operator would
    // repair the wrong thing.
    const broken = { ...card(elsewhere), next_action: { verb: "totally-made-up", args: {}, preconditions: [] } };
    await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(broken, null, 2)}\n`);
    const pipes = io();
    const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", RUN_ID, "--facts", "facts.json", "--json"], pipes);
    const payload = drain(pipes.stdout);

    expect(exit).toBe(2);
    expect(payload.gate).toBe("resume-card-missing-or-invalid");
  });

  it("AC-7 refuses a card that carries no pin at all", async () => {
    const root = await runRoot();

    // Delete the pin and re-stamp the digest: the card is then entirely self-consistent, passes
    // validation, and — before this criterion — resumed with no repository check whatsoever. That is
    // the same forgery FR-NODE-178 was written against, one requirement later.
    const unpinned = card(root) as ResumeCard & { frozen: Record<string, unknown> };
    delete unpinned.frozen.run_root;
    unpinned.invariant_digest = computeInvariantDigest(unpinned.frozen as ResumeCard["frozen"]);
    await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(unpinned, null, 2)}\n`);
    const pipes = io();
    const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", RUN_ID, "--facts", "facts.json", "--json"], pipes);
    const payload = drain(pipes.stdout);

    expect(exit, JSON.stringify(payload)).toBe(2);
    expect(payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(payload.violations), "the refusal must say the pin is missing, not that it moved").toContain(
      "run-root-unpinned"
    );
  });

  it("AC-8 reports an operational error when git cannot be consulted, rather than a gate or a pass", async () => {
    // A `.git` file pointing at a gitdir that is not there: git can neither confirm nor deny the pin.
    // Refusing on a gate would tell the operator the run root moved when nothing moved, and resuming
    // would be the unchecked resume this requirement exists to prevent.
    const root = await runRoot({ git: false });
    await writeFile(path.join(root, ".git"), "gitdir: C:/no/such/gitdir\n", "utf8");
    await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(card(root), null, 2)}\n`);
    const pipes = io();
    const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", RUN_ID, "--facts", "facts.json", "--json"], pipes);
    const payload = drain(pipes.stdout);

    expect(exit, JSON.stringify(payload)).toBe(1);
    expect(payload.gate, "nothing was judged, so no gate may be claimed").toBeUndefined();
    expect(String(payload.error), "git's own words must reach the operator").toMatch(/git could not report a top level/i);
  });

  it("AC-6 measures the observed side rather than echoing the card", async () => {
    // Two runs differing only in what the card pins must not produce the same verdict; if the
    // observed side were read back off the card, both would pass.
    const root = await runRoot();
    const elsewhere = await runRoot();

    const honest = await resume(root, root);
    const moved = await resume(root, elsewhere);

    expect(honest.exit).toBe(0);
    expect(moved.exit).toBe(2);
  });
});
