// Lite-profile SDS files for the wave scheduler's command tests. Each file passes `speckiwi sds check`
// against the `valid-basic` workspace it is written into (FR-ARCH-001 with AC-1 and AC-2 in target
// v1.0.0), so a test states only the write set it is about: the Files paths and the test files the
// Test Plan names.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

export interface SdsSpec {
  /** The SDS id: the file is written at `docs/sds/{id}.sds.md`. */
  readonly id: string;
  readonly files: readonly string[];
  readonly testFiles?: readonly string[];
  readonly reqIds?: readonly string[];
}

export function sdsPath(id: string): string {
  return `docs/sds/${id}.sds.md`;
}

/** One lite SDS: every Files entry declares one function, and one contract per test file points at it. */
export function liteSdsText(spec: SdsSpec): string {
  const reqIds = spec.reqIds ?? ["FR-ARCH-001"];
  const testFiles = spec.testFiles ?? [];
  const lines = [
    `# SDS: ${spec.id}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Profile | lite |",
    "| Target | v1.0.0 |",
    "| Status | agreed |",
    "| Date | 2026-09-27 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    ""
  ];
  spec.files.forEach((file, index) => {
    lines.push(`- \`${file}\` — responsibility ${index + 1} @req ${reqIds.join(", ")}`);
    lines.push(`  - \`fn${index + 1}(): void\` — does step ${index + 1}`);
  });
  lines.push("", "## Acceptance Contracts", "");
  testFiles.forEach((_file, index) => {
    lines.push(`- SDS-AC-${index + 1} (${reqIds[0]} AC-1): WHEN step ${index + 1} runs THE SYSTEM SHALL finish → \`fn1\``);
  });
  lines.push("", "## Test Plan", "", "| SDS-AC | Test file | Case summary |", "|---|---|---|");
  testFiles.forEach((file, index) => {
    lines.push(`| SDS-AC-${index + 1} | \`${file}\` | case ${index + 1} |`);
  });
  lines.push("");
  return lines.join("\n");
}

export async function writeUnder(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/** A temporary copy of the `valid-basic` workspace holding one lite SDS per spec. */
export async function sdsWorkspace(specs: readonly SdsSpec[]): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  for (const spec of specs) await writeUnder(root, sdsPath(spec.id), liteSdsText(spec));
  return root;
}
