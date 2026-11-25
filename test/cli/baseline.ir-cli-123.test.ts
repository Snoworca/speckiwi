import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-123 AC-1 AC-2 AC-3 AC-4 AC-5 — a baseline file, the previous --json output, removes the
// warnings that were already there; errors always stay, and the count of what it removed is reported.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const INDEX = path.join("docs", "spec", "00.index.md");

async function run(argv: string[]): Promise<{ exit: number; stdout: string }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(argv, pipes);
  return { exit, stdout: pipes.stdout.read()?.toString() ?? "" };
}

interface ValidateAnswer {
  errors: Array<{ code: string }>;
  warnings: Array<{ code: string; message: string }>;
  baseline?: { file: string; suppressed: number };
  error?: { code: string; message: string };
}

interface LinksAnswer {
  broken: Array<{ code: string; reference: string }>;
  brokenIndexLinks: Array<{ code: string; reference: string }>;
  baseline?: { file: string; suppressed: number };
  error?: { code: string };
}

async function edit(rootPath: string, file: string, from: string | RegExp, to: string): Promise<void> {
  const full = path.join(rootPath, file);
  const text = await readFile(full, "utf8");
  const next = text.replace(from, to);
  expect(next, `the fixture must take the edit of ${file}`).not.toBe(text);
  await writeFile(full, next, "utf8");
}

async function save(rootPath: string, argv: string[], name: string): Promise<string> {
  const file = path.join(rootPath, name);
  await writeFile(file, (await run(["--root", rootPath, ...argv, "--json"])).stdout, "utf8");
  return file;
}

/** valid-basic raises one warning (SRS-W015, a completed-work row for an open requirement) and no error. */
async function warned(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const answer = JSON.parse((await run(["--root", rootPath, "validate", "--json"])).stdout) as ValidateAnswer;
  expect(answer.warnings.length, "the fixture must raise a warning").toBeGreaterThan(0);
  expect(answer.errors).toEqual([]);
  return rootPath;
}

/** A second warning the baseline does not hold: an acceptance criterion past the length threshold (SRS-W083). */
const longCriterion = (rootPath: string) => edit(rootPath, SPEC, "- [ ] AC-1: The requirement can be listed.", `- [ ] AC-1: The requirement can be listed ${"and listed again ".repeat(300)}.`);

describe("IR-CLI-123 AC-1 — warnings the baseline holds do not fail --fail-on-warning", () => {
  it("IR-CLI-123 AC-1: the same warnings pass, also after their line moved; a new one fails and is the only one listed", async () => {
    const rootPath = await warned();
    const baseline = await save(rootPath, ["validate"], "baseline.json");
    expect((await run(["--root", rootPath, "validate", "--fail-on-warning", "--json"])).exit, "without a baseline it fails").not.toBe(0);

    const same = await run(["--root", rootPath, "validate", "--fail-on-warning", "--baseline", baseline, "--json"]);
    expect(same.exit).toBe(0);
    expect((JSON.parse(same.stdout) as ValidateAnswer).warnings).toEqual([]);

    await edit(rootPath, INDEX, /\n## /, "\n\n\n## ");
    expect((await run(["--root", rootPath, "validate", "--fail-on-warning", "--baseline", baseline, "--json"])).exit, "a moved line still matches").toBe(0);

    await longCriterion(rootPath);
    const added = await run(["--root", rootPath, "validate", "--fail-on-warning", "--baseline", baseline, "--json"]);
    expect(added.exit).not.toBe(0);
    expect((JSON.parse(added.stdout) as ValidateAnswer).warnings.map((warning) => warning.code)).toEqual(["SRS-W083"]);
  });
});

describe("IR-CLI-123 AC-2 — an error stays a failure even when the baseline holds it", () => {
  it("IR-CLI-123 AC-2: an error in the baseline is still listed and still fails", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await edit(rootPath, SPEC, "| Status | planned |", "| Status | not-a-status |");
    const baseline = await save(rootPath, ["validate"], "baseline.json");
    const before = JSON.parse(await readFile(baseline, "utf8")) as ValidateAnswer;
    expect(before.errors.length, "the fixture must raise an error").toBeGreaterThan(0);

    const rerun = await run(["--root", rootPath, "validate", "--baseline", baseline, "--json"]);
    expect(rerun.exit).not.toBe(0);
    expect((JSON.parse(rerun.stdout) as ValidateAnswer).errors.map((entry) => entry.code)).toEqual(before.errors.map((entry) => entry.code));
  });
});

describe("IR-CLI-123 AC-2 — a hand-edited baseline cannot hide an error", () => {
  // Verification round 1: a baseline whose warnings array lists an error matched it by key and passed.
  it("IR-CLI-123 AC-2: an error copied into the baseline's warnings is still listed and still fails", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await edit(rootPath, SPEC, "| Status | planned |", "| Status | not-a-status |");
    const baseline = await save(rootPath, ["validate"], "baseline.json");
    const genuine = JSON.parse(await readFile(baseline, "utf8")) as ValidateAnswer;
    await writeFile(baseline, JSON.stringify({ ...genuine, errors: [], warnings: [...genuine.warnings, ...genuine.errors] }), "utf8");

    const rerun = await run(["--root", rootPath, "validate", "--baseline", baseline, "--json"]);
    expect(rerun.exit).not.toBe(0);
    expect((JSON.parse(rerun.stdout) as ValidateAnswer).errors.map((entry) => entry.code)).toEqual(genuine.errors.map((entry) => entry.code));
  });
});

describe("IR-CLI-123 AC-3 — the answer says how many warnings the baseline removed", () => {
  it("IR-CLI-123 AC-3: JSON carries baseline.file and baseline.suppressed, and the human output says the number", async () => {
    const rootPath = await warned();
    const baseline = await save(rootPath, ["validate"], "baseline.json");
    const count = (JSON.parse(await readFile(baseline, "utf8")) as ValidateAnswer).warnings.length;
    const json = JSON.parse((await run(["--root", rootPath, "validate", "--baseline", baseline, "--json"])).stdout) as ValidateAnswer;
    expect(json.baseline).toEqual({ file: baseline, suppressed: count });
    const human = (await run(["--root", rootPath, "validate", "--baseline", baseline])).stdout;
    expect(human).toContain(`Baseline: ${count} warning`);
  });
});

describe("IR-CLI-123 AC-4 — links check drops broken entries the baseline holds, warnings only", () => {
  it("IR-CLI-123 AC-4: an existing broken file link leaves, a new one stays, and the count is reported", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await edit(rootPath, SPEC, "| Related Docs | [Index](./00.index.md) |", "| Related Docs | [One](./missing-one.md) |");
    const baseline = await save(rootPath, ["links", "check"], "links-baseline.json");
    const before = JSON.parse(await readFile(baseline, "utf8")) as LinksAnswer;
    expect(before.broken.map((entry) => entry.reference)).toEqual(["./missing-one.md"]);

    await edit(rootPath, SPEC, "| Related Docs | [One](./missing-one.md) |", "| Related Docs | [One](./missing-one.md), [Two](./missing-two.md) |");
    const answer = JSON.parse((await run(["--root", rootPath, "links", "check", "--baseline", baseline, "--json"])).stdout) as LinksAnswer;
    expect(answer.broken.map((entry) => entry.reference)).toEqual(["./missing-two.md"]);
    expect(answer.brokenIndexLinks).toEqual([]);
    expect(answer.baseline).toEqual({ file: baseline, suppressed: before.broken.length + before.brokenIndexLinks.length });
  });

  it("IR-CLI-123 AC-4: a broken requirement link (SRS-E012) stays although the baseline holds it", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await edit(rootPath, SPEC, "| Requirement | FR-ARCH-001 | self | Fixture self link |", "| Requirement | FR-ARCH-001 | self | Fixture self link |\n| Requirement | FR-ARCH-999 | depends_on | - |");
    const baseline = await save(rootPath, ["links", "check"], "links-baseline.json");
    expect((JSON.parse(await readFile(baseline, "utf8")) as LinksAnswer).broken.some((entry) => entry.code === "SRS-E012")).toBe(true);
    const answer = JSON.parse((await run(["--root", rootPath, "links", "check", "--baseline", baseline, "--json"])).stdout) as LinksAnswer;
    expect(answer.broken.filter((entry) => entry.code === "SRS-E012").map((entry) => entry.reference)).toEqual(["FR-ARCH-999"]);
  });
});

describe("IR-CLI-123 AC-5 — a baseline that is not the command's output is a usage error", () => {
  it.each([
    ["a missing file", null],
    ["a file that is not JSON", "not json"],
    ["the other command's output", "links"]
  ])("IR-CLI-123 AC-5: validate refuses %s with exit 2", async (_label, content) => {
    const rootPath = await warned();
    const file = path.join(rootPath, "bad-baseline.json");
    if (content === "links") await save(rootPath, ["links", "check"], "bad-baseline.json");
    else if (content !== null) await writeFile(file, content, "utf8");
    const answer = await run(["--root", rootPath, "validate", "--fail-on-warning", "--baseline", file, "--json"]);
    expect(answer.exit).toBe(2);
    const error = (JSON.parse(answer.stdout) as ValidateAnswer).error;
    expect(error?.code).toBe("USAGE");
    expect(error?.message).toContain("baseline");
  });

  it("IR-CLI-123 AC-5: links check refuses a validate output with exit 2", async () => {
    const rootPath = await warned();
    const file = await save(rootPath, ["validate"], "validate-baseline.json");
    const answer = await run(["--root", rootPath, "links", "check", "--baseline", file, "--json"]);
    expect(answer.exit).toBe(2);
    const error = (JSON.parse(answer.stdout) as LinksAnswer & { error?: { code: string; message: string } }).error;
    expect(error?.code).toBe("USAGE");
    expect(error?.message).toContain("baseline");
  });
});
