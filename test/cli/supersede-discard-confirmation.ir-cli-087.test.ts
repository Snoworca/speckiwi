import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-087 — the supersede command does not make the verified-regression decision for the caller.
//
// `update_status` refuses to discard a requirement that is `verified`, or whose Stability is `stable`
// or `frozen`, or that carries evidence at `implemented`, unless the caller says so
// (`confirmDiscardVerified`, FR-NODE-035). The guard exists to force a decision, not to prevent one.
//
// The CLI passed the literal `true` and declared no option, so the same supersede was guarded through
// MCP and unguarded through the CLI. The fixture these cases use has `| Stability | stable |`, which
// means the existing IR-CLI-059 suite has been driving the protected path all along and passing on
// the constant — and that file's own comment says the command "passes the core self-reference,
// reverse-duplicate, and verified-regression guards", which was true of two of the three.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const OLD_ID = "FR-ARCH-001";
const FLAG = "--confirm-discard-verified";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function readArch(root: string): Promise<string> {
  return readFile(path.join(root, ARCH_DOC), "utf8");
}

function statusOf(text: string, id: string): string | undefined {
  let start = text.indexOf(`### ${id} `);
  if (start < 0) start = text.indexOf(`### ~~${id} `);
  if (start < 0) return undefined;
  const next = text.indexOf("\n### ", start + 1);
  const block = text.slice(start, next >= 0 ? next : undefined);
  return /\|\s*Status\s*\|\s*([^|]+?)\s*\|/.exec(block)?.[1];
}

function supersedeArgs(root: string, extra: string[] = []): string[] {
  return [
    "--root",
    root,
    "supersede",
    "--old",
    OLD_ID,
    "--new-title",
    "Mutable requirement v2",
    "--new-statement",
    "SpecKiwi must mutate this superseding fixture requirement.",
    "--scope",
    "ARCH",
    "--type",
    "functional",
    "--apply",
    "--json",
    ...extra
  ];
}

/** Drops the fixture out of the protected set: `evolving` is neither `stable` nor `frozen`. */
async function makeUnprotected(root: string): Promise<void> {
  const file = path.join(root, ARCH_DOC);
  const body = await readFile(file, "utf8");
  const start = body.indexOf(`### ${OLD_ID} `);
  const next = body.indexOf("\n### ", start + 1);
  const block = body.slice(start, next >= 0 ? next : body.length);
  const relaxed = block.replace(/\|\s*Stability\s*\|\s*[^|]+\|/, "| Stability | evolving |");
  expect(relaxed, "the fixture declares no Stability row, so this case would prove nothing").not.toBe(block);
  await writeFile(file, body.slice(0, start) + relaxed + body.slice(next >= 0 ? next : body.length), "utf8");
}

describe("IR-CLI-087 — superseding a protected requirement asks the caller first", () => {
  it("AC-1: refuses without the flag and leaves the old requirement undiscarded", async () => {
    // This case first demanded the document be byte-for-byte unchanged, and it failed. Measured, the
    // successor block is already written when the discard is refused — and that is not a defect here:
    // FR-NODE-045 AC-3 designs the refusal to happen at "the hardened T2 discard" and promises only
    // that oldId is left as it was, while its AC-2 reserves byte-identity for the three ambiguity
    // guards that run before T1. So the criterion was narrowed to what the system already states
    // rather than the system bent to the criterion. What the partial write now MEANS is new, and is
    // recorded on the requirement: this refusal was unreachable from the CLI until the constant was
    // removed, so a caller who forgets the flag now gets a stranded successor.
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);
    // The premise of every case below: this fixture IS protected. Without this the refusal could be
    // coming from somewhere else entirely and AC-3 would be asserting against the same population.
    expect(before, "the fixture is not protected, so there is no guard to exercise").toContain("| Stability | stable |");

    const run = io();
    const code = await main(supersedeArgs(root), run);

    expect(code, "an unconfirmed discard of a protected requirement exited zero").not.toBe(0);
    const payload = `${drain(run.stdout)}${drain(run.stderr)}`;
    expect(payload).toContain("MUTATION_DENIED");
    expect(statusOf(await readArch(root), OLD_ID), "the refused supersede discarded it anyway").not.toBe("discarded");
  });

  it("AC-2: succeeds with the flag, discarding the old requirement and minting the successor", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);
    expect(statusOf(before, OLD_ID)).not.toBe("discarded");

    const run = io();
    const code = await main(supersedeArgs(root, [FLAG]), run);

    expect(code, `${drain(run.stdout)}${drain(run.stderr)}`).toBe(0);
    const after = await readArch(root);
    expect(statusOf(after, OLD_ID), "the confirmed discard did not take").toBe("discarded");
    expect(after.length, "no successor block was appended").toBeGreaterThan(before.length);
  });

  it("AC-3: an unprotected requirement supersedes without the flag, so the flag gates the guard and not the command", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await makeUnprotected(root);

    const run = io();
    const code = await main(supersedeArgs(root), run);

    expect(code, `${drain(run.stdout)}${drain(run.stderr)}`).toBe(0);
    expect(statusOf(await readArch(root), OLD_ID)).toBe("discarded");
  });

  it("AC-4: no CLI call site hands the core guard a literal true", async () => {
    // Behaviour alone cannot tell "the caller said yes" from "the command said yes on their behalf"
    // when the caller did pass the flag. This reads the source, which is where the defect lived.
    const source = await readFile(path.join(process.cwd(), "src", "cli", "commands", "mutations.ts"), "utf8");
    const offending = source
      .split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter((entry) => /confirmDiscardVerified\s*:\s*true\b/.test(entry.line));

    expect(offending, "a CLI call site decides the verified-regression override for the caller").toEqual([]);
    expect(source, "the CLI no longer mentions the guard at all, so this case has stopped watching anything").toContain(
      "confirmDiscardVerified"
    );
  });

  it("AC-5: the flag is discoverable from the command's own help", async () => {
    const run = io();
    await main(["supersede", "--help"], run);

    expect(`${drain(run.stdout)}${drain(run.stderr)}`, "a caller told MUTATION_DENIED cannot find the override").toContain(FLAG);
  });
});
