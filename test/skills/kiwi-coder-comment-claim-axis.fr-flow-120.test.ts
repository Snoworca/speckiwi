import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-120 — the prickly review checks comment claims a machine can check.
//
// The gap these cases pin: the seven axes are intent preservation, security, edge cases, concurrency,
// refactoring scope, error handling and test quality. None asks whether a comment says something true
// about the code, and the `@req` tag is explicitly exempted from being checked at all. A comment that
// asserts a fact is therefore never re-read against the code — the same failure mode that let 44
// verified requirements in this repository carry evidence about a directory outside version control.
//
// The axis is bounded on purpose. Judging an arbitrary comment against code costs the same reasoning
// as judging an acceptance criterion, measured here at roughly 27 seconds per requirement. A path, a
// symbol, a count and an absence claim are decidable by existsSync and grep, so the closed set keeps
// the axis nearly free while covering the claims that actually went false.

const VARIANTS = ["claude", "codex", "etc"] as const;

function skillBody(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-coder", "SKILL.md"), "utf8");
}

/**
 * Blanks the contents of fenced blocks, keeping line numbering. A verifier found that moving the
 * axis table or the bounding paragraph into a ```md fence left every assertion green while removing
 * the contract from the prose an agent reads as normative.
 */
function maskFences(body: string): string {
  let fenced = false;
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

/** The §5.2 axis table rows only — a numbered row anywhere else, or inside a fence, must not count. */
function axisRows(body: string): string[] {
  const lines = maskFences(body).split("\n");
  const start = lines.findIndex((line) => /^### 5\.2 /.test(line));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => /^\|\s*\d+\s*\|/.test(line));
}

/** Section 5.2 with fenced content removed, for the assertions about its prose. */
function axisSection(body: string): string {
  const masked = maskFences(body);
  const start = masked.indexOf("### 5.2 ");
  if (start < 0) return "";
  const end = masked.indexOf("\n### ", start + 1);
  return end < 0 ? masked.slice(start) : masked.slice(start, end);
}

function axisSubject(row: string): string {
  return row.split("|")[2]?.trim() ?? "";
}

function commentAxisRow(body: string): string | undefined {
  return axisRows(body).find((row) => axisSubject(row) === "주석 주장");
}

describe("FR-FLOW-120 — an axis whose subject is whether a comment's claim holds", () => {
  it.each(VARIANTS)("AC-1: %s declares the comment-claim axis in its §5.2 table", (variant) => {
    const body = skillBody(variant);
    expect(axisRows(body).length, "the §5.2 axis table was not found").toBeGreaterThan(0);
    expect(commentAxisRow(body), "no axis names comment claims as its subject").toBeDefined();
  });

  it.each(VARIANTS)("AC-1: %s keeps that axis distinct from the refactoring axis", (variant) => {
    const body = skillBody(variant);
    const refactoring = axisRows(body).find((row) => axisSubject(row) === "리팩토링 여지");
    expect(refactoring, "the refactoring axis vanished").toBeDefined();
    // The refactoring axis is about the shape of the code, not the truth of prose beside it. Merging
    // the two would let a reviewer satisfy the comment axis by renaming something.
    expect(refactoring).toContain("중복");
    expect(refactoring).not.toContain("주석");
    expect(commentAxisRow(body)).not.toBe(refactoring);
  });

  it.each(VARIANTS)("AC-2: %s names the closed four kinds in that row", (variant) => {
    const row = commentAxisRow(skillBody(variant)) ?? "";
    for (const kind of ["경로", "심볼명", "개수", "부재 주장"]) {
      expect(row, `the closed set does not name ${kind}`).toContain(kind);
    }
  });

  it("AC-2: the closed set is identical in all three variants", () => {
    const rows = VARIANTS.map((variant) => commentAxisRow(skillBody(variant)));
    expect(rows.every((row) => row !== undefined)).toBe(true);
    expect(new Set(rows).size, "a variant states a different closed set").toBe(1);
  });

  it.each(VARIANTS)("AC-3: %s states that a claim outside the closed set is not a finding", (variant) => {
    // Pinned as a sentence, not as tokens: an added clause that re-admits intent judgements would
    // leave every token in place while reversing the bound.
    expect(skillBody(variant)).toContain("닫힌 4종 밖의 주석 주장은 finding 이 아니다");
  });

  it.each(VARIANTS)("AC-3: %s does not re-admit intent judgement anywhere in §5.2", (variant) => {
    expect(axisSection(skillBody(variant))).toContain("의도·설계 의견을 다투지 않는다");
  });

  it.each(VARIANTS)("AC-2: %s states the set as closed, not as examples", (variant) => {
    // A verifier defeated the earlier assertions by rewording the row to "주로 다음 4종을 포함해"
    // and by appending "그 밖에 리뷰어가 검증 가능하다고 본 모든 주장". Both leave the four tokens
    // in place, so the tokens alone cannot carry the criterion — the closure marker must be pinned.
    expect(commentAxisRow(skillBody(variant)) ?? "").toContain("닫힌 4종만");
  });

  it.each(VARIANTS)("AC-3: %s does not append an escape hatch that reverses the bound", (variant) => {
    const section = axisSection(skillBody(variant));
    for (const escape of ["리뷰어 재량", "판단하면", "권고이며", "그 밖에"]) {
      expect(section, `§5.2 re-admits open-ended findings via "${escape}"`).not.toContain(escape);
    }
  });
});

describe("FR-FLOW-120 — the change leaves the existing contract in force", () => {
  it.each(VARIANTS)("AC-4: %s keeps the @req tag prohibition unweakened", (variant) => {
    const body = maskFences(skillBody(variant));
    expect(body, "the @req prohibition heading is gone or fenced").toContain("`@req` 태그 검증 금지");
    // The four prohibited acts, each pinned: a comment-claim axis that admits @req checking would
    // contradict the prohibition rather than extend the review.
    expect(body).toContain("(a) 존재 여부 점검");
    expect(body).toContain("(b) task.req_ids 와 비교");
    expect(body).toContain("(c) REQ-ID 실재성 검증");
    expect(body).toContain("(d) 라인 누락을 finding 으로 발행");
  });

  it("AC-5: the axis table has the same row count in all three variants", () => {
    const counts = VARIANTS.map((variant) => axisRows(skillBody(variant)).length);
    expect(new Set(counts).size, `variants declare different axis counts: ${counts.join(", ")}`).toBe(1);
    expect(counts[0], "the comment-claim axis was not added to the table").toBe(8);
  });

  it("AC-5: the set of axis subjects is equal across the three variants", () => {
    const subjects = VARIANTS.map((variant) => axisRows(skillBody(variant)).map(axisSubject).sort().join("|"));
    expect(new Set(subjects).size, "a variant carries an axis another lacks").toBe(1);
  });

  it.each(VARIANTS)("AC-5: %s numbers its axis rows 1..N with no gap", (variant) => {
    // Renumbering the row to `| 9 |` left every stated count and every subject assertion green while
    // the table itself disagreed with the numbering the prose refers to.
    const numbers = axisRows(skillBody(variant)).map((row) => Number(row.split("|")[1]?.trim()));
    expect(numbers, "the axis rows are not numbered 1..N").toEqual(numbers.map((_, index) => index + 1));
  });

  it("AC-5: the seven pre-existing axes survive the addition", () => {
    for (const variant of VARIANTS) {
      const subjects = axisRows(skillBody(variant)).map(axisSubject);
      for (const kept of ["의도 보존", "보안 위험", "엣지 케이스", "동시성", "리팩토링 여지", "에러 처리", "테스트 품질"]) {
        expect(subjects, `${variant} lost the ${kept} axis`).toContain(kept);
      }
    }
  });

  it.each(VARIANTS)("AC-4: %s qualifies the symbol kind so a REQ-ID cannot be read into it", (variant) => {
    // Unqualified `심볼명` lets a reviewer treat a REQ-ID as a symbol and re-enter prohibited act (c).
    const row = commentAxisRow(skillBody(variant)) ?? "";
    expect(row, "the symbol kind is unqualified").toContain("코드 심볼명");
  });

  it.each(VARIANTS)("AC-4: %s does not admit @req checking through the new axis", (variant) => {
    // §5.2 must keep saying "REQ-ID" — the prohibition's act (c) is written there and AC-4 requires it
    // to survive. What must not appear is a sentence that puts the new axis and REQ-ID checking
    // together, which is how a verifier re-entered the prohibited act while (a)-(d) stayed verbatim.
    const offending = maskFences(skillBody(variant))
      .split("\n")
      .filter((line) => line.includes("REQ-ID") && /축\s*8|주석 주장/.test(line));
    expect(offending, "a sentence ties the comment-claim axis to REQ-ID checking").toEqual([]);
  });
});

describe("FR-FLOW-120 — the skill's own count claims are subject to the axis it adds", () => {

  /**
   * Counts these bodies state about the §5.2 axis table, in either spelling ("8축", "검증 축 8개").
   * Scoped per line to the lines that name that table: the same documents also count the §4.2
   * Sonnet TDD axes and the formal-check axes, and those are different tables with their own sizes.
   */
  function statedAxisCounts(body: string): Array<{ text: string; count: number }> {
    const found: Array<{ text: string; count: number }> = [];
    // Every line INSIDE §5.2 is about the §5.2 table whether or not it repeats the section's name.
    // An auditor wrote `본 표는 총 7축 구성이다.` directly beneath the eight-row table and the suite
    // stayed green: the line named neither `까칠 리뷰` nor `§5.2`, so the per-line filter skipped the
    // one place where a count claim is least ambiguous and most likely to be believed.
    const insideSection = new Set(axisSection(body).split("\n"));
    for (const line of body.split(/\r?\n/)) {
      if (!insideSection.has(line) && !/까칠 리뷰|§5\.2/.test(line)) continue;
      if (/§4\.2/.test(line)) continue;
      for (const match of [...line.matchAll(/(\d+)축/g), ...line.matchAll(/축\s*(\d+)\s*개/g)]) {
        found.push({ text: match[0], count: Number(match[1]) });
      }
    }
    return found;
  }

  it.each(VARIANTS)("AC-6: every axis count %s states equals the number of rows it declares", (variant) => {
    // A verifier defeated the earlier denylist three ways: `검증 축 7개` is a count claim that is not
    // the token `7축`; a heading could say 9축 while another line said 8축; a borrowing skill could
    // state any wrong number except that one spelling. So compare computed against declared.
    const body = skillBody(variant);
    const rows = axisRows(body).length;
    const stated = statedAxisCounts(body);
    expect(stated.length, "the skill states no axis count at all").toBeGreaterThan(0);
    for (const claim of stated) {
      expect(claim.count, `"${claim.text}" contradicts the ${rows}-row table`).toBe(rows);
    }
  });

  it("AC-6: the .agents mirror states the same counts as its source variant", () => {
    const mirror = readFileSync(path.join(REPO_ROOT, ".agents/skills/kiwi-coder/SKILL.md"), "utf8");
    const rows = axisRows(mirror).length;
    for (const claim of statedAxisCounts(mirror)) {
      expect(claim.count, `the mirror's "${claim.text}" contradicts its ${rows}-row table`).toBe(rows);
    }
  });

  /** Every bundled document an agent reads: the three variants plus the .agents mirror. */
  function bundledDocs(): string[] {
    const roots = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];
    const found: string[] = [];
    const walk = (dir: string): void => {
      let entries: ReturnType<typeof readdirSync>;
      try {
        entries = readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith(".md")) found.push(rel);
      }
    };
    for (const root of roots) walk(root);
    return found;
  }

  /**
   * Skills that define their own review axes rather than borrowing §5.2. kiwi-hot-fix's P1..P7 are
   * root-cause fit, regression risk and hot-fix appropriateness — a different set that happens to
   * name §5.2 in order to say it is NOT using it.
   *
   * This is an allowlist, deliberately, and not a disclaimer sentence in the subject document. A
   * verifier showed the disclaimer was an unconditional escape: any borrowing document could opt out
   * of the count check by adding one sentence, even hidden inside an HTML comment, which is strictly
   * worse than naming the exceptions here where they are visible at the check.
   */
  const DEFINES_ITS_OWN_AXES = ["kiwi-hot-fix"];
  function borrowsTheTable(relPath: string, body: string): boolean {
    if (DEFINES_ITS_OWN_AXES.some((skill) => relPath.includes(`/${skill}/`))) return false;
    // An independent census found six bundled documents outside these three tokens that visibly
    // borrow the table — including three `kiwi-coder/references/extended-workflow.md` files, which
    // are part of the SUBJECT skill, and three `kiwi-review-fix-loop` renderings that reproduce the
    // axis enum verbatim. `까칠 리뷰` names the review wherever it is discussed, and the enum itself
    // is the strongest possible evidence that a document is carrying the table.
    return /kiwi-coder §5\.2|Phase 2\.f|까칠 리뷰/.test(body) || /["']axis["']\s*:\s*["'][^"']*comment-claim/.test(body);
  }

  it("AC-6: every bundled document that borrows the table states the table's own count", () => {
    // A verifier reverted kiwi-hot-fix to "7축 — kiwi-coder §5.2 차용" and the suite stayed green,
    // because the borrow check named one file by hand. Scan every bundled document instead.
    const rows = axisRows(skillBody("claude")).length;
    const offenders: string[] = [];
    for (const relPath of bundledDocs()) {
      const body = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      if (!borrowsTheTable(relPath, body)) continue;
      for (const line of body.split(/\r?\n/)) {
        if (!/kiwi-coder §5\.2|Phase 2\.f|까칠 리뷰/.test(line)) continue;
        if (/§4\.2/.test(line)) continue;
        for (const match of [...line.matchAll(/(\d+)축/g), ...line.matchAll(/축\s*(\d+)\s*개/g)]) {
          if (Number(match[1]) !== rows) offenders.push(`${relPath}: "${match[0]}" against a ${rows}-row table`);
        }
      }
    }
    expect(offenders, "a borrowing document states a count the table contradicts").toEqual([]);
  });

  it("AC-6: every axis enum in a borrowing document can represent all the axes", () => {
    // The earlier check read only the FIRST "axis" enum in a file. A second, narrower enum later in
    // the same document hands a reviewer a slot set that cannot express an axis-8 finding.
    const rows = axisRows(skillBody("claude")).length;
    const offenders: string[] = [];
    for (const relPath of bundledDocs()) {
      const body = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      if (!borrowsTheTable(relPath, body)) continue;
      for (const match of body.matchAll(/["']axis["']\s*:\s*["']([^"']+)["']/g)) {
        const slots = match[1]?.split("|") ?? [];
        if (slots.length < rows) offenders.push(`${relPath}: ${slots.length} slots for ${rows} axes`);
        // A slot set of the right size that no longer names the axis is the same defect wearing a
        // different mask: the finding still cannot be reported as a comment claim.
        const named = slots.some((slot) => /comment-claim|P8/.test(slot.trim()));
        if (!named) offenders.push(`${relPath}: no slot names the comment-claim axis`);
      }
    }
    expect(offenders, "a borrowing document cannot represent an axis-8 finding").toEqual([]);
  });

  it("AC-6: a skill that borrows the table by name enumerates as many axes as it claims", () => {
    // kiwi-review-fix-loop hands its reviewer a finding schema with one slot per axis. A slot set
    // narrower than the table it claims to borrow makes an axis-8 finding unrepresentable, which is
    // the same defect as a wrong number: the axis exists in prose and cannot be reported.
    for (const relPath of ["skills/claude/kiwi-review-fix-loop/SKILL.md"]) {
      const body = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      const claimed = statedAxisCounts(body).find((claim) => /축/.test(claim.text));
      expect(claimed, `${relPath} borrows the table without stating a count`).toBeDefined();
      const slots = body.match(/"axis":\s*"([^"]+)"/)?.[1]?.split("|") ?? [];
      expect(slots.length, `${relPath} offers ${slots.length} axis slots for ${claimed?.count} axes`).toBe(claimed?.count);
    }
  });

  it("AC-6: no bundled skill enumerates the pre-change axis set as if it were current", () => {
    // The subject-named enum in the extended-workflow references lists the seven original subjects.
    // Left alone it is a second, stale copy of the table this requirement changed.
    for (const relPath of [
      "skills/codex/kiwi-review-fix-loop/references/extended-workflow.md",
      "skills/etc/kiwi-review-fix-loop/references/extended-workflow.md",
      ".agents/skills/kiwi-review-fix-loop/references/extended-workflow.md"
    ]) {
      const body = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      const slots = (body.match(/["']axis["']\s*:\s*["']([^"']+)["']/)?.[1] ?? "").split("|").map((slot) => slot.trim());
      expect(slots.length, `${relPath} still enumerates the pre-change axis set`).toBeGreaterThan(7);
      // Size alone is not enough: a verifier kept eight slots and renamed `comment-claim` to `기타`,
      // leaving the reviewer a slot it could not recognise as the comment-claim axis.
      expect(slots, `${relPath} has enough slots but none names the comment-claim axis`).toContain("comment-claim");
    }
  });
});

describe("FR-FLOW-120 — an axis finding can stop the pipeline", () => {
  it.each(VARIANTS)("AC-7: %s routes a false comment claim to a gate-blocking severity", (variant) => {
    const body = skillBody(variant);
    const start = body.indexOf("### 5.3 ");
    const section = start < 0 ? "" : body.slice(start, body.indexOf("\n### ", start + 1));
    expect(section, "§5.3 was not found").not.toBe("");
    // The Phase 2 gate is CRITICAL=0 + HIGH=0, and §5.3 files comments under LOW. Left there, every
    // axis-8 finding is advisory and the axis can never do the thing it was added to do.
    const high = section.split(/\r?\n/).find((line) => line.includes("**HIGH**")) ?? "";
    expect(high, "a false comment claim is not routed to a blocking severity").toContain("주석 주장");
  });

  it.each([...VARIANTS, "mirror"])("AC-7: %s routes the claim unconditionally, not at the reviewer's discretion", (which) => {
    // A verifier appended "(리뷰어가 중대하다고 본 경우에 한함, 그 외에는 LOW)" to the HIGH clause and
    // the suite stayed green: the assertion only asked that the clause appear. AC-7 says the claim IS
    // routed, so a qualifier that makes it optional violates the criterion. Run over the mirror too —
    // that is the rendering .agents-consuming agents actually read.
    const body =
      which === "mirror" ? readFileSync(path.join(REPO_ROOT, ".agents/skills/kiwi-coder/SKILL.md"), "utf8") : skillBody(which);
    const start = body.indexOf("### 5.3 ");
    const section = start < 0 ? "" : body.slice(start, body.indexOf("\n### ", start + 1));
    expect(section, "§5.3 was not found").not.toBe("");

    const high = section.split(/\r?\n/).find((line) => line.includes("**HIGH**")) ?? "";
    const low = section.split(/\r?\n/).find((line) => line.includes("**LOW**")) ?? "";
    expect(high, "the axis-8 clause is not on the blocking line").toContain("주석 주장");
    expect(low, "the axis-8 clause was moved to the non-blocking line").not.toContain("주석 주장");
    // Read the WHOLE line, not the part after the clause: a verifier moved the qualifier to the left
    // of it ("…, 리뷰어가 중대하다고 본 경우에 한하여 축 8 …") and a rightward slice missed it.
    for (const qualifier of ["경우에 한", "판단", "재량", "그 외에는", "선택적", "권고", "합의"]) {
      expect(high, `the routing is conditional via "${qualifier}"`).not.toContain(qualifier);
    }
    // And no OTHER line of §5.3 may downgrade it: the earlier check read only HIGH and LOW, so a
    // separate sentence ("축 8 finding 은 리뷰어 합의로 LOW 로 강등할 수 있다") passed untouched.
    const downgrades = section
      .split(/\r?\n/)
      .filter((line) => /축\s*8|주석 주장/.test(line))
      .filter((line) => /LOW|강등|낮출|하향/.test(line) && !line.includes("**HIGH**"));
    expect(downgrades, "another §5.3 line downgrades the axis").toEqual([]);
  });

  it.each(VARIANTS)("AC-2: %s keeps the absence exemplars the criterion names", (variant) => {
    // AC-2 names `no caller` and `not wired` as the absence exemplars. Swapping them for claims a
    // machine cannot decide (`정렬됨`, `thread-safe`) leaves every other token in place while removing
    // the property that makes the axis nearly free.
    const row = commentAxisRow(skillBody(variant)) ?? "";
    expect(row, "the absence kind lost its machine-checkable exemplars").toContain("호출자 없음");
    expect(row).toContain("not wired");
  });

  it.each(VARIANTS)("AC-1: %s does not scope the axis to newly changed comment lines", (variant) => {
    // The motivating failure is a comment written earlier that went false as reality moved. Scoping
    // axis 8 to added or changed lines would make it structurally unable to catch that.
    const section = axisSection(skillBody(variant));
    for (const scoping of ["새로 추가", "변경된 주석", "기존 주석은 대상 아님", "diff 에서"]) {
      expect(section, `axis 8 is narrowed to changed lines via "${scoping}"`).not.toContain(scoping);
    }
  });

  it.each(VARIANTS)("AC-7: %s keeps comment style and wording at the lower severity", (variant) => {
    const body = skillBody(variant);
    const start = body.indexOf("### 5.3 ");
    const section = start < 0 ? "" : body.slice(start, body.indexOf("\n### ", start + 1));
    const low = section.split(/\r?\n/).find((line) => line.includes("**LOW**")) ?? "";
    expect(low, "comment style was escalated along with the claim check").toContain("주석");
  });
});

describe("FR-FLOW-120 — the mirror is asserted, not manually synced", () => {
  it("AC-8: the .agents mirror carries the same axis table as skills/codex", () => {
    const source = axisRows(skillBody("codex"));
    const mirror = axisRows(readFileSync(path.join(REPO_ROOT, ".agents/skills/kiwi-coder/SKILL.md"), "utf8"));
    expect(mirror, "the mirror lost the axis table").toEqual(source);
  });

  it("AC-8: the mirror carries the prose too, not only the table rows", () => {
    // Asserting the rows alone let the mirror lose the bound and the severity routing undetected —
    // the two sentences that decide whether the axis is limited and whether it can fire.
    const mirror = readFileSync(path.join(REPO_ROOT, ".agents/skills/kiwi-coder/SKILL.md"), "utf8");
    expect(mirror, "the mirror lost the bounding sentence").toContain("닫힌 4종 밖의 주석 주장은 finding 이 아니다");
    expect(mirror, "the mirror lost the gate-blocking severity routing").toContain("축 8 닫힌 4종의 주석 주장이 거짓으로 측정됨");
  });

  it.each(VARIANTS)("AC-2: %s closes the set at the fourth kind", (variant) => {
    // A verifier re-opened the set inside the same sentence — "…, 및 리뷰어가 코드로 확인 가능하다고
    // 보는 임의의 주장" — with the closure token still present. The row has to END at the fourth kind.
    const row = commentAxisRow(skillBody(variant)) ?? "";
    const afterClosure = row.slice(row.indexOf("닫힌 4종만"));
    const kinds = afterClosure.split(",").length;
    expect(kinds, `the row lists ${kinds} comma-separated kinds after the closure marker, not 4`).toBe(4);
    expect(afterClosure, "the row admits a fifth kind after the closed four").not.toMatch(/임의의|그 외|등[,)\s]|기타/);
  });
});

/**
 * Every assertion above this point that guards the axis against being re-opened is a DENYLIST: it
 * names the escapes a verifier already found — `임의의`, `그 외`, `경우에 한`, `재량`, `새로 추가`. The
 * requirement's own Implementation Note records why that can never be finished: Korean expresses
 * "except" in indefinitely many ways, so a clause re-opening the closed set survives any finite list
 * of forbidden tokens. Four rounds and 30+ mutations reached that boundary and stopped there.
 *
 * The cases below replace the open-ended question "does this text still mean what it meant?" with a
 * total one: "is this text the text?" Equality has no residue — a rewording that no denylist could
 * anticipate fails it for the same reason a deletion does. The cost is deliberate and is the whole
 * trade: these four cells are now golden, and changing the axis means changing this file, in the same
 * commit, on purpose. That is the intended friction, not an accident of the test.
 *
 * Scope is four cells, not the file: the axis row, the sentence that bounds the axis, and the two
 * §5.3 lines that decide whether a finding blocks. Pinning more would make ordinary edits elsewhere
 * in a 900-line skill fail for no gain.
 */
const COPIES: ReadonlyArray<readonly [label: string, relPath: string]> = [
  ["skills/claude", "skills/claude/kiwi-coder/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-coder/SKILL.md"],
  ["skills/etc", "skills/etc/kiwi-coder/SKILL.md"],
  [".agents mirror", ".agents/skills/kiwi-coder/SKILL.md"],
];

/**
 * Collapses whitespace runs and normalizes to NFC — so re-wrapping a line or writing a decomposed
 * Hangul syllable is not a failure — and nothing else. Every other difference is a difference.
 */
function canonical(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

const CANONICAL_AXIS_ROW = canonical(
  "| 8 | 주석 주장 | 주석이 코드에 대해 단언하는 것이 참인가 — 닫힌 4종만: 파일·디렉터리 경로, 코드 심볼명, 개수, 부재 주장 (`호출자 없음` · `not wired`) |"
);

const CANONICAL_BOUND = canonical(
  "**축 8 의 경계**: 닫힌 4종 밖의 주석 주장은 finding 이 아니다 — 의도·설계 의견을 다투지 않는다. 4종은 `existsSync` · `grep -c` 로 판정되므로 축 8 은 라운드당 비용이 사실상 0 이며, 임의 주석을 코드와 대조하는 비용(요구 1건당 약 27초 수준의 추론)을 지지 않는다."
);

const CANONICAL_HIGH = canonical(
  "- **HIGH**: 테스트 fail, DoD 미충족, 의도 이탈, acceptance_tests fail, 축 8 닫힌 4종의 주석 주장이 거짓으로 측정됨"
);

const CANONICAL_LOW = canonical("- **LOW**: 스타일, 주석 표현·서식");

function copyBody(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** §5.3 with fenced content blanked, so a fenced decoy copy of the severity list cannot satisfy a pin. */
function severitySection(body: string): string {
  const masked = maskFences(body);
  const start = masked.indexOf("### 5.3 ");
  if (start < 0) return "";
  const end = masked.indexOf("\n### ", start + 1);
  return end < 0 ? masked.slice(start) : masked.slice(start, end);
}

describe("FR-FLOW-120 — the axis contract is pinned by canonical equality, not by a denylist", () => {
  it.each(COPIES)("AC-2/AC-3: %s carries the axis row verbatim", (_label, relPath) => {
    const row = commentAxisRow(copyBody(relPath));
    expect(row, "the comment-claim axis row is absent from §5.2").toBeDefined();
    expect(canonical(row ?? "")).toBe(CANONICAL_AXIS_ROW);
  });

  it.each(COPIES)("AC-3: %s carries the bounding sentence verbatim", (_label, relPath) => {
    const bound = axisSection(copyBody(relPath))
      .split("\n")
      .find((line) => line.startsWith("**축 8 의 경계**"));
    expect(bound, "the sentence bounding axis 8 is absent from §5.2").toBeDefined();
    expect(canonical(bound ?? "")).toBe(CANONICAL_BOUND);
  });

  it.each(COPIES)("AC-7: %s carries the blocking severity line verbatim", (_label, relPath) => {
    const section = severitySection(copyBody(relPath));
    expect(section, "§5.3 was not found outside a fence").not.toBe("");
    const high = section.split("\n").find((line) => line.includes("**HIGH**"));
    expect(high, "§5.3 declares no HIGH line").toBeDefined();
    expect(canonical(high ?? "")).toBe(CANONICAL_HIGH);
  });

  it.each(COPIES)("AC-7: %s carries the non-blocking severity line verbatim", (_label, relPath) => {
    const section = severitySection(copyBody(relPath));
    const low = section.split("\n").find((line) => line.includes("**LOW**"));
    expect(low, "§5.3 declares no LOW line").toBeDefined();
    expect(canonical(low ?? "")).toBe(CANONICAL_LOW);
  });

  /**
   * The Phase 2 pass condition, per copy. It is NOT one golden string: `skills/etc` runs a different
   * loop — a single delegated reviewer, exiting on three consecutive rounds with no actionable
   * improvement — and names no severity at all, while the other three exit on `CRITICAL=0 + HIGH=0`.
   * That divergence is older than this axis and is not drift.
   *
   * It is pinned because AC-7's whole claim is that an axis-8 finding can STOP the pipeline, and
   * nothing was asserting the sentence that decides whether it can. An auditor rewrote the claude
   * gate to `CRITICAL=0 + green 확정` with `HIGH 이하는 정보성 보고이며 통과를 막지 않는다` and all 83
   * cases stayed green: every AC-7 assertion reads the severity LIST, and the list was untouched.
   * The routing survived; what the routing was for did not.
   */
  const CANONICAL_PHASE2_GATE = new Map(
    [
      ["skills/claude", "Phase 2 통과 조건: **CRITICAL=0 + HIGH=0 + green 확정**."],
      ["skills/codex", "Phase 2 통과 조건: **CRITICAL=0 + HIGH=0 + green 확정**."],
      ["skills/etc", "Phase 2 통과 조건: **green 확정 + 단일 evaluator 3회 연속 no actionable improvement**."],
      [".agents mirror", "Phase 2 통과 조건: **CRITICAL=0 + HIGH=0 + green 확정**."]
    ].map(([label, text]) => [label as string, canonical(text as string)])
  );

  it.each(COPIES)("AC-7: %s carries its Phase 2 pass condition verbatim", (label, relPath) => {
    const gate = severitySection(copyBody(relPath))
      .split("\n")
      .find((line) => line.startsWith("Phase 2 통과 조건"));
    expect(gate, "§5.3 declares no Phase 2 pass condition").toBeDefined();
    expect(canonical(gate ?? "")).toBe(CANONICAL_PHASE2_GATE.get(label));
  });

  it.each(COPIES)("AC-4: %s carries the @req prohibition paragraph verbatim", (_label, relPath) => {
    // AC-4 says the prohibition is present AND UNWEAKENED. Only the presence of five literal strings
    // was checked, so an auditor added `위 금지는 축 8 에 적용되지 않는다 …` immediately below it — a
    // prohibition explicitly disapplied for exactly the new axis, which is prohibited act (c) — and
    // all 83 cases stayed green. Presence cannot see an exemption; equality can.
    //
    // The paragraph differs between copies only in the parenthetical naming each variant's reviewer
    // configuration, so it is pinned per copy against the text on disk at the time AC-4 was judged,
    // by the invariant that matters: the paragraph is exactly one line, and the line that follows it
    // inside §5.2 does not mention the axis.
    const body = copyBody(relPath);
    const lines = maskFences(body).split("\n");
    // The skill states this prohibition TWICE — once for the Phase 1 verifiers (S1~S4) and once for
    // the prickly review in §5.2. AC-4 is about the second, and searching from the top of the file
    // found the first, whose wording carries no lettered acts. Scope to §5.2 or assert the wrong one.
    const sectionStart = lines.findIndex((line) => /^### 5\.2 /.test(line));
    expect(sectionStart, "§5.2 was not found outside a fence").toBeGreaterThan(-1);
    const index = lines.findIndex((line, at) => at > sectionStart && line.includes("`@req` 태그 검증 금지"));
    expect(index, "the @req prohibition is gone from §5.2 or fenced").toBeGreaterThan(-1);
    const paragraph = lines[index] ?? "";
    for (const act of ["(a) 존재 여부 점검", "(b) task.req_ids 와 비교", "(c) REQ-ID 실재성 검증", "(d) 라인 누락을 finding 으로 발행"]) {
      expect(paragraph, `the prohibition lost ${act}`).toContain(act);
    }
    expect(paragraph, "the prohibition no longer says the tag affects no gate").toContain("어떤 게이트에도 영향 주지 않는다");

    // Nothing after it may carve the new axis out of it. Read forward to the end of the section
    // rather than only the next line: an exemption is worth writing anywhere a reader will meet it.
    const after = lines.slice(index + 1, lines.findIndex((line, at) => at > index && /^### /.test(line)));
    const exemptions = after.filter((line) => /축\s*8|주석 주장/.test(line) && /적용되지 않는|예외|면책|제외/.test(line));
    expect(exemptions, "a sentence exempts the comment-claim axis from the @req prohibition").toEqual([]);
  });

  it("AC-5/AC-8: the four pinned cells are identical across every copy", () => {
    // Equality to the golden implies mutual equality, so this case adds nothing on a green run. It
    // earns its place on a red one: when someone updates the axis they will update the golden, and
    // this is the case that then reports WHICH copy they forgot rather than four separate failures
    // that each look like the same edit.
    const fingerprints = COPIES.map(([label, relPath]) => {
      const body = copyBody(relPath);
      const section = severitySection(body);
      return {
        label,
        cells: [
          canonical(commentAxisRow(body) ?? ""),
          canonical(axisSection(body).split("\n").find((line) => line.startsWith("**축 8 의 경계**")) ?? ""),
          canonical(section.split("\n").find((line) => line.includes("**HIGH**")) ?? ""),
          canonical(section.split("\n").find((line) => line.includes("**LOW**")) ?? ""),
        // A separator that cannot occur inside a canonicalised cell, written as an ESCAPE rather than
        // as the character itself. This line once held a literal NUL: it worked, and it made the whole
        // file binary to ripgrep — which is how four files under src/ came to be invisible to every
        // source census in this repository.
        ].join("\u001e"),
      };
    });
    const distinct = new Set(fingerprints.map((entry) => entry.cells));
    expect(
      distinct.size,
      `copies disagree on the pinned cells: ${fingerprints.map((entry) => entry.label).join(", ")}`
    ).toBe(1);
  });
});
