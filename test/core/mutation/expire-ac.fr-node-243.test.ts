import { describe, expect, it } from "vitest";
import { todayStamp } from "../../../src/core/date-stamp.js";
import { expireAcceptanceCriterion } from "../../../src/core/mutation/expire-ac.js";
import { editAcceptanceCriteria, setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria } from "../../../src/core/mutation/edit-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";

const THREE_LIVE = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"];

describe("FR-NODE-243 AC-1 — one patch rewrites the line and appends a Change Notes row", () => {
  // @req FR-NODE-243 AC-1
  it("rewrites the line to the expired grammar with today's local date, keeps the checkbox and records the reason", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const before = todayStamp();
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-1", reason: "moved to the PRD tool" });
    const after = todayStamp();
    expect(result.ok).toBe(true);
    const text = await scopeText(rootPath);
    const stamp = text.includes(`[EXPIRED ${before}]`) ? before : after;
    expect(text).toContain(`- [x] AC-1: ~~first~~ [EXPIRED ${stamp}]`);
    expect(text).toContain("- [ ] AC-2: second");
    expect(text).toContain(`| ${stamp} | Expired AC-1 | moved to the PRD tool |`);
    expect(result.value).toMatchObject({ id: "FR-ARCH-001", acId: "AC-1", expiredOn: stamp, written: true });
  });

  // @req FR-NODE-243 AC-1
  it("keeps an unchecked box unchecked", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "gone" });
    expect(await scopeText(rootPath)).toMatch(/- \[ \] AC-2: ~~second~~ \[EXPIRED \d{4}-\d{2}-\d{2}\]/);
  });

  // @req FR-NODE-243 AC-1
  it("writes nothing on dryRun", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const original = await scopeText(rootPath);
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-1", reason: "x", dryRun: true });
    expect(result.ok).toBe(true);
    expect(await scopeText(rootPath)).toBe(original);
  });
});

describe("FR-NODE-243 AC-2 — a successor must exist", () => {
  // @req FR-NODE-243 AC-2
  it("writes an existing successor into the marker", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-3", reason: "moved", successor: "FR-ARCH-002" });
    expect(result.ok).toBe(true);
    expect(await scopeText(rootPath)).toMatch(/- \[x\] AC-3: ~~third~~ \[EXPIRED \d{4}-\d{2}-\d{2} → FR-ARCH-002\]/);
  });

  // @req FR-NODE-243 AC-2
  it("refuses without writing when the successor does not exist", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const original = await scopeText(rootPath);
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-3", reason: "moved", successor: "FR-ARCH-404" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("FR-ARCH-404");
    expect(await scopeText(rootPath)).toBe(original);
  });
});

describe("FR-NODE-243 AC-2 — a successor must be another requirement that is not discarded", () => {
  // @req FR-NODE-243 AC-2
  it("refuses without writing when the successor is the requirement being edited", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const original = await scopeText(rootPath);
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-3", reason: "moved", successor: "FR-ARCH-001" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/itself/);
    expect(await scopeText(rootPath)).toBe(original);
  });

  // @req FR-NODE-243 AC-2
  it("refuses without writing when the successor is discarded", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE, successorStatus: "discarded" });
    const original = await scopeText(rootPath);
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-3", reason: "moved", successor: "FR-ARCH-002" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/discarded/);
    expect(await scopeText(rootPath)).toBe(original);
  });
});

describe("FR-NODE-243 AC-3 — refusals and no verified exit", () => {
  // @req FR-NODE-243 AC-3
  it("refuses without writing when the reason is empty or blank", async () => {
    const rootPath = await acFixture({ acLines: THREE_LIVE });
    const original = await scopeText(rootPath);
    const root = await resolveProjectRoot(rootPath);
    expect((await expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-1", reason: "" })).ok).toBe(false);
    expect((await expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-1", reason: "   " })).ok).toBe(false);
    expect(await scopeText(rootPath)).toBe(original);
  });

  // @req FR-NODE-243 AC-3
  it("refuses without writing when the criterion is already expired", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: live too", "- [x] AC-3: ~~old~~ [EXPIRED 2026-11-03]"] });
    const original = await scopeText(rootPath);
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-3", reason: "again" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/already expired/);
    expect(await scopeText(rootPath)).toBe(original);
  });

  // @req FR-NODE-243 AC-3
  it("refuses without writing when it is the last live criterion", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03]"] });
    const original = await scopeText(rootPath);
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-1", reason: "last" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/last live/);
    expect(await scopeText(rootPath)).toBe(original);
  });

  // @req FR-NODE-243 AC-3
  it("expires a criterion of a verified requirement without leaving verified", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: first", "- [x] AC-2: second"],
      status: "verified",
      evidenceRows: ["| EV-1 | test | docs/spec/00.index.md | all | fixture |"]
    });
    const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "moved" });
    expect(result.ok).toBe(true);
    const text = await scopeText(rootPath);
    expect(text).toContain("| Status | verified |");
    expect(text).toMatch(/AC-2: ~~second~~ \[EXPIRED /);
  });
});

describe("FR-NODE-243 AC-4 — check and edit refuse an expired criterion", () => {
  const LINES = ["- [ ] AC-1: live", "- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03]"];

  // @req FR-NODE-243 AC-4
  it("check_acceptance_criteria refuses a named expired criterion and says it is expired", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const original = await scopeText(rootPath);
    const result = await setAcceptanceCriteriaChecked(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acIds: ["AC-1", "AC-2"], checked: true });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/AC-2 is expired/);
    expect(await scopeText(rootPath)).toBe(original);
  });

  // @req FR-NODE-243 AC-4
  it("check_acceptance_criteria with all leaves expired criteria unchanged", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const result = await setAcceptanceCriteriaChecked(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    expect(result.ok).toBe(true);
    const text = await scopeText(rootPath);
    expect(text).toContain("- [x] AC-1: live");
    expect(text).toContain("- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03]");
  });

  // @req FR-NODE-243 AC-4
  it("the AC text edit refuses an expired criterion and says it is expired", async () => {
    const rootPath = await acFixture({ acLines: LINES });
    const original = await scopeText(rootPath);
    const result = await editAcceptanceCriteria(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-2", text: "revived" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/AC-2 is expired/);
    expect(await scopeText(rootPath)).toBe(original);
  });
});

describe("FR-NODE-243 AC-5 — replace_acceptance_criteria keeps expired lines and their numbers", () => {
  // @req FR-NODE-243 AC-5
  it("keeps the expired lines byte-for-byte and never assigns an expired number", async () => {
    const expiredLine = "- [x] AC-2: ~~old  spacing kept~~ [EXPIRED 2026-11-03 → FR-ARCH-002]";
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", expiredLine, "- [ ] AC-3: other"] });
    const result = await replaceAcceptanceCriteria(await resolveProjectRoot(rootPath), {
      id: "FR-ARCH-001",
      items: [{ text: "new one", checked: true }, { text: "new two" }, { text: "new three" }]
    });
    expect(result.ok).toBe(true);
    const text = await scopeText(rootPath);
    const acLines = text.split("\n").filter((line) => /^- \[[ x]\] AC-\d+:/.test(line) && !line.includes("successor exists"));
    expect(acLines).toEqual(["- [x] AC-1: new one", expiredLine, "- [ ] AC-3: new two", "- [ ] AC-4: new three"]);
  });
});
