import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// Shared by the FR-PARSE-044 and FR-NODE-243 tests: the mutation-target fixture with FR-ARCH-001's
// Acceptance Criteria replaced and a second requirement, FR-ARCH-002, a successor can name.

export const SCOPE_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

const SECOND_BLOCK = `
### FR-ARCH-002 — Successor requirement

| Field | Value |
| --- | --- |
| Type | functional |
| Target | v1.0.0 |
| Status | planned |
| Priority | high |
| Tags | fixture |
| Risk | low |
| Stability | stable |
| Verification Method | test |
| GitHub Issue | - |
| Related Docs | - |

#### Requirement

SpecKiwi must accept this successor.

#### Rationale

A successor has to exist.

#### Acceptance Criteria

- [ ] AC-1: The successor exists.

#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
| --- | --- | --- | --- | --- |

#### Trace Links

| Type | Reference | Relation | Notes |
| --- | --- | --- | --- |

#### Change Notes

| Date | Change | Reason |
| --- | --- | --- |
| 2026-05-08 | Created | Fixture |
`;

export interface AcFixtureOptions {
  /** The Acceptance Criteria lines of FR-ARCH-001. */
  readonly acLines: readonly string[];
  /** Replaces `| Status | planned |` of FR-ARCH-001. */
  readonly status?: string;
  /** Verification Evidence rows of FR-ARCH-001. */
  readonly evidenceRows?: readonly string[];
  /** Replaces `| Status | planned |` of FR-ARCH-002. */
  readonly successorStatus?: string;
}

export async function acFixture(options: AcFixtureOptions): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SCOPE_FILE);
  let text = await readFile(file, "utf8");
  text = text.replace("- [ ] AC-1: The status can be updated.\n- [ ] AC-2: Evidence can be added.", options.acLines.join("\n"));
  if (options.status) text = text.replace("| Status | planned |", `| Status | ${options.status} |`);
  if (options.evidenceRows && options.evidenceRows.length > 0) {
    text = text.replace(
      "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |",
      ["| Evidence ID | Type | Reference | Covers | Notes |", "| --- | --- | --- | --- | --- |", ...options.evidenceRows].join("\n")
    );
  }
  const second = options.successorStatus ? SECOND_BLOCK.replace("| Status | planned |", `| Status | ${options.successorStatus} |`) : SECOND_BLOCK;
  await writeFile(file, `${text.trimEnd()}\n${second}`, "utf8");
  return rootPath;
}

export async function scopeText(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, SCOPE_FILE), "utf8");
}
