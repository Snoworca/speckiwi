import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-7 verification: kiwi-wave-master `--drive` turns on `--auto` and adds self-repair, and
// §7.5.1 is the closed list of the gates `--drive` does not open. kiwi-srs now stops on two PRD
// gates that FR-FLOW-205 keeps with the user also under `--auto` (`prd-record-tampered`,
// `prd-residual-user-decision`); in wave-master both surface as `child-srs-needs-user-or-failed`.
// Neither that gate nor the PRD gates are in the closed list, so under `--drive` the run may
// "self-repair" past them — e.g. drop or keep a residual requirement, or rewrite the hash row —
// which is the unattended scope change the PRD record exists to prevent.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function driveClosedList(text: string): string {
  const at = text.search(/^#### 7\.5\.1 .*--drive/m);
  expect(at, "precondition: §7.5.1 --drive closed list").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n#### ", at + 1);
  return text.slice(at, end < 0 ? text.length : end);
}

describe("--drive does not open the PRD stops of kiwi-srs (verify-r7)", () => {
  for (const root of RENDERINGS) {
    const wm = read(`${root}/kiwi-wave-master/SKILL.md`);
    const srs = read(`${root}/kiwi-srs/SKILL.md`);
    it(`${root}: precondition — --drive turns on --auto and kiwi-srs declares both PRD gates`, () => {
      expect(wm).toMatch(/`--drive` 는 `--auto`/);
      expect(srs).toContain("`prd-record-tampered`");
      expect(srs).toContain("`prd-residual-user-decision`");
    });
    // @req FR-FLOW-205 AC-7 — a residual ends NEEDS_USER also under --auto; the committee does not settle it
    // @req FR-FLOW-205 AC-2 — a hash mismatch stops at prd-record-tampered, also under --auto
    it(`${root}/kiwi-wave-master: the --drive closed list keeps the kiwi-srs PRD stops closed`, () => {
      const list = driveClosedList(wm);
      const coversChildSrs = list.includes("`child-srs-needs-user-or-failed`");
      const coversPrdGates = list.includes("`prd-residual-user-decision`") && list.includes("`prd-record-tampered`");
      expect(coversChildSrs || coversPrdGates).toBe(true);
    });
  }
});
