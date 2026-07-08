import { copyFile, mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";
// FR-NODE-032: net-new MultiFileCommit four-phase engine + durable merge-journal.
// These symbols are introduced by the green task (T-PH003-32) and do not exist yet,
// so this suite is expected to be red until the implementation lands.
import {
  MultiFileCommit,
  readMergeJournal,
  recoverMerge,
  type MergeCommitFile
} from "../../../src/core/patch/merge-journal.js";
import { assertFreshSnapshot } from "../../../src/core/patch/apply-patch.js";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-mfc-fr-node-032-"));
}

async function seedFile(root: string, relativePath: string, contents: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

async function buildCommitFile(filePath: string, replacement: string): Promise<MergeCommitFile> {
  const file = await readUtf8File(filePath);
  const plan = createPatchPlan(file, [
    { type: "replaceLine", line: 1, original: file.lines[0], replacement }
  ]);
  return { plan };
}

describe("FR-NODE-032 MultiFileCommit four-phase engine with durable merge-journal", () => {
  // AC-1: render all files, stale-check, write tmp, then rename as final phase.
  it("FR-NODE-032 AC-1: commits a step file and a body file atomically via four phases", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\nbody\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\ncontent\n");

    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);

    const phases: string[] = [];
    const result = await commit.commit({ onPhase: (phase: string) => phases.push(phase) });

    expect(result.committed).toBe(true);
    expect(phases).toEqual(["render", "stale-check", "write-tmp", "rename"]);
    expect(phases.indexOf("rename")).toBe(phases.length - 1);
    expect(await readFile(stepPath, "utf8")).toContain("# step committed");
    expect(await readFile(bodyPath, "utf8")).toContain("# body committed");
    // No tmp leftovers after a clean commit.
    const leftovers = (await readdir(root)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  // AC-2: durable merge-journal records renames, sha256, and backups before rename phase.
  it("FR-NODE-032 AC-2: writes a durable journal of renames, sha256 hashes, and backups before renaming", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    let journalAtRenameStart: Awaited<ReturnType<typeof readMergeJournal>> | null = null;
    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);
    await commit.commit({
      onPhase: async (phase: string) => {
        if (phase === "rename") {
          journalAtRenameStart = await readMergeJournal(root);
        }
      }
    });

    expect(journalAtRenameStart).not.toBeNull();
    const journal = journalAtRenameStart!;
    expect(journal.renames.length).toBe(2);
    for (const entry of journal.renames) {
      expect(typeof entry.from).toBe("string");
      expect(typeof entry.to).toBe("string");
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof entry.backup).toBe("string");
    }
  });

  // AC-3: an interrupted merge is detected as half-applied by the next merge and rolled forward or back.
  it("FR-NODE-032 AC-3: the next merge detects a half-applied interrupted merge and recovers it", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);

    // Interrupt after the first rename in the final phase (half-applied state).
    let renamesDone = 0;
    await expect(
      commit.commit({
        onRename: () => {
          renamesDone += 1;
          if (renamesDone === 1) {
            throw new Error("simulated crash mid-rename");
          }
        }
      })
    ).rejects.toThrow(/crash/i);

    // A journal must remain on disk describing the half-applied merge.
    const stranded = await readMergeJournal(root);
    expect(stranded).not.toBeNull();
    expect(stranded!.status).toBe("half-applied");

    // The next merge detects and recovers the interrupted merge (forward or back).
    const recovery = await recoverMerge(root);
    expect(recovery.recovered).toBe(true);
    expect(["rolled-forward", "rolled-back"]).toContain(recovery.outcome);

    const step = await readFile(stepPath, "utf8");
    const body = await readFile(bodyPath, "utf8");
    if (recovery.outcome === "rolled-forward") {
      expect(step).toContain("# step committed");
      expect(body).toContain("# body committed");
    } else {
      expect(step).toContain("# step original");
      expect(body).toContain("# body original");
    }
    // Journal is cleared once recovery completes.
    expect(await readMergeJournal(root)).toBeNull();
  });

  // AC-3 (roll-back): when completing the interrupted merge fails with a real (non-ENOENT)
  // error, recovery must roll the already-applied renames BACK to their pre-merge state from
  // the backups rather than silently swallowing the failure and discarding the journal/backups
  // (which would leave the body partially applied and unrecoverable).
  it("FR-NODE-032 AC-3: a real rename failure during recovery rolls the merge back to pre-merge state", async () => {
    const root = await makeWorkspace();
    // Pre-merge ("original") contents. step.md was already renamed forward before the crash;
    // body.md still holds its original content with the new content staged in a tmp file.
    const stepPath = await seedFile(root, "step.md", "# step committed\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    // Backups captured before the crash: each holds the pre-merge content of its target.
    const stepBackup = path.join(root, `.speckiwi-${randomUUID()}.bak`);
    const bodyBackup = path.join(root, `.speckiwi-${randomUUID()}.bak`);
    await writeFile(stepBackup, "# step original\n", "utf8");
    await copyFile(bodyPath, bodyBackup);

    // The outstanding body rename: tmp holds the new committed content, target = body.md.
    const bodyTmp = path.join(root, `.speckiwi-${randomUUID()}.tmp`);
    await writeFile(bodyTmp, "# body committed\n", "utf8");

    const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

    // A half-applied journal: step rename already applied (tmp gone), body rename outstanding.
    const journal = {
      status: "half-applied" as const,
      renames: [
        {
          from: path.join(root, `.speckiwi-${randomUUID()}.tmp`), // already-renamed → ENOENT on retry
          to: stepPath,
          sha256: sha256("# step committed\n"),
          backup: stepBackup,
          applied: true
        },
        {
          from: bodyTmp,
          to: bodyPath,
          sha256: sha256("# body committed\n"),
          backup: bodyBackup,
          applied: false
        }
      ]
    };
    await writeFile(path.join(root, ".speckiwi-merge-journal.json"), JSON.stringify(journal), "utf8");

    // Force the outstanding body rename to fail with a REAL error (EPERM, not ENOENT) while
    // keeping body.md a regular, restorable file: hold an open handle on the destination so
    // the OS refuses the rename. This faithfully models a lock/permission crash mid-recovery.
    const lock = await open(bodyPath, "r");
    let recovery: Awaited<ReturnType<typeof recoverMerge>>;
    try {
      recovery = await recoverMerge(root);
    } finally {
      await lock.close();
    }

    // The merge is rolled BACK rather than reported as a forward success.
    expect(recovery.recovered).toBe(true);
    expect(recovery.outcome).toBe("rolled-back");

    // The already-applied step file is restored to its pre-merge ("original") content.
    expect(await readFile(stepPath, "utf8")).toContain("# step original");
    // The body file remains at its pre-merge content (the failed rename never landed).
    expect(await readFile(bodyPath, "utf8")).toContain("# body original");
  });

  // AC-3/AC-4 (terminal roll-back): once a real rename failure triggers a roll-back, the roll-back
  // must be terminal — a retried recovery (after the transient lock clears) must NEVER re-apply the
  // outstanding rename forward. Re-forwarding even one file would leave the merge partially applied
  // (one target rolled back, the other committed), violating all-or-nothing.
  it("FR-NODE-032 AC-3: a retried recovery after a roll-back never re-applies the merge forward (terminal roll-back)", async () => {
    const root = await makeWorkspace();
    // step.md was already renamed forward before the crash; body.md still holds its original content.
    const stepPath = await seedFile(root, "step.md", "# step committed\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    const stepBackup = path.join(root, `.speckiwi-${randomUUID()}.bak`);
    const bodyBackup = path.join(root, `.speckiwi-${randomUUID()}.bak`);
    await writeFile(stepBackup, "# step original\n", "utf8");
    await copyFile(bodyPath, bodyBackup);

    // The outstanding body rename: tmp holds the new committed content, target = body.md.
    const bodyTmp = path.join(root, `.speckiwi-${randomUUID()}.tmp`);
    await writeFile(bodyTmp, "# body committed\n", "utf8");

    const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

    const journal = {
      status: "half-applied" as const,
      renames: [
        {
          from: path.join(root, `.speckiwi-${randomUUID()}.tmp`), // already-renamed → ENOENT on retry
          to: stepPath,
          sha256: sha256("# step committed\n"),
          backup: stepBackup,
          applied: true
        },
        {
          from: bodyTmp,
          to: bodyPath,
          sha256: sha256("# body committed\n"),
          backup: bodyBackup,
          applied: false
        }
      ]
    };
    await writeFile(path.join(root, ".speckiwi-merge-journal.json"), JSON.stringify(journal), "utf8");

    // First recovery: the outstanding body rename fails with a REAL error (open handle → EPERM),
    // forcing a roll-back to the pre-merge state.
    const lock = await open(bodyPath, "r");
    let firstRecovery: Awaited<ReturnType<typeof recoverMerge>>;
    try {
      firstRecovery = await recoverMerge(root);
    } finally {
      await lock.close();
    }
    expect(firstRecovery.recovered).toBe(true);
    expect(firstRecovery.outcome).toBe("rolled-back");

    // Now the lock is released. A retried recovery MUST NOT re-apply the body rename forward.
    // (In a non-terminal roll-back the journal+tmp survive, so the retry would succeed at the
    // rename it failed before, producing a partial application.)
    const secondRecovery = await recoverMerge(root);

    // The workspace stays fully at its pre-merge state: NO partial forward application.
    expect(await readFile(stepPath, "utf8")).toContain("# step original");
    expect(await readFile(bodyPath, "utf8")).toContain("# body original");
    // The retried recovery did not roll anything forward.
    expect(secondRecovery.outcome).not.toBe("rolled-forward");
  });

  // AC-3/AC-4 (interrupted roll-back resumes as roll-back): a journal left with the durable
  // "rolled-back" marker (e.g. a roll-back that crashed before clearing the journal) must be
  // resumed as a roll-back by the next recovery — never re-applied forward.
  it("FR-NODE-032 AC-3: a journal marked rolled-back resumes as a roll-back, never forward", async () => {
    const root = await makeWorkspace();
    // step.md was already renamed forward before the crash; body.md still holds its original content.
    const stepPath = await seedFile(root, "step.md", "# step committed\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    const stepBackup = path.join(root, `.speckiwi-${randomUUID()}.bak`);
    const bodyBackup = path.join(root, `.speckiwi-${randomUUID()}.bak`);
    await writeFile(stepBackup, "# step original\n", "utf8");
    await copyFile(bodyPath, bodyBackup);

    // The outstanding body tmp still exists — a non-terminal recovery would rename it forward.
    const bodyTmp = path.join(root, `.speckiwi-${randomUUID()}.tmp`);
    await writeFile(bodyTmp, "# body committed\n", "utf8");

    const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

    // Journal carries the durable terminal marker but cleanup never completed (tmp/backup remain).
    const journal = {
      status: "rolled-back" as const,
      renames: [
        {
          from: path.join(root, `.speckiwi-${randomUUID()}.tmp`),
          to: stepPath,
          sha256: sha256("# step committed\n"),
          backup: stepBackup,
          applied: true
        },
        {
          from: bodyTmp,
          to: bodyPath,
          sha256: sha256("# body committed\n"),
          backup: bodyBackup,
          applied: false
        }
      ]
    };
    await writeFile(path.join(root, ".speckiwi-merge-journal.json"), JSON.stringify(journal), "utf8");

    const recovery = await recoverMerge(root);

    expect(recovery.recovered).toBe(true);
    expect(recovery.outcome).toBe("rolled-back");
    // Both targets are at their pre-merge content; the outstanding tmp was never rolled forward.
    expect(await readFile(stepPath, "utf8")).toContain("# step original");
    expect(await readFile(bodyPath, "utf8")).toContain("# body original");
    // Terminal: journal is cleared after the roll-back resumes to completion.
    expect(await readMergeJournal(root)).toBeNull();
  });

  // AC-4: journal write is atomic via tmp-rename; re-entrant resumption is idempotent; partial stale aborts all-or-nothing.
  it("FR-NODE-032 AC-4: resumption is idempotent and a partial stale condition aborts all-or-nothing", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    const stepCommit = await buildCommitFile(stepPath, "# step committed");
    const bodyCommit = await buildCommitFile(bodyPath, "# body committed");

    // Mutate one file after planning so its snapshot is stale → all-or-nothing abort.
    await writeFile(bodyPath, "# body concurrently changed\n", "utf8");

    const commit = new MultiFileCommit(root, [stepCommit, bodyCommit]);
    await expect(commit.commit({})).rejects.toMatchObject({ code: "STALE_PATCH" });

    // Neither file is changed (all-or-nothing).
    expect(await readFile(stepPath, "utf8")).toContain("# step original");
    expect(await readFile(bodyPath, "utf8")).toContain("# body concurrently changed");

    // Idempotent re-entrant recovery: recovering twice is safe and a no-op the second time.
    const first = await recoverMerge(root);
    const second = await recoverMerge(root);
    expect(second.recovered).toBe(false);
    expect(first).toBeDefined();
  });

  // AC-5: state.md is not included in the commit plan.
  it("FR-NODE-032 AC-5: state.md is never part of a MultiFileCommit plan", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const statePath = await seedFile(root, "state.md", "# state original\n");

    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(statePath, "# state committed")
    ]);

    await expect(commit.commit({})).rejects.toThrow(/state\.md/i);
    // state.md remains untouched because it is excluded from the commit plan.
    expect(await readFile(statePath, "utf8")).toContain("# state original");
    expect(commit.plannedPaths()).not.toContain(statePath);
  });

  // Cross-AC: the export-promoted assertFreshSnapshot from apply-patch is reused by the engine.
  it("FR-NODE-032: reuses the export-promoted assertFreshSnapshot", () => {
    expect(typeof assertFreshSnapshot).toBe("function");
  });
});
