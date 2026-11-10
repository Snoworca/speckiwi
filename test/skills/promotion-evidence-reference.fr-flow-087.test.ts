import { describe, expect, it } from "vitest";

import { normaliseEol, readVariant, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-087 AC-7 — the test-kind promotion evidence references the test file the
// test-sufficiency check cited, and the `verification_cmd` and the worker bundle ride in its notes.
//
// SB15 (5.3.7): the three documents put the `verification_cmd` in the reference, and the `verified`
// transition (FR-NODE-174) resolves a test reference as a path, so `./gradlew …` or an env-prefixed
// command was refused with `[missing]` and every requirement of the wave stayed `implemented`.

const BUNDLES = ["claude", "codex", "etc"] as const;
/** The shared contracts of these bundles are written in English; every SKILL.md is Korean. */
const ENGLISH: ReadonlySet<string> = new Set(["codex", "etc"]);

const shared = (bundle: string, file: string): string => normaliseEol(readVariant(`skills/${bundle}/_shared/kiwi/${file}`));
const skill = (bundle: string, name: string): string => normaliseEol(stripFrontmatter(readVariant(`skills/${bundle}/${name}/SKILL.md`)));

function pw16(bundle: string): string {
  const body = section(shared(bundle, "parallel-waves.md"), /^## 5\./);
  const start = body.search(/^\*\*PW-16\b/m);
  const end = body.search(/^\*\*PW-17\b/m);
  return start < 0 ? "" : body.slice(start, end < 0 ? body.length : end);
}

function testRow(bundle: string): string {
  return (
    section(skill(bundle, "kiwi-orchestrator"), /^##\s*14\.\s/)
      .split("\n")
      .find((line) => line.startsWith('- `type="test"`')) ?? ""
  );
}

describe("FR-FLOW-087 AC-7 — the test evidence reference is the cited test file, never the command", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: test-sufficiency §4 names the cited test file as the reference and puts the command in notes`, () => {
      const rule = section(shared(bundle, "test-sufficiency.md"), /^##\s*4\.\s/);
      const [file, notes, never, old] = ENGLISH.has(bundle)
        ? [
            /`reference` is the test file the AC's citation names/,
            /adds that `verification_cmd` and the harvested evidence bundle path to the notes/,
            /The command never goes in the reference/,
            /it is that `verification_cmd`/
          ]
        : [/`reference` 는 그 AC 의 인용이 가리키는 테스트 파일이다/, /`verification_cmd` 와 수확한 증거 번들 경로를 notes 에 더한다/, /명령은 참조에 넣지 않는다/, /그 `verification_cmd` 이고/];
      expect(rule).toMatch(file);
      expect(rule).toMatch(notes);
      expect(rule).toMatch(never);
      expect(rule).not.toMatch(old);
    });

    it(`${bundle}: PW-16 references the cited test file and keeps verification_cmd in notes`, () => {
      const step = pw16(bundle);
      const [file, notes, old] = ENGLISH.has(bundle)
        ? [
            /its reference is the test file of the citation PW-14 returned for that AC/,
            /the notes carry `verification_cmd` and the path of the harvested worker `docs\/analysis\/kiwi-pm-…` bundle/,
            /its reference is `verification_cmd`/
          ]
        : [/참조는 PW-14 가 그 AC 에 돌려준 인용의 테스트 파일/, /notes 는 `verification_cmd` 와 수확한 워커 `docs\/analysis\/kiwi-pm-…` 번들 경로다/, /참조는 `verification_cmd`/];
      expect(step).toMatch(file);
      expect(step).toMatch(notes);
      expect(step).not.toMatch(old);
    });

    it(`${bundle}: kiwi-orchestrator §14 references the cited test file and keeps verification_cmd in notes`, () => {
      const row = testRow(bundle);
      expect(row).toMatch(/참조는 1 이 그 AC 에 돌려준 인용의 테스트 파일/);
      expect(row).toMatch(/notes 는 `verification_cmd` 와 워커의 `docs\/analysis\/kiwi-pm-…` 번들/);
      expect(row).toMatch(/\*\*`verification_cmd` 는 참조에 넣지 않는다\*\*/);
      expect(row).not.toMatch(/참조는 `verification_cmd`/);
    });
  }
});
