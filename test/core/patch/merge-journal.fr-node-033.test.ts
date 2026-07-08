import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";
// FR-NODE-033 extends the FR-NODE-032 merge-journal so that each journal entry captures the
// requirement id alongside its sha256, marks operations as applied, and is appended durably
// before the corresponding rename runs. The symbols exercised below (the requirementId field on
// journal renames, the per-entry `applied` marker, and the resume-skipping commit) are introduced
// by the green task (T-PH003-34) and do not exist yet, so this suite is expected to be red.
import {
  MultiFileCommit,
  readMergeJournal,
  type MergeCommitFile
} from "../../../src/core/patch/merge-journal.js";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-mfc-fr-node-033-"));
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

function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("FR-NODE-033 merge-journal append-log with resume skip", () => {
  // AC-1: Each merge-journal entry records the renames, their sha256 hashes, and the captured
  // requirement id.
  it("FR-NODE-033 AC-1: records renames, sha256 hashes, and the captured requirement id", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    let journalAtRename: Awaited<ReturnType<typeof readMergeJournal>> | null = null;
    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);
    await commit.commit({
      requirementId: "FR-NODE-033",
      onPhase: async (phase: string) => {
        if (phase === "rename") {
          journalAtRename = await readMergeJournal(root);
        }
      }
    });

    expect(journalAtRename).not.toBeNull();
    const journal = journalAtRename!;
    // The captured requirement id is durably recorded on the journal.
    expect(journal.requirementId).toBe("FR-NODE-033");
    expect(journal.renames.length).toBe(2);
    for (const entry of journal.renames) {
      expect(typeof entry.from).toBe("string");
      expect(typeof entry.to).toBe("string");
      // sha256 of the final content for this rename.
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      // The requirement id is captured per entry as well.
      expect(entry.requirementId).toBe("FR-NODE-033");
    }
    // sha256 hashes correspond to the actual final file contents that get renamed in.
    const stepEntry = journal.renames.find((entry) => entry.to === stepPath);
    expect(stepEntry).toBeDefined();
    expect(stepEntry!.sha256).toBe(sha256Of(await readFile(stepPath, "utf8")));
  });

  // AC-2: A resuming merge reads the journal and skips operations already recorded as applied.
  it("FR-NODE-033 AC-2: a resuming merge skips operations already recorded as applied", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);

    // Interrupt after the first rename in the final phase: it is performed and durably marked
    // applied, but the merge crashes before the second rename runs (half-applied state).
    let renamesDone = 0;
    await expect(
      commit.commit({
        requirementId: "FR-NODE-033",
        onRename: () => {
          renamesDone += 1;
          if (renamesDone === 2) {
            throw new Error("simulated crash mid-rename");
          }
        }
      })
    ).rejects.toThrow(/crash/i);

    // The stranded journal marks the first rename as applied and the second as not-yet-applied.
    const stranded = await readMergeJournal(root);
    expect(stranded).not.toBeNull();
    const appliedCount = stranded!.renames.filter((entry) => entry.applied === true).length;
    expect(appliedCount).toBe(1);

    // The resuming merge only re-performs operations that are not yet recorded as applied.
    const replayed: string[] = [];
    const resume = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);
    const result = await resume.resume({
      requirementId: "FR-NODE-033",
      onRename: (to: string) => {
        replayed.push(to);
      }
    });

    expect(result.committed).toBe(true);
    // The already-applied rename is skipped; only the outstanding one is replayed.
    expect(replayed.length).toBe(1);
    // Both files end up in their committed state.
    expect(await readFile(stepPath, "utf8")).toContain("# step committed");
    expect(await readFile(bodyPath, "utf8")).toContain("# body committed");
    // The journal is cleared once the resume completes.
    expect(await readMergeJournal(root)).toBeNull();
  });

  // AC-3: Journal entries are appended durably before the corresponding rename is performed.
  it("FR-NODE-033 AC-3: each journal entry is appended durably before its rename runs", async () => {
    const root = await makeWorkspace();
    const stepPath = await seedFile(root, "step.md", "# step original\n");
    const bodyPath = await seedFile(root, "body.md", "# body original\n");

    const commit = new MultiFileCommit(root, [
      await buildCommitFile(stepPath, "# step committed"),
      await buildCommitFile(bodyPath, "# body committed")
    ]);

    // At the instant each rename runs, the on-disk journal must already durably contain an entry
    // for that exact target that is NOT yet marked applied, while every rename completed before it
    // must already be durably marked applied. This proves entries are appended (and their applied
    // state advanced) durably before each corresponding rename runs, in order.
    const observed: Array<{
      to: string;
      present: boolean;
      currentApplied: boolean | undefined;
      priorAppliedCount: number;
    }> = [];
    let renamesSeen = 0;
    await commit.commit({
      requirementId: "FR-NODE-033",
      onRename: async (to: string) => {
        const journal = await readMergeJournal(root);
        const entry = journal?.renames.find((candidate) => candidate.to === to) ?? null;
        const priorAppliedCount = (journal?.renames ?? []).filter((candidate) => candidate.applied === true).length;
        observed.push({
          to,
          present: entry !== null,
          currentApplied: entry?.applied,
          priorAppliedCount
        });
        renamesSeen += 1;
      }
    });

    // Two renames were observed, each with its journal entry already durable on disk.
    expect(observed.length).toBe(2);
    observed.forEach((record, index) => {
      // The entry for the rename about to run is present but not yet marked applied.
      expect(record.present).toBe(true);
      expect(record.currentApplied).not.toBe(true);
      // Every rename completed before this one is already durably marked applied.
      expect(record.priorAppliedCount).toBe(index);
    });
    expect(renamesSeen).toBe(2);
  });
});
