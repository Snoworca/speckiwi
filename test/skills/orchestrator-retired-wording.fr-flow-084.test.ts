import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-084  AC-6 retired: the single-witness reduction of host-root serial execution
// @req FR-FLOW-087  AC-5 retired: loop L's realised-with-test closure is no longer named as deferred
// @req FR-FLOW-094  AC-2 retired: the handoff `## Setup` wording and its `dod` clause
// @req FR-FLOW-150  AC-5 retired: the lane plan lock is one per stage, with no wave component
//
// A retired criterion is evidenced by a test that goes red when the retired wording comes back. Each
// pattern below is the spelling the pre-4.0.0 renderings used, so a restored paragraph is caught
// verbatim; the lock-path check reads every path-bearing mention rather than one the body names.

const ORCHESTRATORS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/kiwi-orchestrator/SKILL.md`);
const WAVE_MASTERS = ["claude", "codex", "etc"].map((bundle) => `skills/${bundle}/kiwi-wave-master/SKILL.md`);
const CONTRACTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const LEDGERS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/_shared/kiwi/run-ledger.md`);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("FR-FLOW-084 AC-6 retired — §12.1 carries no single-witness reduction", () => {
  it.each(ORCHESTRATORS)("FR-FLOW-084 AC-6 %s: loop P's denominators name no witness count and no phase split", (copy) => {
    const denominators = section(read(copy), /^###\s*12\.1\b/m);
    expect(denominators, `${copy}: §12.1`).not.toBe("");
    const retired = denominators.split("\n").filter((line) => /증인|witness|phase 1|phase 2|이 축소를/.test(line));
    expect(retired, `${copy}: the single-witness reduction described host-root serial execution, which is gone`).toEqual([]);
    // What replaced it: one worker per wave, judged by the host before its merge.
    expect(denominators).toMatch(/`expected` = `lanes\.lock\.json` 이 그 wave 에 배정한 lane — 그 wave 의 워커 하나/);
  });
});

describe("FR-FLOW-087 AC-5 retired — loop L's closure is not named as deferred", () => {
  it.each(ORCHESTRATORS)("FR-FLOW-087 AC-5 %s: the body names neither loop L nor realised-with-test, and §14 runs the test-sufficiency check before promotion", (copy) => {
    const text = read(copy);
    const retired = text.split("\n").filter((line) => /realised-with-test|loop L\b|이연으로 지명/.test(line));
    expect(retired, `${copy}: loop L's closure left with loop L`).toEqual([]);
    const promotion = section(text, /^## 14\. /m);
    const check = promotion.search(/test-sufficiency\.md/);
    const promote = promotion.search(/`implemented` \| `verified`/);
    expect(check, `${copy}: §14 names the test-sufficiency check`).toBeGreaterThanOrEqual(0);
    expect(promote, `${copy}: §14 carries the promotion rows`).toBeGreaterThan(check);
  });
});

describe("FR-FLOW-094 AC-2 retired — no handoff `## Setup` or `dod` clause compares against the ledger", () => {
  it.each([...ORCHESTRATORS, ...WAVE_MASTERS, ...LEDGERS])("FR-FLOW-094 AC-2 %s: neither the handoff's Setup section nor its dod clause survives", (copy) => {
    const text = read(copy);
    expect(text.length, `${copy}: an empty file would pass vacuously`).toBeGreaterThan(1000);
    const retired = text.split("\n").filter((line) => /`## Setup`|`dod`|dod 절/.test(line));
    expect(retired, `${copy}: the English handoff documents left in 4.0.0`).toEqual([]);
  });
});

describe("FR-FLOW-150 AC-5 retired — the lane plan lock carries a stage component, never a wave one", () => {
  it.each([...ORCHESTRATORS, ...WAVE_MASTERS, ...CONTRACTS])("FR-FLOW-150 AC-5 %s: every lock path is waves/stage-{s}/lanes.lock.json", (copy) => {
    const text = read(copy);
    // Every mention that carries a directory — a bare `lanes.lock.json` names the file, not its scope.
    const paths = [...text.matchAll(/([\w{}.\-/]*\/)lanes\.lock\.json/g)].map((match) => match[1] as string);
    expect(paths.length, `${copy}: at least one lock path`).toBeGreaterThan(0);
    const wrong = paths.filter((dir) => !/(^|\/|\{artifact_root\})waves\/stage-\{s\}\/$/.test(dir));
    expect(wrong, `${copy}: a lock path outside waves/stage-{s}/`).toEqual([]);
    expect(/wave-\{n\}\/lanes\.lock/.test(text), `${copy}: the per-wave lock path`).toBe(false);
  });
});
