import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, verbSection } from "./kiwi-orchestrator-variants.js";
import { digestOf, orchestrate, workGraphWorkspace } from "../cli/wave-graph-fixtures.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-222 — both skills write the 2.0.0 work graph and journal its reference, check it before
// scheduling and before each dispatch, run the completion actions the tool computes after each node
// completes, and read progress only through `orchestrate wave status`.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const shipped = (rels: string[]): string[] => rels.filter((rel) => existsSync(path.join(REPO_ROOT, rel)));
const DECOMPOSITION = RENDERINGS.map((root) => `${root}/_shared/kiwi/wave-decomposition.md`);
const PARALLEL = RENDERINGS.map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const EVENT = RENDERINGS.map((root) => `${root}/_shared/kiwi/waves-event.md`);
const LEDGER = RENDERINGS.map((root) => `${root}/_shared/kiwi/run-ledger.md`);
const ORCHESTRATOR = RENDERINGS.map((root) => `${root}/kiwi-orchestrator/SKILL.md`);
const SKILLS = [...shipped(RENDERINGS.map((root) => `${root}/kiwi-wave-master/SKILL.md`)), ...ORCHESTRATOR];

const korean = (rel: string): boolean => rel.startsWith("skills/claude/");

function step(text: string, n: number): string {
  const start = text.indexOf(`**PW-${n} ·`);
  if (start < 0) return "";
  const next = text.indexOf("**PW-", start + 6);
  return text.slice(start, next < 0 ? undefined : next);
}

/** The completion-action subsection of parallel-waves §5. */
function actions(text: string): string {
  const start = text.indexOf("\n### 5.1 ");
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start);
  return text.slice(start, next < 0 ? undefined : next);
}

describe("FR-FLOW-222 AC-1 — the graph reference is journalled and wave check gates scheduling and each dispatch", () => {
  it.each(DECOMPOSITION)("%s: §2 journals the committed graph on the run's first graph line", (rel) => {
    // @req FR-FLOW-222 AC-1
    const text = read(rel);
    // The first graph line, not the run's first line: kiwi-orchestrator journals its intake decision
    // before it decomposes, so "the first journal line" would name a line that cannot carry the graph.
    expect(text).toContain(
      "커밋한 그래프의 `graph {path, digest}`(digest 는 그래프 파일 바이트의 sha256)를 run 의 첫 graph 줄(그래프를 커밋한 뒤 처음 쓰는 저널 줄)에 싣는다"
    );
    expect(text).not.toContain("run 의 첫 저널 줄에 싣는다");
    // The quantifier is part of the rule: one error diagnostic is enough to hold the dispatch (verify r1).
    expect(text).toContain("error 진단이 하나라도 있으면 dispatch 하지 않고 그래프를 고쳐 다시 check 한다.");
    expect(text).toContain("`graph {path, digest}` 를 실은 `phase=\"redecompose\"` 줄");
  });

  it.each(EVENT)("%s: the graph row names the first graph line and the redecompose line, and the latest graph", (rel) => {
    // @req FR-FLOW-222 AC-1
    const row = read(rel).split("\n").find((line) => line.startsWith("| `graph` |")) ?? "";
    expect(row, `${rel}: no graph row`).not.toBe("");
    expect(row).toContain("run 의 첫 graph 줄(그래프를 커밋한 뒤 처음 쓰는 저널 줄)과 `redecompose` 줄에만 싣는다");
    expect(row).toContain("run 의 최신 그래프는 최신 `redecompose` 줄의 것, 없으면 첫 graph 줄의 것이다");
    expect(row).not.toContain("run 의 첫 줄과");
  });

  it.each(PARALLEL)("%s: PW-4 checks the graph before schedule waves and PW-5 before each dispatch", (rel) => {
    // @req FR-FLOW-222 AC-1
    const text = read(rel);
    const pw4 = step(text, 4);
    const check = "`speckiwi orchestrate wave check --waves {artifact_root}waves/waves.json --run-id {run_id} --json`";
    expect(pw4).toContain(check);
    expect(pw4.indexOf(check), `${rel}: wave check must come before the lock is written and frozen`).toBeLessThan(pw4.indexOf("lanes.freeze.json"));
    expect(pw4).toContain(korean(rel) ? "error 진단이 하나라도 있으면 lock 을 쓰지 않고 멈춘다" : "any error diagnostic stops the host before it writes a lock");
    expect(step(text, 5)).toContain(
      korean(rel)
        ? "dispatch 직전에 `orchestrate wave check` 를 다시 돌려 error 진단이 없을 때만 dispatch 한다"
        : "Right before each dispatch the host runs `orchestrate wave check` again and dispatches only when it reports no error diagnostic"
    );
  });
});

describe("FR-FLOW-222 AC-2 — after a node's complete line the host runs the due actions the tool computes", () => {
  it.each(PARALLEL)("%s: §5.1 calls wave actions and journals intent and result per due action", (rel) => {
    // @req FR-FLOW-222 AC-2
    const section = actions(read(rel));
    expect(section, `${rel}: §5.1 not found`).not.toBe("");
    const clauses = korean(rel)
      ? [
          "`speckiwi orchestrate wave actions --waves {artifact_root}waves/waves.json --run-id {run_id} --json`",
          "`due` 행동마다 도구가 준 intent 줄을 `orchestrate journal append` 로 쓰고, 행동을 수행하고, result 줄을 쓴다",
          "`sent` · `failed` · `waived`",
          "verb 는 `node-complete-action`",
          "`notify` 는 채널 별칭을 사용자의 전역 에이전트 지침에서 주소로 풀어 보낸다",
          "주소가 없는 별칭은 그 사유를 `error` 에 적어 `failed` 로 기록하고, 주소를 짐작하지 않는다"
        ]
      : [
          "`speckiwi orchestrate wave actions --waves {artifact_root}waves/waves.json --run-id {run_id} --json`",
          "for each `due` action, append the intent line the tool gave through `orchestrate journal append`, perform the action, then append its result line",
          "`sent` · `failed` · `waived`",
          "the verb is `node-complete-action`",
          "A `notify` is sent by resolving its channel alias to an address through the user's global agent instructions",
          "an alias with no address there is recorded `failed` with that reason in `error`, and no address is guessed"
        ];
    for (const clause of clauses) expect(section, `${rel}: ${clause}`).toContain(clause);
  });

  it.each(PARALLEL)("%s: the complete line carries done_when_confirmed and is followed by §5.1", (rel) => {
    // @req FR-FLOW-222 AC-2
    const text = read(rel);
    expect(text).toContain(
      korean(rel)
        ? "호스트가 확인한 완료 조건의 DW id 를 `done_when_confirmed` 로 싣는다"
        : "carrying in `done_when_confirmed` the DW ids the host confirmed"
    );
  });
});

describe("FR-FLOW-222 AC-2 — the host, and only the host, runs §5.1 after every complete line", () => {
  it.each(PARALLEL)("%s: the complete paragraph goes on to §5.1 unconditionally, and §5.1 is the host's alone", (rel) => {
    // @req FR-FLOW-222 AC-2 — each sentence is held whole, so a hedge ("필요하면") or a second actor
    // ("호스트나 워커") changes what the test reads (verify r1: both survived a looser match).
    const text = read(rel);
    if (korean(rel)) {
      expect(text).toContain("호스트가 확인한 완료 조건의 DW id 를 `done_when_confirmed` 로 싣는다. 이어서 §5.1 의 완료 행동을 돈다.");
      expect(actions(text)).toContain("워커는 저널을 쓰지 않으므로 완료 행동은 호스트만 한다.");
    } else {
      expect(text).toContain("carrying in `done_when_confirmed` the DW ids the host confirmed, and runs §5.1's completion actions.");
      expect(actions(text)).toContain("Workers never write the journal, so completion actions are the host's alone.");
    }
  });
});

describe("FR-FLOW-222 AC-3 — action failures and interruptions", () => {
  it.each(PARALLEL)("%s: non-blocking failures do not stop the run; blocking ones hold completion; interrupted ones are reported", (rel) => {
    // @req FR-FLOW-222 AC-3
    const section = actions(read(rel));
    const clauses = korean(rel)
      ? [
          "`blocking: false` 인 행동의 실패는 run 을 멈추지 않고 최종 보고에 적는다",
          "`blocking: true` 인 행동이 `failed` 인 동안 run 을 완료로 보고하지 않는다",
          "`interrupted` 행동은 자동으로 다시 보내지 않고 사용자에게 보고한다"
        ]
      : [
          "A failed action with `blocking: false` does not stop the run and is listed in the final report",
          "while an action with `blocking: true` is `failed`, the run is not reported complete",
          "An `interrupted` action is not re-sent automatically and is reported to the user"
        ];
    for (const clause of clauses) expect(section, `${rel}: ${clause}`).toContain(clause);
  });
});

describe("FR-FLOW-222 AC-4 — the node-complete-action verb is declared everywhere a verb is", () => {
  it.each(ORCHESTRATOR)("%s: §V.node-complete-action declares its recovery class and the tool", (rel) => {
    // @req FR-FLOW-222 AC-4
    const body = verbSection(read(rel), "node-complete-action");
    expect(body, `${rel}: no §V.node-complete-action`).not.toBe("");
    expect(body).toContain("recovery class **externally-visible**");
    expect(body).toContain("`speckiwi orchestrate wave actions`");
  });

  it.each(LEDGER)("%s: the verb table lists node-complete-action", (rel) => {
    // @req FR-FLOW-222 AC-4
    const row = read(rel).split("\n").find((line) => line.startsWith("| `node-complete-action` |")) ?? "";
    expect(row).toContain("| externally-visible |");
  });

  it.each(EVENT)("%s: the verb row names node-complete-action and its fields", (rel) => {
    // @req FR-FLOW-222 AC-4
    const text = read(rel);
    const verb = text.split("\n").find((line) => line.startsWith("| `verb` |")) ?? "";
    expect(verb).toContain("`node-complete-action`");
    for (const field of ["action_id", "completion_ref", "attempt", "result", "error", "graph", "done_when_confirmed"]) {
      expect(text.split("\n").some((line) => line.startsWith(`| \`${field}\` |`)), `${rel}: ${field} row`).toBe(true);
    }
  });
});

describe("FR-FLOW-222 AC-5 — progress and resume state come from wave status alone", () => {
  it.each(SKILLS)("%s: reads progress through orchestrate wave status and never the files by hand", (rel) => {
    // @req FR-FLOW-222 AC-5
    expect(read(rel)).toContain(
      "진행 상황과 재개 상태는 `speckiwi orchestrate wave status --json` 으로 읽고, `kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다"
    );
    expect(read(rel), `${rel}: the hand read of waves.jsonl on resume`).not.toContain("`./kiwi/waves.jsonl` 을 읽어 **첫 번째 미완료");
  });

  const WAVE_MASTER = shipped(RENDERINGS.map((root) => `${root}/kiwi-wave-master/SKILL.md`));
  it.each(WAVE_MASTER)("%s: the resume base is the wave status node row's base_sha, and the core rule names wave status only", (rel) => {
    // @req FR-FLOW-222 AC-5 — @req FR-FLOW-223 AC-1: one source of resume state (verify r7; IR-CLI-113 AC-11 adds base_sha).
    const text = read(rel);
    expect(text).toContain("진행 상황과 재개 상태(재개 커서의 dispatch base 는 노드 행의 `base_sha`)는 `speckiwi orchestrate wave status --json` 하나로 읽고,");
    expect(text).toContain("카드가 없는 본 스킬의 재개는 이 줄들을 `speckiwi orchestrate wave status --json` 으로 읽는다 — 노드 행이 그 노드의 최신 워커 줄의 `isolation.base_sha` 를 낸다(`parallel-waves.md §6`)");
    expect(text).toContain("진행 상황과 재개 상태는 `speckiwi orchestrate wave status --json` 으로 읽고, `kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다. wave 의 재개 base — `parallel-waves.md §6` 재개 커서가 쓰는 `<base_sha>` — 는 같은 출력의 노드 행 `base_sha`(그 노드의 최신 dispatch 줄의 `isolation.base_sha`)다. §5.5.1 의 `diff_window.base_sha` 는 이 값이 아니다 — 재진입 뒤에는 둘이 다르다(§5.5.1).");
    const resume = text.split("\n").find((line) => line.startsWith("- **재개**")) ?? "";
    const commands = [...resume.matchAll(/`((?:speckiwi orchestrate )?wave [a-z]+[^`]*)`/g)].map((match) => (match[1] ?? "").replace(/^speckiwi orchestrate /, ""));
    expect(commands, `${rel}: ${resume}`).toEqual(["wave status --json"]);
  });

  it.each(WAVE_MASTER)("%s: §5.5.1 opens the evidence window at the wave's first dispatch base, read with a complete command", (rel) => {
    // @req FR-FLOW-222 AC-5 — the evidence window holds every run of the wave, so it is not the resume base after a re-entry.
    expect(read(rel)).toContain("(`diff_window` 의 `base_sha` ~ `head_sha` — 대화 상태가 아니라 저널에서 읽는다: `base_sha` 는 그 wave 의 **첫** dispatch base — `speckiwi orchestrate wave show --wave wave-{n} --waves docs/analysis/kiwi-wave-master-{run_id}/waves/waves.json --run-id {run_id} --engine kiwi-wave-master --full --json` 의 저널 목록에서 `phase=\"worker\"` 인 가장 이른 줄의 `isolation.base_sha` — 이고, 창이 아래 표대로 그 wave 의 모든 run 을 담으므로 재진입이 있어도 옮기지 않아 재진입 뒤에는 최신 dispatch 의 것인 재개 base(§6, `wave status` 노드 행의 `base_sha`)와 다르며, `head_sha` 는 §5.5.6 대로 wave-verify 라운드 진입 시점의 HEAD 다)");
    expect(read(rel), `${rel}: a diff window resolved from waves.jsonl`).not.toMatch(/`waves\.jsonl` 에서 해소/);
  });

  it.each(PARALLEL)("%s: §6 reads the resume cursor's <base_sha> from the wave status row", (rel) => {
    // @req FR-FLOW-222 AC-5 — @req FR-FLOW-216 AC-3: the latest dispatch base, so a re-entry never resumes on the first one.
    const text = read(rel);
    expect(text).toContain(korean(rel) ? "워커의 재개 커서는 요구 ID trailer 커밋이다(`<base_sha>` 는 그 wave 의 최신 dispatch base 이고, 재개 카드를 쓰는 호출자는 `open[].base_sha` 에서, 카드가 없는 호출자(`kiwi-wave-master`)는 위 `wave status` 출력의 노드 행 `base_sha`(그 노드의 최신 dispatch 줄의 `isolation.base_sha`)에서 읽는다) — `REQ: <요구 ID>`" : "The worker's resume cursor is its requirement-ID trailer commits (`<base_sha>` is that wave's latest dispatch base: a caller that writes the resume card reads it from `open[].base_sha`, a caller without a card (`kiwi-wave-master`) from the node row's `base_sha` in the `wave status` output above — the `isolation.base_sha` of that node's latest dispatch line) — a requirement whose commit");
    expect(text).toContain(korean(rel) ? "wave 마다 최신 `status` · `phase` · `sds_id` · `stage` · `lane` · `base_sha` 와 `ready[]` 를 도구가 낸다." : "the tool reports each wave's latest `status` · `phase` · `sds_id` · `stage` · `lane` · `base_sha` and the `ready[]` set.");
    expect(text, `${rel}: a second source of the resume base`).not.toMatch(/wave show[^`]*--full --json` 의 저널 목록|journal list of `speckiwi orchestrate wave show/);
  });

  it.each(WAVE_MASTER)("%s: run as written after a re-entry, the resume base is the re-entry's and the window base the first dispatch's", async (rel) => {
    // @req FR-FLOW-216 AC-3 — @req FR-FLOW-222 AC-5
    const text = read(rel);
    const show = /`speckiwi orchestrate (wave show --wave wave-\{n\} --waves [^`]+ --full --json)`/.exec(text)?.[1] ?? "";
    expect(show, `${rel}: §5.5.1 wave show command`).not.toBe("");
    const fill = (command: string): string[] =>
      command.replaceAll("{run_id}", "r1").replaceAll("{n}", "1").split(/\s+/).filter((token) => token.length > 0 && token !== "--json");
    const graphPath = "docs/analysis/kiwi-wave-master-r1/waves/waves.json";
    const graph = { schema_version: "2.0.0", run_id: "r1", title: "g", scope: { target: "v1.0.0" }, nodes: [{ wave: "wave-1", title: "n", purpose: "p", acs: ["FR-ARCH-001 AC-1"], done_when: [], files: ["src/a.ts"] }], edges: [] };
    const graphText = `${JSON.stringify(graph, null, 2)}\n`;
    const { root } = await workGraphWorkspace({ requirements: [{ id: "FR-ARCH-001", acs: [{ n: 1 }] }], noJournal: true, files: { [graphPath]: graphText, "src/a.ts": "export const a = 1;\n" } });
    const line = (extra: Record<string, unknown>): string[] => ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify({ schema_version: "2.0.0", run_id: "r1", engine: "kiwi-wave-master", wave: "wave-1", order: 1, target: "v1.0.0", ...extra })];
    await orchestrate(root, line({ ts: "2026-11-05T00:00:00.000Z", status: "pending", summary: "graph", graph: { path: graphPath, digest: digestOf(graphText) } }));
    // The first dispatch (base B0), then a re-entry r1 (base B1), each with its worker line (§5.5.6).
    await orchestrate(root, line({ ts: "2026-11-05T01:00:00.000Z", status: "in_progress", phase: "worker", lane: "lane-r1-wave-1", stage: 1, sds_id: "r1-wave-1", summary: "d1", isolation: { base_sha: "B0" } }));
    await orchestrate(root, line({ ts: "2026-11-05T02:00:00.000Z", status: "in_progress", phase: "worker", lane: "lane-r1-wave-1", stage: 2, sds_id: "r1-wave-1-r1", summary: "d2", isolation: { base_sha: "B1" } }));

    const status = await orchestrate(root, ["wave", "status", "--waves", graphPath, "--run-id", "r1", "--engine", "kiwi-wave-master"]);
    expect(status.exit, JSON.stringify(status.payload)).toBe(0);
    const row = (status.payload.waves as Array<Record<string, unknown>>).find((wave) => wave.wave === "wave-1");
    expect(row?.base_sha, `${rel}: the resume base`).toBe("B1");

    const shown = await orchestrate(root, ["wave", "show", ...fill(show).slice(2)]);
    expect(shown.exit, JSON.stringify(shown.payload)).toBe(0);
    const journal = ((shown.payload.nodes as Array<Record<string, unknown>>)[0]?.journal ?? []) as Array<Record<string, unknown>>;
    const firstWorker = journal.find((entry) => entry.phase === "worker") as { isolation?: { base_sha?: string } } | undefined;
    expect(firstWorker?.isolation?.base_sha, `${rel}: the evidence window base`).toBe("B0");
  });
});
