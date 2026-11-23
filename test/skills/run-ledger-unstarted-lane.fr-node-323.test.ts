import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @req FR-NODE-323 AC-4 — the run-ledger reconciliation predicates say a lane at its dispatch base never
// started, and a re-dispatch whose next action names a worktree attaches to it.

const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];

function predicates(root: string): string {
  const text = readFileSync(path.join(process.cwd(), root, "_shared/kiwi/run-ledger.md"), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("\n## 5. ");
  const end = text.indexOf("\n## 6. ", start);
  expect(start, root).toBeGreaterThan(0);
  return text.slice(start, end);
}

describe("FR-NODE-323 AC-4 — run-ledger §5 states the never-started lane rule", () => {
  it.each(RENDERINGS)("%s", (root) => {
    const section = predicates(root);
    const rule = section.split("\n").find((line) => line.includes("시작되지 않은 것")) ?? "";
    for (const phrase of [
      "마지막 `dispatch-lane` 줄의 `isolation.base_sha`",
      "merge witness · `integrate-lane` result · `lane_disposition` 이 없고",
      "저장소 루트의 워크트리와 lane 브랜치 위의 워크트리를 뺀 나머지 워크트리(detached 이거나 lane 이 아닌 브랜치로 옮긴 것",
      "모두 HEAD 가 그 base 이고 `git status` 가 비어",
      "분류는 이 규칙이 없을 때와 같다",
      "`git status` 가 비어",
      "`not-dispatched`",
      "`dispatch-lane`",
      "`args.worktree` 가 있으면 새 워크트리를 `worktree add` 하지 않고 그 워크트리에 붙인다"
    ]) {
      expect(rule, `${root}: ${phrase}`).toContain(phrase);
    }
  });
});
