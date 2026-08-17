import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VERIFICATION_LEDGER_PATH,
  computeSectionSha,
  planVerificationRound,
  recordSectionVerified,
  splitDocumentSections
} from "../../../src/core/workflow/verification-ledger.js";
import type { ProjectRoot } from "../../../src/core/types.js";

// @req FR-FLOW-136 — a heading-keyed, content-hash verification ledger so a review round reads what
// changed instead of the whole document.
//
// The point of every assertion below is that the two failure directions are NOT symmetric. Missing a
// re-verification that was needed is a false trust; re-verifying something that did not change is
// only a token cost. So each behaviour is asserted in BOTH directions: the invariance that buys the
// saving (reflow, line shift) and the sensitivity that must survive it (one changed word, a renamed
// heading, a pruned-then-restored heading).

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
  "",
  "```sh",
  "# not a heading, it is fenced",
  "speckiwi doctor",
  "```",
  ""
].join("\n");

const INSTALL = "Guide > Install";
const USAGE = "Guide > Usage";

async function workspace(text: string = DOC): Promise<ProjectRoot> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-vledger-"));
  await writeDoc({ root }, text);
  return { root };
}

async function writeInside(root: ProjectRoot, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root.root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

async function writeDoc(root: ProjectRoot, text: string): Promise<void> {
  await writeInside(root, DOC_PATH, text);
}

async function ledgerText(root: ProjectRoot): Promise<string> {
  return readFile(path.join(root.root, VERIFICATION_LEDGER_PATH), "utf8").catch(() => "");
}

async function ledgerLines(root: ProjectRoot): Promise<Array<Record<string, unknown>>> {
  const text = await ledgerText(root);
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function verify(root: ProjectRoot, key: string, round = 1, verifier = "prickly-reviewer#1"): Promise<void> {
  const result = await recordSectionVerified(root, { doc: DOC_PATH, key, verifier, round });
  expect(result.ok, `recording ${key} must succeed: ${result.error?.message ?? ""}`).toBe(true);
}

async function plan(root: ProjectRoot, round = 2) {
  return planVerificationRound(root, { doc: DOC_PATH, round });
}

function verdictOf(planned: Awaited<ReturnType<typeof plan>>, key: string) {
  const found = planned.sections.find((section) => section.key === key);
  expect(found, `plan must classify ${key}`).toBeDefined();
  return found!;
}

describe("FR-FLOW-136 AC-1 — the heading is the key and the hash is over the normalized body", () => {
  it("is invariant under reflow, CRLF and trailing whitespace, and sensitive to one changed word", () => {
    const original = "Run the installer\nand wait for it to finish.";
    const reflowed = "Run   the installer and wait\r\n   for it to finish.   ";
    expect(computeSectionSha(reflowed), "reflow must not dirty a section").toBe(computeSectionSha(original));

    const reworded = "Run the installer and wait for it to complete.";
    expect(computeSectionSha(reworded), "one changed word must dirty a section").not.toBe(computeSectionSha(original));
  });

  it("does not collapse the body into nothing — two different prose bodies never share a hash", () => {
    // A normalization aggressive enough to strip markdown (the caution the research records against
    // reusing the REQ-field normalizer verbatim) would make these two collide.
    expect(computeSectionSha("- **enabled** by default")).not.toBe(computeSectionSha("- enabled by default"));
    expect(computeSectionSha("value is 10")).not.toBe(computeSectionSha("value is 100"));
  });

  it("keys a section by its heading path and owns only its own text", () => {
    const sections = splitDocumentSections(DOC);
    expect(sections.map((section) => section.key)).toEqual(["Guide", INSTALL, USAGE]);
    const guide = sections[0]!;
    expect(guide.body).toContain("Intro paragraph owned by the top heading.");
    expect(guide.body, "a parent must not own its children's text, or every child edit dirties it").not.toContain(
      "Run the installer"
    );
    expect(sections[2]!.body, "a fenced `#` line is not a heading").toContain("speckiwi doctor");
  });

  it("holds a section clean across a reflow and across a line shift, and dirties it on a reword", async () => {
    const root = await workspace();
    await verify(root, INSTALL);
    expect(verdictOf(await plan(root), INSTALL).classification).toBe("clean");

    await writeDoc(
      root,
      DOC.replace(
        "Run the installer and wait for it to finish.",
        "Run the installer\r\nand wait for it to finish.   "
      )
    );
    expect(verdictOf(await plan(root), INSTALL).classification, "reflow must not dirty").toBe("clean");

    await writeDoc(root, `# Preface\n\nAdded above, so every later line number shifts.\n\n${DOC}`);
    expect(verdictOf(await plan(root), INSTALL).classification, "a line shift must not dirty").toBe("clean");

    await writeDoc(root, DOC.replace("wait for it to finish", "wait for it to complete"));
    expect(verdictOf(await plan(root), INSTALL).classification, "a reworded body must dirty").toBe("dirty");
  });
});

describe("FR-FLOW-136 AC-2 — only dirty sections are sent, and unmatched keys fail open", () => {
  it("sends the dirty section with context and does not send the clean one at all", async () => {
    const root = await workspace();
    await verify(root, INSTALL);
    await writeDoc(root, DOC.replace("Pass the flag", "Pass the switch"));

    const planned = await plan(root);
    expect(planned.sent, "a clean section must not be sent").not.toContain(INSTALL);
    expect(planned.skipped).toContain(INSTALL);
    expect(planned.sent).toContain(USAGE);

    expect(verdictOf(planned, INSTALL).payload, "a clean section carries no payload to spend tokens on").toBeUndefined();
    const usage = verdictOf(planned, USAGE);
    expect(usage.payload, "a dirty section must arrive with its text").toContain("Pass the switch");
    expect(usage.payload, "the surrounding context is what makes the section judgeable").toContain("## Usage");
    expect(usage.payload, "context reaches above the heading").toContain("Run the installer");
  });

  it("treats a renamed heading as unmatched, so the rename is re-verified rather than trusted", async () => {
    const root = await workspace();
    await verify(root, INSTALL);
    await writeDoc(root, DOC.replace("## Install", "## Installation"));

    const planned = await plan(root);
    const renamed = verdictOf(planned, "Guide > Installation");
    expect(renamed.classification, "an unmatched key is always dirty").toBe("dirty");
    expect(planned.sent).toContain("Guide > Installation");
    expect(planned.sections.some((section) => section.key === INSTALL), "the old key is gone from the document").toBe(
      false
    );
  });

  it("treats a split heading as two unmatched-or-changed sections, never as one carried-over clean one", async () => {
    const root = await workspace();
    await verify(root, USAGE);
    await writeDoc(
      root,
      DOC.replace(
        "Pass the flag to enable the feature.",
        "Pass the flag to enable the feature.\n\n### Flags\n\nThe flag takes no argument."
      )
    );

    const planned = await plan(root);
    expect(verdictOf(planned, "Guide > Usage > Flags").classification, "the new half is unmatched").toBe("dirty");
    expect(
      verdictOf(planned, USAGE).classification,
      "the surviving half lost text, so its hash moved and it is not clean"
    ).toBe("dirty");
  });

  it("refuses to call a section clean on a ledger entry with no verifier identity", async () => {
    const root = await workspace();
    const sha = splitDocumentSections(DOC).find((section) => section.key === INSTALL)!.sha;
    await writeInside(
      root,
      VERIFICATION_LEDGER_PATH,
      `${JSON.stringify({
        schema_version: "1.0.0",
        event: "section_verified",
        fpv: "vlv1",
        doc: DOC_PATH,
        key: INSTALL,
        sha,
        verifier: "",
        round: 1
      })}\n`
    );

    const planned = await plan(root);
    expect(verdictOf(planned, INSTALL).classification, "an anonymous entry is not evidence of verification").toBe(
      "dirty"
    );
  });

  it("dirties both sections when one heading key occurs twice, because neither can be told apart", async () => {
    const doubled = `${DOC}\n## Install\n\nA second section carrying the same heading path.\n`;
    const root = await workspace(doubled);
    await verify(root, INSTALL).catch(() => undefined);

    const planned = await plan(root);
    const both = planned.sections.filter((section) => section.key === INSTALL);
    expect(both.length, "the fixture must actually contain the collision").toBe(2);
    for (const section of both) expect(section.classification).toBe("dirty");
  });
});

describe("FR-FLOW-136 AC-3 — an append-only JSONL ledger under kiwi/, pruned of orphans each pass", () => {
  it("writes to kiwi/verification-ledger.jsonl and records key, hash, verifier and round", async () => {
    const root = await workspace();
    expect(VERIFICATION_LEDGER_PATH).toBe("kiwi/verification-ledger.jsonl");
    await verify(root, INSTALL, 2, "prickly-reviewer#2");

    const [entry] = await ledgerLines(root);
    expect(entry).toMatchObject({
      event: "section_verified",
      doc: DOC_PATH,
      key: INSTALL,
      verifier: "prickly-reviewer#2",
      round: 2
    });
    expect(String(entry!.sha), "the recorded hash is the section's, computed by the tool not the agent").toBe(
      splitDocumentSections(DOC).find((section) => section.key === INSTALL)!.sha
    );
  });

  it("is append-only — a later pass never rewrites or shortens what an earlier pass wrote", async () => {
    const root = await workspace();
    await verify(root, INSTALL);
    const afterFirst = await ledgerText(root);

    await verify(root, USAGE, 2);
    await writeDoc(root, DOC.replace("## Usage\n\nPass the flag to enable the feature.\n\n", ""));
    await plan(root, 3);

    const afterPrune = await ledgerText(root);
    expect(afterPrune.startsWith(afterFirst), "the earlier bytes must survive verbatim").toBe(true);
    expect(afterPrune.length).toBeGreaterThan(afterFirst.length);
  });

  it("prunes an orphan whose heading no longer exists, once, and reopens it if the heading returns", async () => {
    const root = await workspace();
    await verify(root, USAGE);
    await writeDoc(root, DOC.replace("## Usage\n\nPass the flag to enable the feature.\n\n", ""));

    const first = await plan(root, 2);
    expect(first.pruned, "the orphan must be named").toEqual([USAGE]);
    const prune = (await ledgerLines(root)).filter((line) => line.event === "section_pruned");
    expect(prune.length, "the prune is recorded as an appended line, not as a rewrite").toBe(1);
    expect(prune[0]!.keys).toEqual([USAGE]);

    const second = await plan(root, 3);
    expect(second.pruned, "a settled prune must not be re-appended every pass").toEqual([]);
    expect((await ledgerLines(root)).filter((line) => line.event === "section_pruned").length).toBe(1);

    await writeDoc(root, DOC);
    const third = await plan(root, 4);
    expect(
      verdictOf(third, USAGE).classification,
      "a restored heading has no live entry, and a pruned one must not resurrect as clean"
    ).toBe("dirty");
  });

  it("keys a document by one spelling, so a Windows-style path does not open a second ledger", async () => {
    // The skill runs on whatever separator the caller typed. Keyed verbatim, `docs\guide.md` and
    // `docs/guide.md` would be two disjoint documents and every section would read dirty forever —
    // fail-open, so silent: the ledger would simply never save anything and nothing would report it.
    const root = await workspace();
    const recorded = await recordSectionVerified(root, {
      doc: DOC_PATH.replace(/\//g, "\\"),
      key: INSTALL,
      verifier: "prickly-reviewer#1",
      round: 1
    });
    expect(recorded.ok, recorded.error?.message ?? "").toBe(true);
    expect(verdictOf(await plan(root), INSTALL).classification).toBe("clean");
    expect(String((await ledgerLines(root))[0]!.doc)).toBe(DOC_PATH);
  });

  it("refuses to record a section the document does not carry, so no hash is invented", async () => {
    const root = await workspace();
    const result = await recordSectionVerified(root, {
      doc: DOC_PATH,
      key: "Guide > Nowhere",
      verifier: "prickly-reviewer#1",
      round: 1
    });
    expect(result.ok).toBe(false);
    expect(await ledgerText(root)).toBe("");
  });

  it("refuses to record an anonymous verification", async () => {
    const root = await workspace();
    const result = await recordSectionVerified(root, { doc: DOC_PATH, key: INSTALL, verifier: "  ", round: 1 });
    expect(result.ok).toBe(false);
    expect(await ledgerText(root)).toBe("");
  });
});
