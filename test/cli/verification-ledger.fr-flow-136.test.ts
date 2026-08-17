import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-FLOW-136 — the skill-facing surface of the verification ledger.
//
// The ledger only saves tokens if an agent can reach it, and an agent reaches tools through the CLI.
// A core module with no command is a design the consuming skill cannot execute, so the two verbs the
// skill's instructions name are asserted here end to end rather than only at the module boundary.

const DOC_PATH = "docs/guide.md";

const DOC = [
  "# Guide",
  "",
  "Intro paragraph owned by the top heading.",
  "",
  "## Install",
  "",
  "Run the installer and wait for it to finish.",
  "",
  "## Usage",
  "",
  "Pass the flag to enable the feature.",
  ""
].join("\n");

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-vledger-cli-"));
  await write(root, DOC_PATH, DOC);
  return root;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

async function runJson(root: string, args: string[], expectedCode = 0): Promise<Record<string, unknown>> {
  const stdout = new PassThrough() as NodeJS.WriteStream;
  const stderr = new PassThrough() as NodeJS.WriteStream;
  const code = await main(["--root", root, ...args, "--json"], { stdout, stderr });
  expect(code, `exit code for: ${args.join(" ")}`).toBe(expectedCode);
  return JSON.parse(stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

describe("FR-FLOW-136 — `speckiwi workflow verification-ledger` plan and record", () => {
  it("records a verified section and then plans a round that sends only what changed", async () => {
    const root = await workspace();

    const recorded = await runJson(root, [
      "workflow",
      "verification-ledger",
      "record",
      "--doc",
      DOC_PATH,
      "--section",
      "Guide > Install",
      "--verifier",
      "prickly-reviewer#1",
      "--round",
      "1"
    ]);
    expect(recorded).toMatchObject({ ok: true, value: { written: true } });

    await write(root, DOC_PATH, DOC.replace("Pass the flag", "Pass the switch"));

    const planned = await runJson(root, ["workflow", "verification-ledger", "plan", "--doc", DOC_PATH, "--round", "2"]);
    // `Guide` was never recorded, so it is dirty on its own account — only the one section a
    // verifier actually read is skipped.
    expect(planned).toMatchObject({ sent: ["Guide", "Guide > Usage"], skipped: ["Guide > Install"] });

    const ledger = await readFile(path.join(root, "kiwi/verification-ledger.jsonl"), "utf8");
    expect(ledger.split("\n").filter((line) => line.trim().length > 0).length).toBe(1);
  });

  it("fails loudly rather than silently recording nothing when the section is not in the document", async () => {
    const root = await workspace();
    const result = await runJson(
      root,
      [
        "workflow",
        "verification-ledger",
        "record",
        "--doc",
        DOC_PATH,
        "--section",
        "Guide > Nowhere",
        "--verifier",
        "prickly-reviewer#1",
        "--round",
        "1"
      ],
      5
    );
    expect(result).toMatchObject({ ok: false, error: { code: "USAGE" } });
  });

  it("plans a first round with no ledger at all as fully dirty", async () => {
    const root = await workspace();
    const planned = await runJson(root, ["workflow", "verification-ledger", "plan", "--doc", DOC_PATH, "--round", "1"]);
    expect(planned.sent).toEqual(["Guide", "Guide > Install", "Guide > Usage"]);
    expect(planned.skipped).toEqual([]);
  });
});
