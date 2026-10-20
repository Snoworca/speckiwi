import { describe, expect, it } from "vitest";

import { section, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, readRepoFile, scanUnits, skillDirs, skillFiles } from "./kiwi-renderings.js";

// @req FR-FLOW-195 — waves are declared in a wave declaration file (`{artifact_root}waves/waves.json`,
// FR-NODE-216 schema), scheduled with `orchestrate schedule waves --waves` and read back with
// `orchestrate wave status`; a per-wave SDS is written only under --sds.
//
// The shared contracts are read in every rendering that ships them (the `.agents` mirror included);
// kiwi-wave-master is excluded from the mirror, so it is read where the rendering ships it.

function shared(rendering: string, file: string): string {
  return readRepoFile(`${rendering}/_shared/kiwi/${file}`).replace(/\r\n/g, "\n");
}

function paragraph(text: string, label: RegExp): string {
  return scanUnits(text).find((unit) => label.test(unit.text))?.text ?? "";
}

/** One PW step of parallel-waves.md §5, from its bold label up to the next PW label. */
function pw(rendering: string, n: number): string {
  const steps = section(shared(rendering, "parallel-waves.md"), /^##\s*5\.\s/);
  const from = steps.search(new RegExp(String.raw`\*\*PW-${n} ·`));
  if (from < 0) return "";
  const rest = steps.slice(from + 4);
  const to = rest.search(/\*\*PW-\d+ ·/);
  return flat(to < 0 ? steps.slice(from) : steps.slice(from, from + 4 + to));
}

function gateRow(text: string, gate: string): string {
  return tableRows(text).find((row) => (row.cells[0] ?? "").replace(/`/g, "") === gate)?.cells.join(" | ") ?? "";
}

describe("FR-FLOW-195 AC-1 — the decomposition writes waves.json with files[] and requirements[]", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/wave-decomposition.md", (rendering) => {
    const text = flat(shared(rendering, "wave-decomposition.md"));
    expect(text).toContain("{artifact_root}waves/waves.json");
    for (const key of ["`schema_version`", "`wave`", "`depends_on`", "`files`", "`requirements`", "`sds`"]) expect(text, `${rendering}: the schema lost ${key}`).toContain(key);
    expect(text).toMatch(/`wave-1`, `wave-2`/);
    const files = paragraph(shared(rendering, "wave-decomposition.md"), /`files\[\]`[^]*(기존 모듈|existing modules)/);
    expect(files, `${rendering}: no rule for how files[] is filled`).not.toBe("");
    expect(files).toMatch(/`orchestrator-only`/);
    expect(files).toMatch(/`regenerate`/);
    expect(files).toMatch(/PW-12/);
    const requirements = paragraph(shared(rendering, "wave-decomposition.md"), /`requirements\[\]`[^]*allocation\.requirement_ids\[\]/);
    expect(requirements, `${rendering}: no rule for how requirements[] is filled`).not.toBe("");
  });
});

describe("FR-FLOW-195 AC-2 — readiness and stages come from the tools over waves.json, never by hand", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/parallel-waves.md", (rendering) => {
    const text = flat(shared(rendering, "parallel-waves.md"));
    expect(text).toContain("speckiwi orchestrate wave status --waves {artifact_root}waves/waves.json --run-id {run_id}");
    expect(text).toContain(
      "speckiwi orchestrate schedule waves --waves {artifact_root}waves/waves.json --run-id {run_id} --lanes N --out {artifact_root}waves/stage-{s}/lanes.lock.json --json"
    );
    for (const manual of ["--depends", "existing-paths.json"]) expect(text.includes(manual), `${rendering}: the contract still tells the host to build ${manual}`).toBe(false);
  });
});

describe("FR-FLOW-195 AC-3 — unallocated-req-id checks requirements[]; requirement-not-ready stops the wave before dispatch; files-not-grounded covers files[]", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/parallel-waves.md §4", (rendering) => {
    const gates = section(shared(rendering, "parallel-waves.md"), /^##\s*4\.\s/);
    const unallocated = gateRow(gates, "unallocated-req-id");
    expect(unallocated).toContain("`requirements[]`");
    expect(unallocated).toMatch(/`--sds`/);
    const notReady = gateRow(gates, "requirement-not-ready");
    expect(notReady, `${rendering}: requirement-not-ready is not a gate of the contract`).not.toBe("");
    expect(notReady).toMatch(/dispatch/);
    expect(gateRow(gates, "files-not-grounded")).toContain("`files[]`");
  });

  for (const skill of ["kiwi-orchestrator", "kiwi-wave-master"]) {
    it.each(RENDERINGS.filter((rendering) => skillDirs(rendering).includes(skill)))(`%s/${skill}: the unallocated-req-id row reads requirements[]`, (rendering) => {
      const rows = skillFiles(rendering, skill).map((doc) => gateRow(doc.text, "unallocated-req-id")).filter((row) => row !== "");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toContain("`requirements[]`");
    });
  }
});

describe("FR-FLOW-195 AC-4 — the worker runs kiwi-pm on the wave's requirements[], and PW-8 judges against the lock's writeSet", () => {
  it.each(RENDERINGS)("%s", (rendering) => {
    const worker = pw(rendering, 6);
    expect(worker).toMatch(
      /\/kiwi-pm --req-filter <[^>]*requirements\[\][^>]*> --run-id \{run_id\}-wave-\{n\}\[-r\{m\}\] --session-suffix w\{n\}s\{s\}l\{k\} --no-final --no-pipeline-emit --commit-lane-work --defer-srs-mutation/
    );
    expect(worker).toMatch(/`--sds` 면[^.]*`--sds <[^>]+>`|[Uu]nder `--sds`[^.]*`--sds <[^>]+>`/);
    const verdict = pw(rendering, 8);
    expect(verdict).toMatch(/(?:변경 경로|changed paths) ⊆ [^)]*`writeSet`/);
  });
});

describe("FR-FLOW-195 AC-5 — the SDS steps run only for a wave that has SDS files", () => {
  it.each(RENDERINGS)("%s: PW-2, PW-14, PW-15 and PW-17 name the condition", (rendering) => {
    for (const n of [2, 15, 17]) expect(pw(rendering, n).slice(0, 160), `${rendering}: PW-${n} is not conditioned on --sds`).toMatch(/`--sds`/);
    expect(pw(rendering, 14)).toMatch(/SDS 파일이 있는 wave|wave that has SDS files|`--sds`/);
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/run-ledger.md: the sds-wave verb is the --sds step", (rendering) => {
    expect(gateRow(shared(rendering, "run-ledger.md"), "sds-wave")).toMatch(/`--sds`/);
  });

  it.each(RENDERINGS)("%s: the docs/sds watch stays", (rendering) => {
    expect(flat(shared(rendering, "parallel-waves.md"))).toContain("git status --porcelain docs/spec docs/sds");
  });
});

describe("FR-FLOW-195 AC-6 — sds_id is the wave's unit id, with or without an SDS file", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/waves-event.md", (rendering) => {
    const row = gateRow(shared(rendering, "waves-event.md"), "sds_id");
    expect(row).toContain("`{run_id}-wave-{n}`");
    expect(row).toMatch(/단위 id|unit id/);
    expect(row).toMatch(/그 파일이 있을 때만|only when that file exists/);
  });
});

describe("FR-FLOW-195 AC-7 — worktree-lane, wave-srs-registration and run-ledger say the same", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/worktree-lane.md: the lane write set is the lock's writeSet", (rendering) => {
    const lane = paragraph(shared(rendering, "worktree-lane.md"), /lane 하나는 wave 하나의 워커다|A lane is one wave's worker/);
    expect(lane).toMatch(/`writeSet`/);
    expect(lane).toMatch(/wave SDS 의 쓰기 집합이 아니다|not the wave SDS write set/);
    expect(flat(shared(rendering, "worktree-lane.md"))).toMatch(/`docs\/sds\/` 도 마찬가지다|nor under `docs\/sds\/`/);
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/wave-srs-registration.md: after SRS authoring comes the declaration update and scheduling", (rendering) => {
    const text = flat(shared(rendering, "wave-srs-registration.md"));
    expect(text).toMatch(/선언 갱신과 스케줄링|declaration update and scheduling/);
    expect(text).toMatch(/PW-2[^.]*`--sds`|`--sds`[^.]*PW-2/);
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/run-ledger.md: drift digest 3 covers declaration-entry digests, and the recipes keep registry paths out of files[]", (rendering) => {
    const text = flat(shared(rendering, "run-ledger.md"));
    expect(text).toMatch(/선언 항목 digest|declaration-entry digests/);
    for (const kind of ["orchestrator-only", "regenerate"]) {
      const row = gateRow(shared(rendering, "run-ledger.md"), kind);
      expect(row, `${rendering}: the ${kind} recipe does not keep the path out of files[]`).toContain("`files[]`");
    }
  });
});

describe("FR-FLOW-195 AC-8 — resume reads wave state through orchestrate wave status", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/parallel-waves.md §6", (rendering) => {
    const resume = flat(section(shared(rendering, "parallel-waves.md"), /^##\s*6\.\s/));
    expect(resume).toContain("speckiwi orchestrate wave status");
    expect(resume.includes('phase="worker"'), `${rendering}: resume still reads worker lines from waves.jsonl by hand`).toBe(false);
  });
});

describe("FR-FLOW-195 — kiwi-orchestrator's phase map cites the same schedule call as §V.freeze-lane-plan", () => {
  it.each(RENDERINGS.filter((rendering) => skillDirs(rendering).includes("kiwi-orchestrator")))("%s: the 3.e line carries --waves, --run-id, --lanes and --out", (rendering) => {
    const text = readRepoFile(`${rendering}/kiwi-orchestrator/SKILL.md`).replace(/\r\n/g, "\n");
    const map = text.split("\n").find((line) => /^\s+3\.e\s+freeze-lane-plan — orchestrate schedule waves/.test(line)) ?? "";
    expect(map, `${rendering}: the phase-map 3.e line`).not.toBe("");
    for (const flag of ["--waves docs/research/{work}/waves/waves.json", "--run-id {run_id}", "--lanes N", "--out docs/research/{work}/waves/stage-{s}/lanes.lock.json"]) {
      expect(map, `${rendering}: 3.e lacks ${flag}`).toContain(flag);
    }
  });
});
