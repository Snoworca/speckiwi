import { describe, expect, it } from "vitest";

import { WAVES_EVENT_REQUIRED_BY_SCOPE } from "../../src/core/orchestrator/journal-schema.js";
import { section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, readRepoFile } from "./kiwi-renderings.js";

// @req FR-NODE-218 AC-5 AC-6 — the journal's per-scope required fields, read by `journal append`, are
// the sets the skills document, and the skills leave the stamps the tools compute to the tools.

const SCOPES = Object.keys(WAVES_EVENT_REQUIRED_BY_SCOPE) as Array<keyof typeof WAVES_EVENT_REQUIRED_BY_SCOPE>;

const read = (relPath: string): string => readRepoFile(relPath).replace(/\r\n/g, "\n");

/** The three documents AC-6 names, per rendering, each cut to the part that carries the sets. */
function documents(rendering: string): Array<[string, string]> {
  return [
    [`${rendering}/_shared/kiwi/run-ledger.md §2`, section(read(`${rendering}/_shared/kiwi/run-ledger.md`), /^## 2\./m)],
    [`${rendering}/_shared/kiwi/waves-event.md`, read(`${rendering}/_shared/kiwi/waves-event.md`)],
    [`${rendering}/kiwi-orchestrator/SKILL.md §2`, section(stripFrontmatter(read(`${rendering}/kiwi-orchestrator/SKILL.md`)), /^## 2\./m)]
  ];
}

/** `scope → the backticked field names of its row`, from rows whose first cell opens with the scope. */
function documentedSets(text: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const row of tableRows(text)) {
    const scope = SCOPES.find((name) => (row.cells[0] ?? "").startsWith(`\`${name}\``));
    if (scope === undefined) continue;
    const fields = [...(row.cells[1] ?? "").matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string);
    out.set(scope, [...(out.get(scope) ?? []), fields]);
  }
  return out;
}

describe.each(RENDERINGS)("FR-NODE-218 — %s", (rendering) => {
  it.each(SCOPES)("AC-5: every document lists exactly the %s set journal append checks", (scope) => {
    for (const [where, text] of documents(rendering)) {
      expect(text, `${where} was not found`).not.toBe("");
      const rows = documentedSets(text).get(scope) ?? [];
      expect(rows, `${where}: one row for the ${scope} scope`).toHaveLength(1);
      expect([...(rows[0] ?? [])].sort(), `${where}: the ${scope} set`).toEqual([...WAVES_EVENT_REQUIRED_BY_SCOPE[scope]].sort());
    }
  });

  it("AC-6: the intent and result line shapes carry schema_version", () => {
    for (const [where, text] of documents(rendering)) {
      if (where.includes("waves-event.md")) continue;
      for (const event of ["intent", "result"]) {
        const shape = text.split("\n").find((line) => line.includes(`{event:"${event}"`)) ?? "";
        expect(shape, `${where}: the ${event} line shape`).not.toBe("");
        expect(shape, `${where}: the ${event} line shape`).toContain("schema_version");
      }
    }
  });

  it("AC-6: the tools fill ts, invariant_digest and written_at, and a line may come from a file", () => {
    for (const [where, text] of documents(rendering)) {
      const prose = flat(text);
      expect(prose, `${where}: ts is left to journal append`).toMatch(/`ts` 는 `journal append` 가 채운다/);
      if (where.includes("waves-event.md")) continue;
      expect(prose, `${where}: the payload may come from a file`).toContain("--payload-file");
      expect(prose, `${where}: the card stamps are left to card write`).toMatch(/`invariant_digest` 와 `written_at` 은 카드 페이로드에서 빼고 `card write` 가 채운다 — 이전 카드에서 옮겨 적지 않는다/);
    }
  });

  it("AC-6: the waves-event emit pattern hands no stamp to the agent — the append tool writes ts", () => {
    // §5 is the last section and its bash fence holds `# …` comment lines, which section() reads as headings.
    const text = read(`${rendering}/_shared/kiwi/waves-event.md`);
    const emit = text.slice(Math.max(0, text.search(/^## 5\. Emit/m)));
    expect(emit, `${rendering}: waves-event.md §5 was not found`).not.toBe("");
    expect(emit, `${rendering}: a hand-written ts in the emit example`).not.toMatch(/"ts"\s*:/);
    expect(emit, `${rendering}: the emit goes through the append tool`).toMatch(/speckiwi orchestrate journal append [^\n]*--run-id <rid> --payload-file /);
    expect(emit, `${rendering}: the emit still appends with a shell redirect`).not.toMatch(/>>\s*"\$WAVE_DIR\/waves\.jsonl"/);
  });

  it("AC-6: no sentence tells the agent to compute invariant_digest itself", () => {
    const orchestrator = flat(stripFrontmatter(read(`${rendering}/kiwi-orchestrator/SKILL.md`)));
    const ledger = flat(read(`${rendering}/_shared/kiwi/run-ledger.md`));
    for (const [where, text] of [
      ["kiwi-orchestrator", orchestrator],
      ["run-ledger.md", ledger]
    ] as const) {
      const sentences = text.split(/(?<=[.다])\s/).filter((s) => /`invariant_digest`/.test(s) && /(다시 )?계산(한다|하고|해)/.test(s));
      for (const sentence of sentences) {
        expect(sentence, `${rendering} ${where}: computing invariant_digest is not left to card write`).toMatch(/`(orchestrate )?card write`/);
        // card write keeps a supplied invariant_digest and computes one only when the payload omits it
        // (review r2 M6), so a sentence about the recomputation must say the payload leaves it out.
        expect(sentence, `${rendering} ${where}: the recomputation does not say the payload omits invariant_digest`).toMatch(/빼고|뺀/);
      }
    }
  });
});

// @req FR-NODE-217 AC-2 — a resume-card pointer is `<path>@sha256:<sha256 of the written file's bytes>`;
// `freeze` and `schedule waves` return it as `pointer` and `resume` recomputes it with the same function.
describe.each(RENDERINGS)("FR-NODE-217 AC-2 — %s run-ledger.md states the card pointer rule", (rendering) => {
  it("the agent copies the pointer the tool returned and never computes it", () => {
    const ledger = flat(read(`${rendering}/_shared/kiwi/run-ledger.md`));
    expect(ledger).toContain("`<path>@sha256:<그 파일 바이트의 sha256>`");
    expect(ledger).toMatch(/`freeze` · `schedule waves` 가 돌려준 `pointer` 를 그대로 옮겨 적고 직접 계산하지 않는다/);
    expect(ledger).toMatch(/`orchestrate resume` 이 같은 함수로 다시 계산해 대조한다/);
    expect(ledger).toMatch(/freeze lock 안의 `sha256` 필드는 그 lock 의 봉인이지 카드 포인터가 아니다/);
  });
});
