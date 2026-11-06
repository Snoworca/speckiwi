import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cliJson, PRD_PATH, prdWorkspace } from "../cli/prd-surface-fixture.js";

// verify-v534-r1 — FR-FLOW-227. kiwi-srs rule (c) now tells the author to name a range of criteria
// as `for AC-1–AC-3` (en dash). The same range typed with an ASCII hyphen is a hand-made variant of
// that form; `speckiwi prd coverage` grounds only its first criterion.

async function workspace(rationale: string, criteria: number): Promise<string> {
  const root = await prdWorkspace({
    items: [
      { title: "목적", rows: { Kind: "intent", Source: "U-1", State: "confirmed" }, quote: "비밀번호 재설정 링크를 추가해" },
      { title: "항목 2", rows: { Kind: "in-scope", Source: "U-1", State: "confirmed" }, quote: "Password reset email must expire after one hour." }
    ]
  });
  const file = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const lines = Array.from({ length: criteria }, (_, index) => `- [ ] AC-${index + 1}: The requirement can be counted.`);
  const text = (await readFile(file, "utf8"))
    .replace("The parser needs a small valid workspace.", rationale)
    .replace(/- \[ \] AC-1: The requirement can be listed\.\r?\n- \[ \] AC-2: The requirement can be shown\./, lines.join("\n"));
  await writeFile(file, text, "utf8");
  return root;
}

interface Coverage {
  ungroundedCriteria: Array<{ requirementId: string; criterionId: string }>;
}

describe("verify-v534-r1 FR-FLOW-227 — a fills range typed with an ASCII hyphen", () => {
  // declared limit, 5.3.4 lead decision
  it.fails("fills: PRD-2 / hole / for AC-1-AC-3, ... grounds AC-1 to AC-3", async () => {
    const root = await workspace("fills: PRD-2 / hole / for AC-1-AC-3, the request leaves the empty case open", 3);
    const { code, json } = await cliJson<Coverage>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(code).toBe(0);
    // Measured: ["AC-2", "AC-3"]. With the en dash (`AC-1–AC-3`) the same Rationale grounds all three.
    expect(json.ungroundedCriteria.filter((entry) => entry.requirementId === "FR-ARCH-001").map((entry) => entry.criterionId)).toEqual([]);
  }, 60_000);
});
