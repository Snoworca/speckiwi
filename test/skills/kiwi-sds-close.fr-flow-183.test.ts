import { describe, expect, it } from "vitest";

import { criticalGateRows, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, readRepoFile, skillSection } from "./kiwi-renderings.js";

// @req FR-FLOW-183 — the SDS is disposable: its close-out moves the durable content into the SRS
// before the run promotes, and deletes the file after.
//
// The close-out is `kiwi-sds --close <sds-id>`, defined once in kiwi-sds §3 and cited by the
// workflows. Read by its numbered subsections: §3.1 moves (before promotion), §3.2 deletes (after).

function body(rendering: string): string {
  return stripFrontmatter(readRepoFile(`${rendering}/kiwi-sds/SKILL.md`).replace(/\r\n/g, "\n"));
}

function part(rendering: string, heading: RegExp): string {
  return section(body(rendering), heading);
}

/** Paragraphs and list items, whitespace flattened, so a rule is read inside the block that states it. */
function blocks(text: string): string[] {
  return text
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/)
    .map((block) => flat(block).trim())
    .filter((block) => block !== "");
}

const NEGATION = /없다|않는다|않고|않으며|하지 않|지우지 않|금지|\bno\b|\bnot\b|\bnever\b|\bwithout\b/i;

/** The sentences of rows or blocks, so a rule and its negation are read in the one sentence stating it. */
function sentences(texts: readonly string[]): string[] {
  return texts.flatMap((text) => text.split(/(?<=\.)\s+|\s\|\s/)).map((sentence) => sentence.trim());
}

describe("FR-FLOW-183 AC-1 — --close rewrites each interpreting SDS-AC as a clarification of its SRS AC", () => {
  it.each(RENDERINGS)("%s: --close <sds-id> is an input and owns its own section", (rendering) => {
    const inputs = tableRows(part(rendering, /^###\s*1\.1\b/)).map((row) => row.cells.join(" | "));
    expect(inputs.some((row) => row.includes("`--close <sds-id>`")), `${rendering}: no --close <sds-id> input row`).toBe(true);
    expect(part(rendering, /^##\s*3\./), `${rendering}: no §3 close-out section`).toContain("--close <sds-id>");
  });

  it.each(RENDERINGS)("%s: the clarification goes through the guarded mutation with the AC list intact", (rendering) => {
    const move = blocks(part(rendering, /^###\s*3\.1\b/));
    const step = move.find((block) => block.includes("replace_acceptance_criteria"));
    expect(step, `${rendering}: §3.1 does not write through replace_acceptance_criteria`).toBeDefined();
    const text = step ?? "";
    expect(/`checked`/.test(text) && /순서|order/i.test(text), `${rendering}: the rewrite does not keep every AC in order with its checked value`).toBe(
      true
    );
    expect(/dryRun/.test(text), `${rendering}: the rewrite does not dry-run first`).toBe(true);
  });

  it.each(RENDERINGS)("%s: the clarification never weakens the AC", (rendering) => {
    const move = sentences(blocks(part(rendering, /^###\s*3\.1\b/)));
    expect(
      move.some((sentence) => /약화|weaken/i.test(sentence) && NEGATION.test(sentence) && /SHALL/.test(sentence)),
      `${rendering}: §3.1 does not forbid a weakening clarification`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: moving happens before promotion, and a promoted requirement stops the close-out", (rendering) => {
    const heading = body(rendering).split("\n").find((line) => /^###\s*3\.1\b/.test(line)) ?? "";
    expect(/승급 전|before promotion/i.test(heading), `${rendering}: §3.1 is not the before-promotion step`).toBe(true);
    const gates = criticalGateRows(body(rendering)).map((row) => row.gateId);
    expect(gates).toContain("sds-close-after-promotion");
    expect(gates, `${rendering}: the SRS written by the close-out is not validated`).toContain("validate-spec-error");
    expect(gates, `${rendering}: a frozen requirement's AC can be rewritten without a halt`).toContain("stability-frozen-violation");
    const move = blocks(part(rendering, /^###\s*3\.1\b/));
    const verifiedStep = move.find((block) => block.includes("`verified`") && block.includes("`sds-close-after-promotion`")) ?? "";
    expect(verifiedStep, `${rendering}: §3.1 has no step halting on an already verified requirement`).not.toBe("");
    expect(/사용자|user/i.test(verifiedStep) && /`closed`/.test(verifiedStep), `${rendering}: the halt names no user resolution that lets the SDS close`).toBe(true);
    // Both halts are checked before anything is written, so a halt never leaves half the ACs rewritten.
    expect(
      /`frozen`/.test(verifiedStep) && /`stability-frozen-violation`/.test(verifiedStep),
      `${rendering}: the frozen gate is not checked with the verified gate, before any write`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: the clarification only appends — every word of the existing AC stays", (rendering) => {
    const move = sentences(blocks(part(rendering, /^###\s*3\.1\b/)));
    expect(
      move.some((sentence) => /한 글자도 지우지 않고|keep every word/i.test(sentence) && /덧붙인다|append/i.test(sentence)),
      `${rendering}: §3.1 does not keep the existing AC text and append to it`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: a split SDS is closed through its base id, never read as already closed", (rendering) => {
    const intro = flat(part(rendering, /^##\s*3\./).split(/\n###\s/)[0] ?? "");
    expect(intro, `${rendering}: §3 does not handle the split files of an SDS`).toContain("<sds-id>-<k>");
  });
});

describe("FR-FLOW-183 AC-2 — only a structural rule marked durable becomes an SRS constraint requirement", () => {
  it.each(RENDERINGS)("%s: the author marks durable rules in their own section", (rendering) => {
    const authoring = blocks(part(rendering, /^##\s*2\./));
    expect(
      authoring.some((block) => block.includes("`## Durable Rules`") && /구조 규칙|structural rule/i.test(block)),
      `${rendering}: the authoring rules do not say where a durable structural rule is marked`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: the close-out raises each durable rule as a constraint requirement and copies nothing else", (rendering) => {
    const move = blocks(part(rendering, /^###\s*3\.1\b/));
    const step = move.find((block) => block.includes("`## Durable Rules`") && block.includes("add_requirement"));
    expect(step, `${rendering}: §3.1 does not raise the durable rules through add_requirement`).toBeDefined();
    expect(/`constraint`/.test(step ?? ""), `${rendering}: the raised requirement is not a constraint`).toBe(true);
    expect(
      /(?:없는 구조 규칙은 옮기지 않는다|structural rule not (?:listed|marked)[^.]*is not (?:moved|copied))/i.test(step ?? ""),
      `${rendering}: §3.1 does not refuse to copy an unmarked structural rule`
    ).toBe(true);
  });
});

describe("FR-FLOW-183 AC-3 — the file is deleted after promotion; git history keeps it", () => {
  it.each(RENDERINGS)("%s: §3.2 deletes the file once every @req requirement is promoted", (rendering) => {
    const heading = body(rendering).split("\n").find((line) => /^###\s*3\.2\b/.test(line)) ?? "";
    expect(/승급 뒤|after promotion/i.test(heading), `${rendering}: §3.2 is not the after-promotion step`).toBe(true);
    const text = flat(part(rendering, /^###\s*3\.2\b/));
    const promoted = blocks(part(rendering, /^###\s*3\.2\b/)).find((block) => block.includes("`verified`")) ?? "";
    expect(promoted, `${rendering}: §3.2 has no step keyed on the requirements being verified`).not.toBe("");
    expect(/^\d+\.\s+(?:모두 |When all are )/.test(promoted), `${rendering}: the deletion is not conditioned on every requirement being closed`).toBe(true);
    expect(
      /파일을 작업 트리에서 \*{0,2}지운다|\*{0,2}delete\*{0,2} the SDS file/i.test(promoted),
      `${rendering}: the verified step of §3.2 does not delete the file`
    ).toBe(true);
    expect(/close-out 커밋|close-out commit/i.test(text), `${rendering}: the deletion is not carried by the close-out commit`).toBe(true);
    expect(/git 기록|git history/i.test(text), `${rendering}: §3.2 does not say git history keeps the file`).toBe(true);
  });

  it.each(RENDERINGS)("%s: each workflow's close-out order is stated — move before the promoting hop, delete after", (rendering) => {
    const order = tableRows(part(rendering, /^###\s*3\.4\b/)).map((row) => row.cells.join(" | "));
    const pipeline = order.find((row) => row.includes("`kiwi-pipeline`"));
    expect(pipeline, `${rendering}: §3.4 has no kiwi-pipeline row`).toBeDefined();
    expect(pipeline ?? "").toContain("`kiwi-review-fix-loop --close-reqs`");
    const moveCell = pipeline?.split(" | ")[1] ?? "";
    expect(/홉 \*\*앞\*\*|\*\*before\*\* the/.test(moveCell), `${rendering}: the pipeline move is not placed before the promoting hop`).toBe(true);
    expect(order.some((row) => row.includes("`kiwi-orchestrator`") && row.includes("parallel-waves.md")), `${rendering}: §3.4 has no orchestrator row`).toBe(
      true
    );
  });

  it.each(RENDERINGS)("%s: standalone kiwi-pm is a caller — it moves before its own promoting review and deletes only after a move", (rendering) => {
    const order = tableRows(part(rendering, /^###\s*3\.4\b/));
    const pm = order.find((row) => (row.cells[0] ?? "").startsWith("`kiwi-pm`"));
    expect(pm, `${rendering}: §3.4 has no standalone kiwi-pm row`).toBeDefined();
    const [caller = "", move = "", remove = ""] = pm?.cells ?? [];
    expect(caller, `${rendering}: the row names the standalone mode it covers`).toMatch(/standalone|단독/);
    expect(move, `${rendering}: the move sits in kiwi-pm's §6.4 hand-off`).toContain("§6.4");
    expect(/\*\*before\*\*|\*\*앞\*\*/.test(move), `${rendering}: the move is not placed before the promoting review`).toBe(true);
    expect(move, `${rendering}: the move is conditional on CLOSE_SAFE`).toContain("CLOSE_SAFE");
    expect(/after|뒤/.test(remove), `${rendering}: the delete is not placed after the review`).toBe(true);
    expect(remove, `${rendering}: the delete runs only when the move happened`).toContain("MOVED");
  });
});

describe("FR-FLOW-183 AC-4 — a closed SDS is never the current design, and no permanent drift gate exists", () => {
  it.each(RENDERINGS)("%s: a closed or deleted SDS is not read as the current design; the code is", (rendering) => {
    const rules = tableRows(section(body(rendering), /^##\s*0\./))
      .filter((entry) => /^§0\.\d+$/.test(entry.cells[0] ?? ""))
      .map((entry) => entry.cells.join(" | "));
    const row = rules.find((entry) => /현재 설계|current design/i.test(entry));
    expect(row, `${rendering}: no §0 rule about the current design`).toBeDefined();
    const said = sentences([row ?? ""]);
    expect(said.some((sentence) => /`closed`/.test(sentence) && NEGATION.test(sentence)), `${rendering}: the §0 rule reads a closed SDS as current`).toBe(true);
    expect(said.some((sentence) => /코드다|is the code/i.test(sentence)), `${rendering}: the §0 rule does not name the code as the current design`).toBe(true);
    expect(
      said.some((sentence) => /영구|permanent/i.test(sentence) && /드리프트|drift/i.test(sentence) && NEGATION.test(sentence)),
      `${rendering}: the §0 rule does not refuse a permanent drift gate`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: authoring refuses to write into a closed SDS id", (rendering) => {
    const scope = tableRows(part(rendering, /^###\s*2\.1\b/)).map((row) => row.cells.join(" | "));
    const closed = scope.find((row) => /^`closed`/.test(row));
    expect(closed, `${rendering}: §2.1 does not say what happens to an existing closed SDS`).toBeDefined();
    expect(NEGATION.test(closed ?? ""), `${rendering}: §2.1 writes into a closed SDS`).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The clauses the first pass left unheld: the Status write that ends the move, the one idempotent
// entry point both callers name, and the WHILE branch of the delete. kiwi-pipeline is the caller
// read here because it is the one that does not commit (AC-3's named exception).
// ---------------------------------------------------------------------------------------------

/** kiwi-pipeline §2.5.4, the cycle end that calls the close-out twice. */
function pipelineEnd(rendering: string): string {
  return skillSection(rendering, "kiwi-pipeline", /^###\s*2\.5\.4\b/);
}

/** The numbered items of a section, one flattened block each, keyed by their number. */
function numbered(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const block of blocks(text)) {
    const match = /^(\d+)\.\s/.exec(block);
    if (match !== null && !out.has(Number(match[1]))) out.set(Number(match[1]), block);
  }
  return out;
}

describe("FR-FLOW-183 AC-1 — the move ends by closing the SDS, through one idempotent entry point", () => {
  it.each(RENDERINGS)("FR-FLOW-183 AC-1 %s: §3.1's last step sets the SDS Status to `closed`, after the SRS writes", (rendering) => {
    const steps = numbered(part(rendering, /^###\s*3\.1\b/));
    const last = Math.max(...steps.keys());
    const close = steps.get(last) ?? "";
    expect(/Status/.test(close) && /`closed`/.test(close), `${rendering}: §3.1 does not end by setting Status to closed`).toBe(true);
    expect(/(?:로 바꾼다|^\d+\.\s+Set)/.test(close), `${rendering}: the last step of §3.1 does not write the Status`).toBe(true);
    const writes = [...steps.entries()].filter(([, text]) => /replace_acceptance_criteria|add_requirement|validate_spec/.test(text)).map(([n]) => n);
    expect(writes.length, `${rendering}: §3.1 has no SRS write step`).toBeGreaterThan(0);
    expect(writes.every((n) => n < last), `${rendering}: the SDS is closed before an SRS write of the move`).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-183 AC-1 %s: §3 states the entry point is idempotent and each call does the next step the state allows", (rendering) => {
    const intro = flat(part(rendering, /^##\s*3\./).split(/\n###\s/)[0] ?? "");
    const said = sentences([intro]);
    expect(
      said.some((sentence) => /\*\*멱등\*\*이고 두 번 부른다|It is \*\*idempotent\*\* and is called twice/.test(sentence)),
      `${rendering}: §3 does not say the one entry point is idempotent and called twice`
    ).toBe(true);
    expect(
      said.some((sentence) => /부를 때마다 SDS 상태가 허락하는 다음 단계를 한다|Each call does the next step the SDS's state allows/.test(sentence)),
      `${rendering}: §3 does not say each call does the next step the SDS state allows`
    ).toBe(true);
    expect(
      said.some((sentence) => /`closed`/.test(sentence) && /§3\.2/.test(sentence) && !NEGATION.test(sentence)),
      `${rendering}: a closed SDS is not routed on to the delete step`
    ).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-183 AC-1 %s: one call with the base <sds-id> closes every fragment, in k order", (rendering) => {
    const intro = sentences([flat(part(rendering, /^##\s*3\./).split(/\n###\s/)[0] ?? "")]);
    expect(
      intro.some((sentence) => sentence.includes("<sds-id>-<k>.sds.md") && /k 순서|in k order/.test(sentence)),
      `${rendering}: §3 does not close each split file in k order`
    ).toBe(true);
    const cycle = flat(pipelineEnd(rendering));
    expect(
      /1번과 6번은 기본 `<sds-id>` 로 한 번 부르면 조각 전부를 처리한다/.test(cycle),
      `${rendering}: kiwi-pipeline does not close a split SDS through its base id`
    ).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-183 AC-1 %s: kiwi-pipeline calls the same entry point before and after promotion", (rendering) => {
    const items = numbered(pipelineEnd(rendering));
    for (const n of [1, 6]) {
      expect(items.get(n) ?? "", `${rendering}: kiwi-pipeline §2.5.4 item ${n} is not the close-out call`).toMatch(/^\d+\.\s+`kiwi-sds --close <sds-id>`/);
    }
    const same = pipelineEnd(rendering)
      .split("\n")
      .find((line) => /1번과 6번은 같은 진입점이다/.test(line)) ?? "";
    expect(same, `${rendering}: kiwi-pipeline does not say items 1 and 6 are one entry point`).not.toBe("");
    expect(same).toContain("kiwi-sds --close");
    expect(/부를 때마다 SDS 상태가 허락하는 다음 단계를 한다/.test(same), `${rendering}: the entry point is not said to follow the SDS state`).toBe(true);
  });
});

describe("FR-FLOW-183 AC-3 — while a requirement stays unpromoted the file stays; a non-committing caller says who commits", () => {
  it.each(RENDERINGS)("FR-FLOW-183 AC-3 %s: §3.2 keeps the file and reports each unpromoted requirement otherwise", (rendering) => {
    const steps = numbered(part(rendering, /^###\s*3\.2\b/));
    const otherwise = [...steps.values()].find((text) => /^\d+\.\s+(?:아니면|Otherwise)/.test(text)) ?? "";
    expect(otherwise, `${rendering}: §3.2 has no branch for a requirement still unpromoted`).not.toBe("");
    expect(/^3\. (?:아니면 파일을 남기고|Otherwise keep the file)/.test(otherwise), `${rendering}: the unpromoted branch does not keep the file`).toBe(true);
    expect(
      /승급되지 않은 요구를 보고|report the requirements not yet promoted/i.test(otherwise),
      `${rendering}: the unpromoted branch does not report the requirement`
    ).toBe(true);
    const deleting = [...steps.values()].find((text) => /\*\*(?:지운다|delete)\*\*/.test(text)) ?? "";
    expect(
      /커밋하지 않는 호출자는 그 사실을 보고|a caller that does not commit reports that/i.test(deleting),
      `${rendering}: the delete step does not make a non-committing caller report who carries the deletion`
    ).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-183 AC-3 %s: kiwi-pipeline keeps the file for an unpromoted requirement and reports that the next commit carries the deletion", (rendering) => {
    const last = numbered(pipelineEnd(rendering)).get(6) ?? "";
    expect(last, `${rendering}: kiwi-pipeline §2.5.4 has no item 6`).not.toBe("");
    expect(
      /승급되지 않은 요구가 남으면 파일은 남고, 보고에 그 요구를 적는다/.test(last),
      `${rendering}: item 6 does not keep the file and report the unpromoted requirement`
    ).toBe(true);
    expect(
      /커밋하지 않으므로 그 삭제는 다음 커밋이 싣는다 — 보고에 그렇게 적는다/.test(last),
      `${rendering}: item 6 does not report that the next commit carries the deletion`
    ).toBe(true);
  });
});
