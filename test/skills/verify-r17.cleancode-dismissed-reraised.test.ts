// Round-17 verification. A clean-code round is "reviewer's clean-code findings -> classifier marks
// `dismissed` -> fixer -> regression check", and the rounds end early only when the review that starts
// a round reports no clean-code finding at all. Nothing tells the next round's reviewer about the
// findings already dismissed, nothing keeps a re-raised dismissed finding out of the early-end count,
// and the third-round rule marks every finding "not fixed" after round 3 as `unresolved` — a dismissed
// finding is never fixed by definition. A fresh reviewer that re-reports the same invalid nitpick
// (e.g. a rename that clashes with the project convention) therefore keeps all three rounds running
// and ends the run with that finding reported as `unresolved`, the opposite of the user's
// "타당한 지적이 아니면 마킹하고 무시".
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function renderingText(root: string): string {
  const dir = join(root, "kiwi-review-fix-loop");
  const refs = join(dir, "references");
  const parts = [read(join(dir, "SKILL.md"))];
  if (existsSync(refs)) {
    for (const name of readdirSync(refs).filter((n) => n.endsWith(".md")).sort()) parts.push(read(join(refs, name)));
  }
  return parts.join("\n");
}

const sentences = (text: string): string[] => text.split(/(?<=다\.)\s+|\n/).filter((s) => s.trim() !== "");

describe("verify-r17 — a dismissed clean-code finding that is re-raised is still ignored", () => {
  for (const root of ROOTS) {
    const text = renderingText(root);

    it(`${root}: precondition — the early-end and third-round rules exist`, () => {
      expect(text).toContain("라운드를 시작하는 리뷰가 `clean-code` 지적을 하나도 내지 않으면 그 라운드에서 바로 끝난다");
      expect(text).toContain("세 번째 클린 코드 라운드가 끝나도 고쳐지지 않은 지적은 `unresolved` 로 표시해 보고하고");
    });

    // @req FR-FLOW-206 AC-3 — a finding marked `dismissed` must stay dismissed, not be reported `unresolved`.
    it(`${root}: the third-round unresolved rule leaves dismissed findings out`, () => {
      const rule = sentences(text).filter((s) => s.includes("세 번째 클린 코드 라운드가 끝나도"));
      expect(rule.length).toBeGreaterThan(0);
      expect(rule.some((s) => s.includes("`dismissed`")), `${root}: unresolved rule also catches dismissed findings`).toBe(true);
    });

    // @req FR-FLOW-206 AC-2 — re-reporting an already dismissed finding must not keep the rounds going.
    it(`${root}: a re-raised dismissed finding does not hold off the early end`, () => {
      const handled = sentences(text).some(
        (s) => s.includes("`dismissed`") && /(다시|이미|앞선|이전)/.test(s) && /(끝|세지 않|넘기|알려|제외|빼)/.test(s),
      );
      expect(handled, `${root}: nothing stops a re-raised dismissed finding from counting as a new clean-code finding`).toBe(true);
    });
  }

  // @req FR-FLOW-206 AC-3 — the criterion itself marks every leftover, dismissed included, `unresolved`.
  it("FR-FLOW-206 AC-3 keeps dismissed findings out of the unresolved leftovers", () => {
    const srs = read("docs/spec/60.workflow-release.srs.md");
    const ac3 = srs.split("\n").find((l) => l.includes("AC-3: WHEN a clean-code finding names no principle"));
    expect(ac3, "precondition: AC-3 line").toBeDefined();
    const tail = (ac3 as string).slice((ac3 as string).indexOf("after the third clean-code round"));
    expect(tail, "AC-3 marks every finding left after round 3 unresolved, dismissed ones included").toMatch(/dismissed/);
  });
});
