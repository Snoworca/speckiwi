import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { applyRequirementIdCollisionRepair, diagnoseRequirementIdCollisions } from "../../../src/core/mutation/repair-requirement-id.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 AC-1/AC-3 — a mutation that writes several documents writes all of them or none. The
// shared transaction applyPatchPlans gives that guarantee; a mutation that loops over files calling
// the single-file writer does not, and leaves the first document changed when the second write fails.
// Two guards: a source scan that finds every such loop, and failure injection on representative paths,
// because a scan of the source does not prove what runs.

const fault = vi.hoisted(() => ({ failOnSrsRename: 0, srsRenames: 0, failOnMdRename: 0, mdRenames: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failOnMdRename > 0 && String(to).endsWith(".md")) {
        fault.mdRenames += 1;
        if (fault.mdRenames === fault.failOnMdRename) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      }
      if (fault.failOnSrsRename > 0 && String(to).endsWith(".srs.md")) {
        fault.srsRenames += 1;
        if (fault.srsRenames === fault.failOnSrsRename) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      }
      return actual.rename(from, to);
    }
  };
});
afterEach(() => {
  fault.failOnSrsRename = 0;
  fault.srsRenames = 0;
  fault.failOnMdRename = 0;
  fault.mdRenames = 0;
});

const MUTATION_DIR = path.resolve("src", "core", "mutation");

/**
 * Mutations that still write two documents one after the other, each with the reason it is not yet
 * on the shared transaction. Every entry is a known gap, reported, not an accepted design.
 */
const SEQUENTIAL_WRITE_RESIDUALS: Record<string, string> = {};

/** Loops that write one document at most once: a retry around a single write that returns after it. */
const SINGLE_WRITE_LOOPS: Record<string, string> = {
  "add-requirement.ts:addRequirementUnlocked": "retries the id allocation; the only write is followed by a return"
};

/**
 * True when `patch` runs after `write` on the same path: it starts later, it is not on the other branch
 * of a condition, and no return or throw ends the path of `write` first.
 */
function runsAfter(write: ts.Node, patch: ts.Node): boolean {
  if (patch.getStart() < write.getEnd()) return false;
  let shared: ts.Node = write;
  while (!(shared.getStart() <= patch.getStart() && patch.getEnd() <= shared.getEnd())) shared = shared.parent;
  if (ts.isIfStatement(shared) || ts.isConditionalExpression(shared)) return false;
  for (let node: ts.Node = write; node.parent !== shared; node = node.parent) {
    const parent = node.parent;
    if (!ts.isBlock(parent)) continue;
    const rest = parent.statements.slice(parent.statements.indexOf(node as ts.Statement) + 1);
    if (rest.some((statement) => ts.isReturnStatement(statement) || ts.isThrowStatement(statement))) return false;
  }
  return true;
}

/**
 * Functions that call applyPatchPlan inside a loop or more than once, or that patch (applyPatchPlan or
 * applyPatchPlans) after a direct writeFile: a new document written outside the transaction, then a
 * patch that can still fail and leave it behind.
 */
function sequentialWriters(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const isLoop = (node: ts.Node) =>
    ts.isForOfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
  const isFunction = (node: ts.Node) => ts.isFunctionLike(node);
  const visitFunction = (fn: ts.Node, name: string) => {
    const patches: ts.Node[] = [];
    const transactions: ts.Node[] = [];
    const directWrites: ts.Node[] = [];
    let inLoop = false;
    const walk = (node: ts.Node, loopDepth: number) => {
      if (node !== fn && isFunction(node)) return;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "applyPatchPlan") {
        patches.push(node);
        if (loopDepth > 0) inLoop = true;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "applyPatchPlans") transactions.push(node);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "writeFile") directWrites.push(node);
      ts.forEachChild(node, (child) => walk(child, loopDepth + (isLoop(node) ? 1 : 0)));
    };
    walk(fn, 0);
    const patchAfterWrite = directWrites.some((write) => [...patches, ...transactions].some((patch) => runsAfter(write, patch)));
    if (inLoop || patches.length > 1 || patchAfterWrite) found.push(`${fileName}:${name}`);
  };
  const scan = (node: ts.Node) => {
    if (isFunction(node)) {
      const name = (node as ts.FunctionLikeDeclaration).name?.getText(source) ?? `<anonymous@${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}>`;
      visitFunction(node, name);
    }
    ts.forEachChild(node, scan);
  };
  scan(source);
  return found;
}

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const NODE_FILE = path.join("docs", "spec", "20.node.srs.md");

/** The fixture plus a NODE scope document whose FR-NODE-001 traces FR-ARCH-001. */
async function twoDocumentFixture(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const arch = (await readFile(path.join(rootPath, SPEC), "utf8")).replace(/\r\n/g, "\n");
  const block = arch.slice(arch.indexOf("### FR-ARCH-001"));
  const nodeBlock = block
    .replace("### FR-ARCH-001 — Mutable requirement", "### FR-NODE-001 — Node requirement")
    .replace("| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |", "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n| Requirement | FR-ARCH-001 | depends_on | - |");
  const header = "# Node\n\n| Field | Value |\n|---|---|\n| Document Type | scope_srs |\n| Scope | NODE |\n| Scope Name | Node |\n\n## 4. Requirements\n\n";
  await writeFile(path.join(rootPath, NODE_FILE), `${header}${nodeBlock}`, "utf8");
  const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
  const index = (await readFile(indexPath, "utf8")).replace(/\r\n/g, "\n");
  const row = "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |";
  await writeFile(indexPath, index.replaceAll(row, `${row}\n| Node | [20.node.srs.md](./20.node.srs.md) | NODE | Node |`), "utf8");
  return rootPath;
}

async function snapshotSpec(rootPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const dir = path.join(rootPath, "docs", "spec");
  for (const name of await readdir(dir)) {
    if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  }
  return out;
}

describe("IR-CLI-112 mutations that write several documents use the shared transaction", () => {
  it("no mutation writes documents one by one outside the listed residuals", async () => {
    const found: string[] = [];
    for (const name of (await readdir(MUTATION_DIR)).filter((entry) => entry.endsWith(".ts"))) {
      found.push(...sequentialWriters(name, await readFile(path.join(MUTATION_DIR, name), "utf8")));
    }
    const offenders = found.filter((entry) => !(entry.split(":")[0]! in SEQUENTIAL_WRITE_RESIDUALS) && !(entry in SINGLE_WRITE_LOOPS));
    expect(offenders).toEqual([]);
    for (const loop of Object.keys(SINGLE_WRITE_LOOPS)) expect(found, loop).toContain(loop);
    // A residual that no longer writes sequentially must leave the list.
    for (const residual of Object.keys(SEQUENTIAL_WRITE_RESIDUALS)) expect(found.some((entry) => entry.startsWith(`${residual}:`)), residual).toBe(true);
  });

  it("the scan recognises a loop of single-file writes and a repeated write", () => {
    expect(sequentialWriters("x.ts", "async function f(ps) { for (const p of ps) await applyPatchPlan(p, { dryRun: false }); }")).toEqual(["x.ts:f"]);
    expect(sequentialWriters("y.ts", "async function g(a, b) { await applyPatchPlan(a, o); await applyPatchPlan(b, o); }")).toEqual(["y.ts:g"]);
    expect(sequentialWriters("z.ts", "async function h(a) { await applyPatchPlan(a, o); }")).toEqual([]);
  });

  // @req FR-NODE-279 AC-1 — scaffold-scope wrote its new document with writeFile and then patched the
  // index; the index write could still fail and leave the document behind.
  it("the scan recognises a direct writeFile followed by a patch write", () => {
    expect(sequentialWriters("w.ts", "async function k(p, a) { await writeFile(p, 'x'); await applyPatchPlan(a, o); }")).toEqual(["w.ts:k"]);
    expect(sequentialWriters("m.ts", "async function m(p, a) { if (c) { await writeFile(p, 'x'); } await applyPatchPlan(a, o); }")).toEqual(["m.ts:m"]);
    expect(sequentialWriters("t.ts", "async function t(p, a) { await writeFile(p, 'x'); await applyPatchPlans([a], o); }")).toEqual(["t.ts:t"]);
    // One document either way: a create on one branch and a patch on the other, or a create that returns.
    expect(sequentialWriters("b.ts", "async function b(p, a) { if (c) { await writeFile(p, 'x'); } else { await applyPatchPlan(a, o); } }")).toEqual([]);
    expect(sequentialWriters("r.ts", "async function r(p, a) { if (c) { await writeFile(p, 'x'); return 1; } await applyPatchPlan(a, o); }")).toEqual([]);
  });

  // @req IR-CLI-112 AC-3
  it("a type migration whose second document write fails leaves every document as it was", async () => {
    const rootPath = await twoDocumentFixture();
    const before = await snapshotSpec(rootPath);
    fault.failOnSrsRename = 2;
    await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", field: "type", value: "non_functional", signOff: true, dryRun: false }).catch(() => undefined);
    expect(fault.srsRenames).toBe(2);
    fault.failOnSrsRename = 0;
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3
  it("a retarget whose second document write fails leaves every document as it was", async () => {
    const rootPath = await twoDocumentFixture();
    const before = await snapshotSpec(rootPath);
    fault.failOnSrsRename = 2;
    await retarget(await resolveProjectRoot(rootPath), { ids: ["FR-ARCH-001", "FR-NODE-001"], toTarget: "v1.1.0", dryRun: false }).catch(() => undefined);
    expect(fault.srsRenames).toBe(2);
    fault.failOnSrsRename = 0;
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-1
  it("a target rename whose second requirement document write fails leaves every document, the index included, as it was", async () => {
    const rootPath = await twoDocumentFixture();
    const before = await snapshotSpec(rootPath);
    fault.failOnSrsRename = 2;
    await renameTarget(await resolveProjectRoot(rootPath), { from: "v1.0.0", to: "v9.0.0", dryRun: false }).catch(() => undefined);
    expect(fault.srsRenames).toBe(2);
    fault.failOnSrsRename = 0;
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3 — the id collision repair renames the block and edits an index reference in
  // one call, the same fixture shape the repair's own suite uses (duplicate-id + a Completed Work Log row).
  it("an id collision repair whose second document write fails leaves every document as it was", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(
      indexPath,
      `${await readFile(indexPath, "utf8")}

## 7. Completed Work Log

| Date | Target | Scope | Requirement IDs | Summary | Report Paths |
|---|---|---|---|---|---|
| 2026-06-30 | v1.0.0 | ARCH | FR-ARCH-001 | Duplicate repair fixture. | docs/reports/repair.md |
`,
      "utf8"
    );
    const rowLine = (await readFile(indexPath, "utf8")).split(/\r?\n/).findIndex((line) => line.includes("Duplicate repair fixture")) + 1;
    const root = await resolveProjectRoot(rootPath);
    const diagnosed = await diagnoseRequirementIdCollisions(root);
    const group = diagnosed.value?.groups.find((item) => item.duplicateId === "FR-ARCH-001");
    if (!group) throw new Error("duplicate group missing");
    const before = await snapshotSpec(rootPath);
    fault.failOnMdRename = 2;
    await applyRequirementIdCollisionRepair(root, {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      replacementId: "FR-ARCH-002",
      referenceEdits: [{ filePath: "docs/spec/00.index.md", line: rowLine, from: "FR-ARCH-001", to: "FR-ARCH-002" }]
    }).catch(() => undefined);
    expect(fault.mdRenames).toBe(2);
    fault.failOnMdRename = 0;
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });
});
