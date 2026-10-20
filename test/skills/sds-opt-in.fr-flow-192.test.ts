import { describe, expect, it } from "vitest";

import { section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, readRepoFile, scanUnits, skillDirs, skillFiles, unitAt } from "./kiwi-renderings.js";

// @req FR-FLOW-192 — SDS authoring and consumption is opt-in in every kiwi skill.
//
// Each rendering is read on its own bytes, the `.agents` mirror included (it carries the codex text
// and goes red until `speckiwi skills mirror --write` regenerates it; kiwi-step and kiwi-wave-master
// are excluded from it, so a skill is checked only where the rendering ships it). Prose checks carry
// both spellings, because claude is Korean and codex/etc are English in some skills and Korean in
// others.

/** The opt-in a condition may name: `--sds` (not `--sds-id`), a user-given `--sds-id`, or `SDS_PATH`. */
const OPT_IN = /--sds(?![-\w])|--sds-id|SDS_PATH/;

const OPTION_SKILLS = ["kiwi-pipeline", "kiwi-orchestrator", "kiwi-wave-master", "kiwi-tdd", "kiwi-step", "kiwi-pm", "kiwi-coder"] as const;
const PATH_SKILLS = new Set(["kiwi-pm", "kiwi-coder"]);
const TRIGGERS = ["SDS 로", "SDS 써서", "SDS 를 써", "use SDS", "with an SDS"];
const NO_OPT_IN =
  /opt-in 이 없으면[^|]*SDS 를 쓰지 않고[^|]*SDS 로 구현하지도 않는다|[Ww]ithout the opt-in[^|]*writes no SDS[^|]*implements from none/;
const WEAKER =
  /SDS 는 기존 코드에서 약한 구현 모델을 도울 수 있으나 자동으로 켜지 않는다|an SDS can help a weaker implementer on existing code, but it is not switched on automatically/i;

function ships(rendering: string, skill: string): boolean {
  return skillDirs(rendering).includes(skill);
}

function rowsOf(rendering: string, skill: string): string[] {
  return skillFiles(rendering, skill).flatMap((doc) => tableRows(doc.text).map((row) => row.cells.join(" | ")));
}

describe("FR-FLOW-192 AC-1 — the option tables declare --sds, map the requests in words to it, and §0 states the default", () => {
  for (const skill of OPTION_SKILLS) {
    it.each(RENDERINGS.filter((rendering) => ships(rendering, skill)))(`%s/${skill}: an option row declares the opt-in with default off`, (rendering) => {
      const flag = PATH_SKILLS.has(skill) ? "`--sds <path>`" : "`--sds`";
      const row = rowsOf(rendering, skill).find((entry) => entry.includes(flag) && TRIGGERS.every((trigger) => entry.includes(trigger)));
      expect(row, `${rendering}/${skill}: no option row maps ${TRIGGERS.join(" / ")} to ${flag}`).toBeDefined();
      const cells = (row ?? "").split(" | ");
      expect(cells[cells.length - 1], `${rendering}/${skill}: the opt-in default is not off`).toMatch(/^off\b/);
      if (PATH_SKILLS.has(skill)) {
        expect(row, `${rendering}/${skill}: SDS_PATH= is not stated as an alias of --sds <path>`).toMatch(/`SDS_PATH=<path>`[^|]*(별칭|alias)/);
      }
      if (skill === "kiwi-pm" || skill === "kiwi-pipeline") {
        expect(WEAKER.test(row ?? ""), `${rendering}/${skill}: the option row does not say what an SDS helps with and that it is never switched on automatically`).toBe(true);
      }
    });

    it.each(RENDERINGS.filter((rendering) => ships(rendering, skill)))(`%s/${skill}: §0 states that without the opt-in the run writes no SDS and implements from none`, (rendering) => {
      const rules = skillFiles(rendering, skill)
        .map((doc) => section(stripFrontmatter(doc.text), /^##\s*0\.\s/))
        .join("\n");
      expect(rules, `${rendering}/${skill}: no §0`).not.toBe("");
      const row = tableRows(rules).find((entry) => NO_OPT_IN.test(entry.cells.join(" | ")));
      expect(row, `${rendering}/${skill}: §0 has no rule stating the no-opt-in default`).toBeDefined();
      expect(OPT_IN.test(row?.cells.join(" | ") ?? ""), `${rendering}/${skill}: the §0 rule does not name the opt-in`).toBe(true);
    });
  }
});

/** What AC-2 sweeps: a kiwi-sds call, or a step that authors an SDS or derives a write set from one. */
const SDS_CALL = /Skill\(\{\s*skill:\s*"kiwi-sds"[^)]*\}\)|Skill\(skill="kiwi-sds"[^)]*\)/g;
const CALL_LINE = /^\s*(?:[-*]\s+|\d+\.\s+)?`?[/$]kiwi-sds(?:\s+[-A-Z{<]|`?\s*$)/;
const TOKENS = /SDS authoring|SDS 저작|SDS write set|SDS 쓰기 집합|PW-2|sds-wave/;

interface Site {
  readonly relPath: string;
  readonly where: string;
  readonly text: string;
}

/**
 * Every unit of every non-kiwi-sds skill and shared contract that invokes kiwi-sds or names an SDS
 * authoring step, with the condition it is read under: the unit itself (a kiwi-sds call's own
 * arguments removed, since `--sds-id` there names the SDS, not the condition), every heading above it,
 * and — for a fenced call — the paragraph that introduces the fence.
 */
function sites(rendering: string): Array<Site & { conditioned: boolean }> {
  const out: Array<Site & { conditioned: boolean }> = [];
  const docs = [
    ...skillDirs(rendering)
      .filter((skill) => skill !== "kiwi-sds")
      .flatMap((skill) => skillFiles(rendering, skill)),
    ...skillFiles(rendering, "_shared")
  ];
  for (const doc of docs) {
    const units = scanUnits(doc.text);
    const headings: string[] = [];
    let previous = "";
    for (const unit of units) {
      const heading = /^(#{1,6})\s/.exec(unit.text);
      if (heading !== null) {
        const depth = (heading[1] as string).length;
        headings.length = Math.min(headings.length, depth - 1);
        headings[depth - 1] = unit.text;
        previous = "";
        continue;
      }
      const lines = doc.text.split("\n").slice(unit.startLine - 1, unit.endLine);
      const hit = SDS_CALL.test(unit.text) || lines.some((line) => CALL_LINE.test(line)) || TOKENS.test(unit.text);
      SDS_CALL.lastIndex = 0;
      if (hit) {
        const own = unit.text.replace(SDS_CALL, "").replace(/`[/$]kiwi-sds[^`]*`/g, "");
        const context = [own, ...headings.filter((entry) => entry !== undefined), unit.text.startsWith("```") ? previous : ""];
        out.push({ relPath: doc.relPath, where: unitAt(unit, "file"), text: unit.text.slice(0, 160), conditioned: context.some((entry) => OPT_IN.test(entry)) });
      }
      previous = unit.text;
    }
  }
  return out;
}

describe("FR-FLOW-192 AC-2 — no skill but kiwi-sds calls kiwi-sds or authors an SDS outside a section that names the opt-in", () => {
  it.each(RENDERINGS)("%s: every kiwi-sds call and SDS-authoring step sits under a stated --sds condition", (rendering) => {
    const found = sites(rendering);
    expect(found.length, `${rendering}: the sweep found no site at all — the tokens or the corpus moved`).toBeGreaterThan(0);
    const bare = found.filter((site) => !site.conditioned).map((site) => `${site.relPath} ${site.where}: ${site.text}`);
    expect(bare, `${rendering}: SDS sites without an opt-in condition`).toEqual([]);
  });
});

/** The unit (block or table row) of `text` that matches `re`, joined as a reader sees it. */
function unitWith(text: string, re: RegExp): string {
  return scanUnits(text).find((unit) => re.test(unit.text))?.text ?? "";
}

function whole(rendering: string, skill: string): string {
  return skillFiles(rendering, skill)
    .map((doc) => doc.text)
    .join("\n\n");
}

/** Every `--sds-id` in `text` sits within `radius` characters of a statement that the run already opted in. */
const ALREADY = /이미 (?:`--sds` 로 )?opt-in 한 (?:run|실행)|already opted in/g;
function sdsIdOnlyWhenOptedIn(text: string, radius = 80): string[] {
  const conditions = [...text.matchAll(ALREADY)].map((m) => m.index ?? 0);
  return [...text.matchAll(/--sds-id/g)]
    .map((m) => m.index ?? 0)
    .filter((at) => !conditions.some((c) => Math.abs(c - at) <= radius))
    .map((at) => text.slice(Math.max(0, at - 60), at + 60));
}

describe("FR-FLOW-192 AC-3 — a user-given --from=sds or --sds-id is --sds, the opt-in is passed on, and re-entry never adds it on its own", () => {
  it.each(RENDERINGS)("%s/kiwi-pipeline: --from=sds and --sds-id are read as --sds", (rendering) => {
    const text = flat(whole(rendering, "kiwi-pipeline"));
    expect(text).toMatch(/`--from=sds`[^.|]{0,60}`--sds-id`[^.|]{0,80}`--sds` 로 본다|`--from=sds` or `--sds-id` as `--sds`/);
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: the opt-in reaches kiwi-tdd, kiwi-pm (one call per SDS file) and the review hop", (rendering) => {
    const routing = section(whole(rendering, "kiwi-pipeline"), /^###\s*2\.8\.2\s/);
    expect(unitWith(routing, /`kiwi-tdd`[^]*`--sds`|`--sds`[^]*`kiwi-tdd`/), `${rendering}: §2.8.2 does not pass --sds to kiwi-tdd`).not.toBe("");
    const branch = flat(section(whole(rendering, "kiwi-pipeline"), /^###\s*2\.5\.5\s/));
    expect(branch, `${rendering}: kiwi-pipeline has no §2.5.5 --sds branch`).toMatch(/--sds/);
    expect(branch, `${rendering}: the --sds branch does not call kiwi-pm with --sds <file>`).toMatch(/kiwi-pm --sds docs\/sds\/<sds-id>\.sds\.md/);
    expect(branch, `${rendering}: the --sds branch does not run kiwi-pm once per SDS file`).toMatch(/SDS (파일)?마다 (한 번씩|한 번)|once per SDS file/);
    expect(branch, `${rendering}: the review hop does not receive --sds`).toMatch(/kiwi-review-fix-loop --close-reqs \[?--sds/);
  });

  it.each(RENDERINGS)("%s/kiwi-orchestrator: R-STEP passes --sds to kiwi-tdd, and its test-sufficiency check takes design.md only under --sds", (rendering) => {
    const text = whole(rendering, "kiwi-orchestrator");
    // The invocation string itself is FR-FLOW-099 AC-2's exact text, so the opt-in is stated beside it.
    const rstep = section(text, /^####\s*4\.5\.1\b/m);
    expect(rstep, `${rendering}: kiwi-orchestrator has no §4.5.1`).toContain('Skill({ skill: "kiwi-tdd"');
    expect(flat(rstep), `${rendering}: the R-STEP kiwi-tdd call is not given --sds on an opted-in run`).toMatch(/run 이 `--sds` 로 시작했으면 위 args 에 `--sds` 를 더한다/);
    const design = scanUnits(text).filter((unit) => /--sds docs\/spec\/steps\/<task>\/design\.md/.test(unit.text));
    expect(design.length, `${rendering}: the R-STEP test-sufficiency call with design.md is gone`).toBeGreaterThan(0);
    for (const unit of design) {
      expect(unit.text, `${rendering} ${unitAt(unit)}: design.md is passed without the opt-in condition`).toMatch(/opt-in|`--sds` (로 시작한|로 시작했으면|를 받은|가 있을 때|일 때)|under `--sds`|only when the run opted in/);
    }
  });

  it.each(RENDERINGS.filter((rendering) => ships(rendering, "kiwi-wave-master")))("%s/kiwi-wave-master: passes --sds to its per-wave calls", (rendering) => {
    expect(unitWith(whole(rendering, "kiwi-wave-master"), /`--sds`[^|]*(wave 마다|per-wave|parallel-waves)/), `${rendering}: kiwi-wave-master does not pass --sds on`).not.toBe("");
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/verify-loop.md: the re-entry carries --req-filter and kiwi-pm --run-id, and --sds-id only when the run opted in", (rendering) => {
    const text = readRepoFile(`${rendering}/_shared/kiwi/verify-loop.md`).replace(/\r\n/g, "\n");
    const reentry = scanUnits(text).filter((unit) => /재진입|re-entry|re-enter/i.test(unit.text) && /--req-filter/.test(unit.text));
    expect(reentry.length, `${rendering}: verify-loop.md has no re-entry unit carrying --req-filter`).toBeGreaterThan(0);
    expect(reentry.some((unit) => /--run-id/.test(unit.text)), `${rendering}: the re-entry does not pass kiwi-pm --run-id`).toBe(true);
    for (const unit of reentry) {
      expect(sdsIdOnlyWhenOptedIn(unit.text), `${rendering} ${unitAt(unit)}: --sds-id is added to a re-entry without the opt-in condition`).toEqual([]);
    }
  });

  it.each(RENDERINGS)("%s/kiwi-orchestrator: the missing-task remediation adds --sds-id only on a run that opted in", (rendering) => {
    const units = scanUnits(whole(rendering, "kiwi-orchestrator")).filter((unit) => /missing-task/.test(unit.text) && /--req-filter/.test(unit.text));
    expect(units.length, `${rendering}: no missing-task remediation unit carrying --req-filter`).toBeGreaterThan(0);
    for (const unit of units) {
      expect(unit.text, `${rendering}: the remediation does not pass kiwi-pm --run-id`).toMatch(/--run-id/);
      expect(sdsIdOnlyWhenOptedIn(unit.text)).toEqual([]);
    }
  });
});

const SDS_GATES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["sds-check-errors-unresolved", ["kiwi-sds"]],
  ["sha-mismatch-on-resume", ["kiwi-pm"]],
  ["zero-tolerance-sds-code-mismatch", ["kiwi-coder"]],
  ["plan-code-divergence-critical", ["_shared/kiwi/auto-option.md"]],
  ["tdd-bypass-attempt", ["kiwi-coder"]],
  ["sds-architecture-decision-approval", ["kiwi-tdd"]]
];
const SDS_RUN_ONLY = /SDS 가 있는 run 에서만|only on a run that has an SDS/;

describe("FR-FLOW-192 AC-4 — the SDS-keyed gates stay declared and say they fire only on a run that has an SDS", () => {
  for (const [gate, owners] of SDS_GATES) {
    it.each(RENDERINGS)(`%s: ${gate}`, (rendering) => {
      const docs = owners.flatMap((owner) =>
        owner.endsWith(".md") ? [{ relPath: `${rendering}/${owner}`, text: readRepoFile(`${rendering}/${owner}`).replace(/\r\n/g, "\n") }] : skillFiles(rendering, owner)
      );
      const declarations = docs.flatMap((doc) =>
        scanUnits(doc.text, { splitListItems: true })
          // A declaration: the gate as a table row's first cell, a list item's head, or a bold label's subject.
          .filter((unit) => new RegExp(String.raw`^(?:\|\s*` + "`" + gate + "`" + String.raw`\s*\||-\s+` + "`" + gate + "`" + String.raw`|\*\*[^*]+\*\*:\s*` + "`" + gate + "`)").test(unit.text))
          .map((unit) => ({ where: `${doc.relPath} ${unitAt(unit, "file")}`, text: unit.text }))
      );
      expect(declarations.length, `${rendering}: ${gate} is no longer declared`).toBeGreaterThan(0);
      for (const declaration of declarations) {
        expect(SDS_RUN_ONLY.test(declaration.text), `${declaration.where}: ${gate} does not say it fires only on a run with an SDS`).toBe(true);
      }
    });
  }
});

function rowFor(table: string, last: RegExp): string {
  return tableRows(table).find((row) => last.test(row.cells[0] ?? ""))?.cells.join(" | ") ?? "";
}

describe("FR-FLOW-192 AC-5 — the routing tables send feasibility to kiwi-pm and kiwi-pm/kiwi-coder to the review; kiwi-sds rows are conditional", () => {
  const tables = (rendering: string): Array<[string, string]> => [
    ["pipeline-event.md §4", section(readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`).replace(/\r\n/g, "\n"), /^##\s*4\.\s/)],
    ["pipeline-v1.md Routing", section(readRepoFile(`${rendering}/_shared/kiwi/pipeline-v1.md`).replace(/\r\n/g, "\n"), /^##\s*Routing/)]
  ];

  it.each(RENDERINGS)("%s: feasibility → kiwi-pm, and kiwi-sds only when the invocation carries --sds", (rendering) => {
    for (const [name, table] of tables(rendering)) {
      const row = rowFor(table, /kiwi-srs-feasibility/);
      expect(row, `${rendering} ${name}: no feasibility row`).not.toBe("");
      expect(row, `${rendering} ${name}: feasibility does not route to kiwi-pm`).toMatch(/kiwi-pm/);
      for (const at of [...row.matchAll(/kiwi-sds/g)].map((m) => m.index ?? 0)) {
        expect(/--sds(?![-\w])/.test(row.slice(Math.max(0, at - 80), at + 80)), `${rendering} ${name}: the kiwi-sds hint is not tied to --sds`).toBe(true);
      }
    }
  });

  it.each(RENDERINGS)("%s: kiwi-pm and kiwi-coder → kiwi-review-fix-loop, and kiwi-sds --close only when artifacts.sds_files is non-empty", (rendering) => {
    for (const [name, table] of tables(rendering)) {
      for (const skill of [/^`?kiwi-pm`?$/, /^`?kiwi-coder`?/]) {
        const row = rowFor(table, skill);
        expect(row, `${rendering} ${name}: no ${skill} row`).not.toBe("");
        expect(row).toMatch(/kiwi-review-fix-loop/);
        if (row.includes("kiwi-sds")) {
          expect(row, `${rendering} ${name}: the close-out hint is not keyed on artifacts.sds_files`).toMatch(/artifacts\.sds_files/);
        }
      }
    }
  });

  it.each(RENDERINGS)("%s: kiwi-sds stays in the skill enum", (rendering) => {
    const enumBlock = section(readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`).replace(/\r\n/g, "\n"), /^##\s*3\.\s/);
    expect(enumBlock.split("\n").map((line) => line.trim())).toContain("kiwi-sds");
  });
});

describe("FR-FLOW-192 AC-6 — kiwi-sds says it runs only on request and is no default stage", () => {
  const ONLY_ON_REQUEST = /사용자가 직접 부르거나 호출자가 opt-in 을 넘길 때만 돈다|[Rr]uns only when the user invokes it or a caller passes the opt-in/;
  const NOT_DEFAULT = /어느 체인의 기본 단계도 아니다|not a default stage of any chain/;
  const LATER_USE = /사용자가 `--sds <path>` 로 넘기거나 요청할 때만|only when the user passes it \(`--sds <path>`\) or asks for it/;

  it.each(RENDERINGS)("%s/kiwi-sds: the description states it", (rendering) => {
    const front = /^---\n([\s\S]*?)\n---/.exec(readRepoFile(`${rendering}/kiwi-sds/SKILL.md`).replace(/\r\n/g, "\n"))?.[1] ?? "";
    const description = /description:\s*(.*)/.exec(front)?.[1] ?? "";
    expect(description).toMatch(ONLY_ON_REQUEST);
    expect(description).toMatch(NOT_DEFAULT);
  });

  it.each(RENDERINGS)("%s/kiwi-sds: §0 states it, and that a later run uses the SDS only when the user passes it", (rendering) => {
    const rules = flat(section(stripFrontmatter(readRepoFile(`${rendering}/kiwi-sds/SKILL.md`).replace(/\r\n/g, "\n")), /^##\s*0\.\s/));
    expect(rules).toMatch(ONLY_ON_REQUEST);
    expect(rules).toMatch(NOT_DEFAULT);
    expect(rules).toMatch(LATER_USE);
  });
});
