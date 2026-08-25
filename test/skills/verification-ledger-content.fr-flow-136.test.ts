import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-136 — the consuming skill's half of the contract.
//
// The consumer moved. It was kiwi-review-fix-loop, chosen because that skill was the only shipped one
// that re-read the same material over numbered rounds and because FR-FLOW-131..135 route all three
// orchestrator rungs and kiwi-wave-master into it. FR-FLOW-152 made that skill code-only, so it no
// longer re-reads prose at all and the old reasoning is now false rather than merely outdated.
//
// The ledger lives in the shared verification engine, which kiwi-orchestrator and kiwi-wave-master
// both cite — the two callers that still run numbered rounds over prose. FR-FLOW-136's requirement
// text never named a skill ("The document review loop SHALL record…") and AC-6 anticipated exactly
// this move, so the requirement was not superseded: the consumer was reassigned and the evidence
// re-attached here.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/_shared/kiwi/verify-loop.md`
);

// The close still lives in kiwi-review-fix-loop (`--close-reqs`), and that skill now reviews only
// code. AC-6's second half is asserted against it, because an obligation split from the skill that
// must discharge it is where this contract would silently stop holding.
const CLOSING_SKILL = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/kiwi-review-fix-loop/SKILL.md`
);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const body = (t: string): string => t.replace(/^---[\s\S]*?\n---\s*\n?/, "");
const line = (t: string, re: RegExp): string => t.split("\n").find((l) => re.test(l)) ?? "";
const lines = (t: string, re: RegExp): string[] => t.split("\n").filter((l) => re.test(l));

function section(text: string, headingRe: RegExp): string {
  const rows = text.split("\n");
  const start = rows.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (start === -1) return "";
  const level = (rows[start]!.match(/^#+/) as RegExpMatchArray)[0].length;
  let end = rows.length;
  for (let index = start + 1; index < rows.length; index++) {
    const match = rows[index]!.match(/^#+/);
    if (match && match[0].length <= level) {
      end = index;
      break;
    }
  }
  return rows.slice(start, end).join("\n");
}

const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시/;

const ledger = (copy: string): string => section(body(read(copy)), /검증 장부/);

describe.each(COPIES)("FR-FLOW-136 AC-2/AC-3 — the delta protocol is stated where it is executed (%s)", (copy) => {
  it("names the ledger's path, and only that path", () => {
    const text = ledger(copy);
    expect(text, `${copy}: the skill must carry a verification-ledger section`).not.toBe("");
    expect(text).toContain("kiwi/verification-ledger.jsonl");
    // `.kiwi/` is per-run session state and `docs/.kiwi/` is tool-owned; a ledger in either is wiped
    // or contended exactly when it would have paid for itself, which is between rounds.
    expect(
      /\.kiwi\/verification-ledger|docs\/\.kiwi\/verification-ledger/.test(body(read(copy))),
      `${copy}: the ledger must outlive a run's session state`
    ).toBe(false);
  });

  it("names both executable verbs, so the hash is the tool's judgement and not the agent's", () => {
    const text = ledger(copy);
    expect(text).toContain("speckiwi workflow verification-ledger plan");
    expect(text).toContain("speckiwi workflow verification-ledger record");
  });

  it("sends dirty sections only, and says so as a prohibition rather than as an aspiration", () => {
    const rule = line(ledger(copy), /clean 섹션/);
    expect(rule, `${copy}: what happens to a clean section must be stated`).not.toBe("");
    expect(/보내지 않는다/.test(rule), `${copy}: "sends dirty sections" alone permits sending clean ones too`).toBe(
      true
    );
    expect(HEDGE.test(rule), `${copy}: a hedged skip is a skip nobody can be held to`).toBe(false);
  });

  it("fails open on an unmatched key, and names the direction it fails in", () => {
    const rule = line(ledger(copy), /무매칭|unmatched/);
    expect(rule, `${copy}: the unmatched-key rule must be stated`).not.toBe("");
    expect(/항상 dirty/.test(rule), `${copy}: an unmatched key must be dirty unconditionally`).toBe(true);
    expect(
      /재검증|fail open/.test(rule),
      `${copy}: the direction is the point — cost is acceptable, false trust is not`
    ).toBe(true);
    expect(HEDGE.test(rule)).toBe(false);
  });

  it("keeps round 1 a full pass, so nothing is ever clean without having been read once", () => {
    const rule = line(ledger(copy), /라운드 1|round 1/);
    expect(rule, `${copy}: the first round's scope must be stated`).not.toBe("");
    expect(/전량|전체/.test(rule), `${copy}: a delta-only first round would verify nothing at all`).toBe(true);
  });
});

describe.each(COPIES)("FR-FLOW-136 AC-4 — the audit obligation and its price, in writing (%s)", (copy) => {
  it("requires one full-document audit before the close, unhedged", () => {
    const rule = line(ledger(copy), /전체 문서 감사/);
    expect(rule, `${copy}: the full-document audit obligation must be stated`).not.toBe("");
    expect(/1회|한 번/.test(rule), `${copy}: an audit without a count permits zero`).toBe(true);
    expect(/마감|close/.test(rule), `${copy}: the obligation must be tied to the close it guards`).toBe(
      true
    );
    // The trigger has to exist in the document that carries the obligation. Moving the ledger here
    // carried `--close-reqs` along with it, and that option belongs to neither this engine nor either
    // of its two callers — both of which say in writing that they do not pass it. The obligation was
    // left with no firing condition in any run, and the old assertion could not see it because a
    // token being present says nothing about whether what it names exists.
    expect(rule, `${copy}: the audit cannot be triggered by an option this document does not have`).not.toMatch(
      /--close-reqs/
    );
    expect(/장부를 무시|장부 없이|ledger 를 무시/.test(ledger(copy)), `${copy}: an audit that consults the ledger is not an audit`).toBe(
      true
    );
    expect(HEDGE.test(rule), `${copy}: a hedged audit is the one that gets skipped`).toBe(false);
  });

  it("states the known limitation it is trading for, rather than leaving it silent", () => {
    const limit = line(ledger(copy), /알려진 한계/);
    expect(limit, `${copy}: the limitation must be written down`).not.toBe("");
    for (const token of ["교차 의존", "hash-clean"]) {
      expect(limit.includes(token), `${copy}: the limitation must name ${token}`).toBe(true);
    }
    expect(
      /못 잡는다|잡지 못한다/.test(limit),
      `${copy}: a limitation phrased as a risk reads as avoidable; this one is structural`
    ).toBe(true);
    expect(/맞바꾼|맞바꾸/.test(limit), `${copy}: the trade must be named as a trade`).toBe(true);
  });

  it("states the obligation once per rendering, so no copy carries a second weaker spelling", () => {
    expect(lines(body(read(copy)), /전체 문서 감사/).length, `${copy}: exactly one declaration`).toBe(1);
  });
});

describe.each(CLOSING_SKILL)("FR-FLOW-136 AC-6 — the close cannot discharge an audit it cannot run (%s)", (copy) => {
  it("refuses to close a requirement whose evidence rests on prose, and says so", () => {
    // The audit gates the close. The skill that performs the close now reviews only code, so it
    // cannot perform the audit. Leaving the obligation written where it cannot be discharged turns a
    // gate into a sentence, and --close-reqs would promote requirements verified by prose nobody read.
    const text = body(read(copy));
    const rule = line(text, /산문.{0,40}(증거|근거)|prose.{0,40}evidence/i);
    expect(rule, `${copy}: the close must name the prose-evidence case it declines`).not.toBe("");
    expect(/닫지 않는다|승격하지 않는다|skip|does not close/i.test(rule), `${copy}: it must decline, not proceed`).toBe(true);
    expect(HEDGE.test(rule), `${copy}: a hedged refusal is the one that gets skipped`).toBe(false);
  });
});

describe("FR-FLOW-136 — the mirror is generated, not hand-written", () => {
  it("keeps .agents/skills byte-identical to its codex source", () => {
    expect(read(".agents/skills/_shared/kiwi/verify-loop.md")).toBe(
      read("skills/codex/_shared/kiwi/verify-loop.md")
    );
    expect(read(".agents/skills/kiwi-review-fix-loop/SKILL.md")).toBe(
      read("skills/codex/kiwi-review-fix-loop/SKILL.md")
    );
  });
});
