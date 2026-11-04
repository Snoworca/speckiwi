import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { addRelatedDoc } from "../../src/core/mutation/add-related-doc.js";
import { setSupersede } from "../../src/core/mutation/add-trace.js";


import { updateField } from "../../src/core/mutation/update-field.js";

import { updateStatus } from "../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";

async function fixture(edit: (text: string) => string, eol = "\n"): Promise<{ rootPath: string; before: string }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = edit((await readFile(file, "utf8")).replace(/\r\n/g, "\n"));
  const out = eol === "\n" ? text : text.replace(/\n/g, eol);
  await writeFile(file, out, "utf8");
  return { rootPath, before: out };
}

async function readRecord(rootPath: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return { record: workspace.records.find((r) => r.id === ID), diagnostics: workspace.diagnostics ?? [] };
}

describe("IR-CLI-112 r6: metadata row writers agree with the parser", () => {
  it("addRelatedDoc keeps the existing reference when the row has no trailing pipe", async () => {
    const { rootPath } = await fixture((t) => t.replace("| Related Docs | - |", "| Related Docs | docs/a.md"));
    expect((await readRecord(rootPath)).record?.metadata["Related Docs"]).toBe("docs/a.md");
    const result = await addRelatedDoc(await resolveProjectRoot(rootPath), { id: ID, reference: "docs/x.md", dryRun: false });
    expect(result.ok).toBe(true);
    expect((await readRecord(rootPath)).record?.metadata["Related Docs"]).toBe("docs/a.md, docs/x.md");
  });

  it("addRelatedDoc keeps the existing reference when the row is indented", async () => {
    const { rootPath } = await fixture((t) => t.replace("| Related Docs | - |", "  | Related Docs | docs/a.md |"));
    expect((await readRecord(rootPath)).record?.metadata["Related Docs"]).toBe("docs/a.md");
    const result = await addRelatedDoc(await resolveProjectRoot(rootPath), { id: ID, reference: "docs/x.md", dryRun: false });
    expect(result.ok).toBe(true);
    expect((await readRecord(rootPath)).record?.metadata["Related Docs"]).toBe("docs/a.md, docs/x.md");
  });

  it("setSupersede inserts a Supersedes row into a compact |Field|Value| metadata table", async () => {
    const { rootPath } = await fixture((t) => t.replace("### FR-ARCH-001 — Mutable requirement\n\n| Field | Value |", "### FR-ARCH-001 — Mutable requirement\n\n|Field|Value|"));
    expect((await readRecord(rootPath)).record?.metadata.Status).toBe("planned");
    const result = await setSupersede(await resolveProjectRoot(rootPath), { id: ID, supersedes: "FR-ARCH-002", dryRun: false });
    expect(result.ok).toBe(true);
    expect((await readRecord(rootPath)).record?.metadata.Supersedes).toBe("FR-ARCH-002");
  });

  it("updateStatus writes a row the parser reads when the metadata header is | Value | Field |", async () => {
    const { rootPath } = await fixture((t) =>
      t
        .replace("### FR-ARCH-001 — Mutable requirement\n\n| Field | Value |", "### FR-ARCH-001 — Mutable requirement\n\n| Value | Field |")
        .replace(/^\| (Type|Target|Status|Priority|Tags|Risk|Stability|Verification Method|GitHub Issue|Related Docs) \| ([^|]*) \|$/gm, (m, f: string, v: string, offset: number, all: string) =>
          offset > all.indexOf("### FR-ARCH-001") && offset < all.indexOf("#### Requirement", all.indexOf("### FR-ARCH-001")) ? `| ${v.trim()} | ${f} |` : m
        )
    );
    expect((await readRecord(rootPath)).record?.metadata.Status).toBe("planned");
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: ID, status: "in_progress", dryRun: false });
    expect(result.ok).toBe(true);
    expect((await readRecord(rootPath)).record?.metadata.Status).toBe("in_progress");
  });

  it("updateField keeps the third cell of a | Field | Value | Note | metadata row", async () => {
    const { rootPath } = await fixture((t) => {
      const start = t.indexOf("### FR-ARCH-001");
      const end = t.indexOf("#### Requirement", start);
      const block = t
        .slice(start, end)
        .replace("| Field | Value |\n| --- | --- |", "| Field | Value | Note |\n| --- | --- | --- |")
        .replace(/^(\| [^|]+ \| [^|]+ \|)$/gm, (row: string) => (row.startsWith("| Field") ? row : `${row} keep-me |`));
      return t.slice(0, start) + block + t.slice(end);
    });
    const pre = await readRecord(rootPath);
    expect(pre.record?.metadata.Priority).toBe("high");
    expect(pre.diagnostics.filter((d) => d.code === "SRS-E021")).toEqual([]);
    const result = await updateField(await resolveProjectRoot(rootPath), { id: ID, field: "priority", value: "low" });
    expect(result.ok).toBe(true);
    const post = await readRecord(rootPath);
    expect(post.record?.metadata.Priority).toBe("low");
    expect(post.diagnostics.filter((d) => d.code === "SRS-E021")).toEqual([]);
  });

});
