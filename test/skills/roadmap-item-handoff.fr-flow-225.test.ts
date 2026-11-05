import { describe, expect, it } from "vitest";

import { readRepoFile, scanUnits, skillFiles } from "./kiwi-renderings.js";
import { fileSections } from "./rule-blocks.js";

// @req FR-FLOW-225 — kiwi-prd and kiwi-srs carry an optional ROADMAP_ITEM=RM-<n>: kiwi-prd names it in the
// next step it returns, kiwi-srs links a target it registers to that item through update_roadmap_item, and
// neither calls a roadmap tool without it. The AC numbers are the FR-FLOW-225 block in
// docs/spec/60.workflow-release.srs.md.
//
// The rules are held as whole lines and whole sections (an exception appended to them changes the line),
// and the call sites are read structurally: a roadmap tool named anywhere outside the one linking section
// is a call the AC does not allow.

const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
type Rendering = (typeof RENDERINGS)[number];
const CALL_PREFIX: Record<Rendering, string> = { "skills/claude": "/", "skills/codex": "$", "skills/etc": "", ".agents/skills": "$" };

/** Every roadmap tool, by its MCP name and by its CLI command. */
const ROADMAP_TOOL = /\b(?:list_roadmap_items|get_roadmap_item|check_roadmap|add_roadmap_item|update_roadmap_item|sync_roadmap_actuals)\b|speckiwi roadmap\b/;

const prdStep8 = (prefix: string): string =>
  `8. 끝나면 PRD 경로를 돌려준다. 단독 실행이면 다음 단계로 \`${prefix}kiwi-srs REQ_PATH=<PRD 경로>\` 를 안내한다. ` +
  `선택 입력 \`ROADMAP_ITEM=RM-<n>\` 을 받았으면 호출자가 있어도 다음 단계를 \`${prefix}kiwi-srs REQ_PATH=<PRD 경로> ROADMAP_ITEM=RM-<n>\` 으로 안내한다. ` +
  "kiwi-prd 는 로드맵 도구를 부르지 않는다.";

const SRS_INPUT =
  "선택 입력 `ROADMAP_ITEM=RM-<n>` — 이 run 이 다루는 로드맵 항목. 있으면 §12.1.4 로 이 run 이 새로 등록한 target 을 그 항목에 연결하고, 없으면 로드맵 도구를 하나도 부르지 않는다(FR-FLOW-225).";
const SRS_LINK_HEADING = "### 12.1.4 로드맵 항목 연결 (FR-FLOW-225)";
const SRS_LINK_BODY =
  "`ROADMAP_ITEM` 이 있고 이 run 이 §3.1 의 6 으로 새 target 을 등록했으면, run 끝에서 `get_roadmap_item` 으로 그 항목의 `targets` 를 읽고 " +
  "그 목록에 새 target 을 더한 목록을 `targets` 로 `update_roadmap_item` 을 한 번 부른다. 사유(`reason`)는 `kiwi-srs run {run-id}: target {TARGET} 등록` 이다. " +
  "새 target 을 등록하지 않은 run 은 로드맵 도구를 부르지 않는다.";

const lf = (text: string): string => text.replace(/\r\n/g, "\n");

describe("FR-FLOW-225 AC-1 — kiwi-prd names ROADMAP_ITEM in the next step it returns", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-225 AC-1
    it(`${root}/kiwi-prd: step 8 is exactly the next-step guidance with ROADMAP_ITEM`, () => {
      const lines = lf(readRepoFile(`${root}/kiwi-prd/SKILL.md`)).split("\n");
      expect(lines.filter((line) => line.startsWith("8. "))).toEqual([prdStep8(CALL_PREFIX[root])]);
    });
  }
});

describe("FR-FLOW-225 AC-2 — kiwi-srs links a target it registers to the roadmap item at the end of the run", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-225 AC-2
    it(`${root}/kiwi-srs: §1.1 declares the optional ROADMAP_ITEM input beside PRD_PATH`, () => {
      const lines = lf(readRepoFile(`${root}/kiwi-srs/SKILL.md`)).split("\n");
      const prdPath = lines.findIndex((line) => line.startsWith("선택 입력 `PRD_PATH`"));
      expect(prdPath).toBeGreaterThan(0);
      expect(lines.slice(prdPath + 1, prdPath + 3)).toEqual(["", SRS_INPUT]);
    });

    // @req FR-FLOW-225 AC-2
    it(`${root}/kiwi-srs: §12.1.4 is exactly the one update_roadmap_item call, after the checks and before the emit`, () => {
      const files = skillFiles(root, "kiwi-srs").filter((doc) => doc.text.includes("### 12.1 검증"));
      expect(files, "the Finalize section is in exactly one file").toHaveLength(1);
      const headings = fileSections(files[0]!.relPath).map((section) => section.heading);
      const at = headings.indexOf(SRS_LINK_HEADING);
      expect(at).toBeGreaterThan(0);
      expect(headings[at - 1]).toBe("### 12.1 검증");
      expect(headings[at + 1]).toMatch(/^### 12\.1\.5 /);
      const body = fileSections(files[0]!.relPath)[at]!.body.trim();
      expect(body).toBe(SRS_LINK_BODY);
    });
  }
});

describe("FR-FLOW-225 AC-3 — without ROADMAP_ITEM neither skill calls a roadmap tool", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-225 AC-3 — kiwi-prd calls no roadmap tool at all, so none is named in any of its files.
    it(`${root}/kiwi-prd names no roadmap tool`, () => {
      const docs = skillFiles(root, "kiwi-prd");
      expect(docs.length).toBeGreaterThan(0);
      for (const doc of docs) expect(doc.text, doc.relPath).not.toMatch(ROADMAP_TOOL);
    });

    // @req FR-FLOW-225 AC-3 — every place kiwi-srs names a roadmap tool is the linking section, which is
    // conditioned on ROADMAP_ITEM; a roadmap tool named in any other section is an unconditioned call.
    it(`${root}/kiwi-srs names roadmap tools only in §12.1.4, and only in blocks that name ROADMAP_ITEM`, () => {
      const sites = skillFiles(root, "kiwi-srs").flatMap((doc) =>
        fileSections(doc.relPath).flatMap((section) =>
          scanUnits(section.body).filter((unit) => ROADMAP_TOOL.test(unit.text)).map((unit) => ({ heading: section.heading, text: unit.text }))
        )
      );
      expect(sites.length).toBeGreaterThan(0);
      for (const site of sites) {
        expect(site.heading, site.text).toBe(SRS_LINK_HEADING);
        expect(site.text).toContain("`ROADMAP_ITEM`");
      }
    });
  }
});
