import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-103 — `update-status <id> discarded` reaches the verified-regression override.
//
// The core guard (FR-NODE-035) refuses to discard a requirement that is `verified`, whose Stability is
// `stable` or `frozen`, or that carries evidence at `implemented`, unless the caller passes
// `confirmDiscardVerified`. Before this requirement only `supersede` exposed that override, so a
// verified requirement with no successor had no discard path at all.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";
const FLAG = "--confirm-discard-verified";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
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

/** Rewrites the fixture block's metadata rows so the protection comes from the named ground only. */
async function setMetadata(root: string, status: string, stability: string): Promise<void> {
  const file = path.join(root, ARCH_DOC);
  const body = await readFile(file, "utf8");
  const start = body.indexOf(`### ${ID} `);
  const next = body.indexOf("\n### ", start + 1);
  const block = body.slice(start, next >= 0 ? next : body.length);
  const rewritten = block
    .replace(/\|\s*Status\s*\|\s*[^|]+\|/, `| Status | ${status} |`)
    .replace(/\|\s*Stability\s*\|\s*[^|]+\|/, `| Stability | ${stability} |`);
  expect(rewritten, "the fixture block carries no Status/Stability rows to rewrite").not.toBe(block);
  await writeFile(file, body.slice(0, start) + rewritten + body.slice(next >= 0 ? next : body.length), "utf8");
}

function discardArgs(root: string, extra: string[] = []): string[] {
  return ["--root", root, "update-status", ID, "discarded", "--reason", "no successor", "--json", ...extra];
}

describe("IR-CLI-103 — update-status discards a protected requirement only when the caller confirms", () => {
  // Two protected populations: the fixture as shipped (Stability stable) and the case the flag was
  // added for (Status verified, Stability evolving — protected by its status alone).
  const populations: ReadonlyArray<{ name: string; status?: string; stability?: string }> = [
    { name: "stable stability" },
    { name: "verified status", status: "verified", stability: "evolving" }
  ];

  for (const population of populations) {
    it(`IR-CLI-103 AC-1: without ${FLAG} the guard refuses a ${population.name} discard and writes nothing`, async () => {
      const root = await copyFixtureWorkspace("mutation-target");
      if (population.status && population.stability) await setMetadata(root, population.status, population.stability);
      const before = await readArch(root);

      const run = io();
      const code = await main(discardArgs(root), run);

      expect(code, "an unconfirmed discard of a protected requirement exited zero").not.toBe(0);
      const output = `${drain(run.stdout)}${drain(run.stderr)}`;
      expect(output).toContain("MUTATION_DENIED");
      expect(output, "the refusal names the flag a CLI caller can pass").toContain(FLAG);
      expect(await readArch(root), "the refused discard changed the document").toBe(before);
    });

    it(`IR-CLI-103 AC-1: with ${FLAG} a ${population.name} requirement is discarded`, async () => {
      const root = await copyFixtureWorkspace("mutation-target");
      if (population.status && population.stability) await setMetadata(root, population.status, population.stability);

      const run = io();
      const code = await main(discardArgs(root, [FLAG]), run);

      expect(code, `${drain(run.stdout)}${drain(run.stderr)}`).toBe(0);
      const after = await readArch(root);
      expect(statusOf(after, ID), "the confirmed discard did not take").toBe("discarded");
      expect(after, "the discard wrote no Change Notes row for its reason").toContain("no successor");
    });
  }

  it(`IR-CLI-103 AC-1: ${FLAG} with --dry-run previews the discard without writing`, async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);

    const run = io();
    const code = await main(discardArgs(root, [FLAG, "--dry-run"]), run);

    expect(code, `${drain(run.stdout)}${drain(run.stderr)}`).toBe(0);
    expect(await readArch(root), "a dry run wrote the discard").toBe(before);
  });

  it(`IR-CLI-103 AC-1: ${FLAG} is declared on update-status, not only accepted by commander's unknown-option leniency`, async () => {
    const run = io();
    const code = await main(["update-status", "--help"], run);
    expect(code).toBe(0);
    expect(`${drain(run.stdout)}${drain(run.stderr)}`).toContain(FLAG);
  });
});
