import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";

import { main } from "../../src/cli/index.js";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  REPO_ROOT,
  readVariant,
  section,
  stripFrontmatter
} from "./kiwi-orchestrator-variants.js";
import { scanUnits } from "./kiwi-renderings.js";

/**
 * @req FR-FLOW-170 — §3.1 tells a run to release only the lease it took. Following that instruction
 * takes a way to decide which lease is its own, and the section named none: `holder.owner` is one
 * constant for every run because the CLI default is one string and no rendering passes `--owner`.
 *
 * The half that made the instruction unfollowable was the acquisition, which returned a lock path
 * and nothing else. FR-NODE-204 makes it name the holder it published; this requirement puts the
 * comparison into the shipped text and — the part that matters here — checks the text against the
 * shipped commands, so an instruction naming a field nothing returns cannot ship.
 */

const SRS_PATH = "docs/spec/60.workflow-release.srs.md";
const COPIES = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];

/** The guard FR-FLOW-168 shipped, which this requirement supplies the means to obey. */
const GUARD = "종료 해제는 이 run 이 취득한 lease 에 대해서만 부른다";

/** The file §1's fixed resume procedure reads first, and so the only place a pin survives compaction. */
const RUN_CONTRACT = "00.run-contract.md";

/** The shared ledger that owns the run contract's closed list, in the same four renderings. */
const LEDGER_COPIES = [
  "skills/claude/_shared/kiwi/run-ledger.md",
  "skills/codex/_shared/kiwi/run-ledger.md",
  "skills/etc/_shared/kiwi/run-ledger.md",
  ".agents/skills/_shared/kiwi/run-ledger.md"
] as const;

const scratch: string[] = [];

afterAll(() => {
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

/** §3.1 of one rendering. */
function runLockSection(relPath: string): string {
  return section(stripFrontmatter(readVariant(relPath)), /^#{2,4}\s+3\.1\.?\s/);
}

/**
 * The block of §3.1 that carries the comparison.
 *
 * Located by the noun the response uses rather than by the field names themselves: locating it by
 * the names would make the extraction below agree with itself no matter what the section says.
 */
function comparisonBlock(text: string): string {
  const blocks = scanUnits(text).filter((unit) => unit.text.includes("holder"));
  expect(blocks.length, "§3.1 must carry the comparison in exactly one block, not zero or several").toBe(1);
  return (blocks[0] as { text: string }).text;
}

/** The field names the shipped instruction tells a run to compare, read out of the shipped text. */
function comparisonFields(relPath: string): string[] {
  const runs = [...comparisonBlock(runLockSection(relPath)).matchAll(/(?:`[A-Za-z][A-Za-z0-9]*`\s*·\s*)+`[A-Za-z][A-Za-z0-9]*`/g)];
  expect(runs.length, `${relPath}: the comparison block must name its fields as exactly one list`).toBe(1);
  return [...(runs[0] as RegExpMatchArray)[0].matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((match) => match[1] as string);
}

/**
 * The DISTINCT names that list carries.
 *
 * Counting tokens accepts a list of four repetitions of one name, which is an instruction to compare
 * `owner` alone — the incapacity FR-NODE-204 AC-3 measures by execution. What bounds the instruction
 * has to be how many values it actually weighs. @req FR-FLOW-170 AC-2
 */
function distinctComparisonFields(relPath: string): string[] {
  return [...new Set(comparisonFields(relPath))];
}

/**
 * The command the block tells a run to call for the half of the comparison it reads.
 *
 * Read out of the text rather than assumed: an instruction naming a command that reports no holder
 * is unfollowable in the same way as one naming a field nothing returns, and only naming the field
 * was checked. @req FR-FLOW-170 AC-2
 */
function readCommand(relPath: string): string {
  const matches = [...comparisonBlock(runLockSection(relPath)).matchAll(/`([a-z][a-z-]*)`\s*[를을]\s*불러/g)];
  // Exactly one, not the first of however many: taking the first would exercise one command while a
  // second went unchecked, which is the denominator this file already guards on the field axis.
  expect(matches.length, `${relPath}: the comparison block must name exactly one command to call, not ${matches.length}`).toBe(1);
  return (matches[0] as RegExpMatchArray)[1] as string;
}

/** Every line of one rendering that lies outside §3.1 — the scope both denominators below run over. */
function outsideRunLockSection(relPath: string): string[] {
  const inSection = new Set(runLockSection(relPath).split("\n"));
  return stripFrontmatter(readVariant(relPath))
    .split("\n")
    .filter((line) => !inSection.has(line));
}

/**
 * Every line outside §3.1 that instructs a release of the run lock, read by the narrow wording.
 *
 * This is a SUBSET, used only as a floor: a rule stated for one release site leaves the others
 * reading as unconditional, so the count must not fall. It is not the coverage denominator —
 * scanning for the release verb would let a site escape by choosing another one. @req FR-FLOW-170 AC-6
 */
function releaseSites(relPath: string): string[] {
  return outsideRunLockSection(relPath).filter((line) => /run lock/.test(line) && line.includes("해제"));
}

/**
 * Every line outside §3.1 that names the lock — by the noun the thing is called, not by the verb
 * that drops it.
 *
 * A denominator gathered by release wording is escaped by rephrasing: `run lock 을 해제한다` and
 * `그 lease 를 놓는다` are one site written two ways, and a scan for `해제` reaches only the first,
 * so the second would never face the check below. What a release site cannot avoid is naming the
 * thing it releases. The release-verb arm is kept as a union, not as the filter, so a line that
 * drops a lock under some other noun is still gathered. @req FR-FLOW-170 AC-6
 */
function lockMentions(relPath: string): string[] {
  return outsideRunLockSection(relPath).filter(
    (line) =>
      /run lock|run unlock|unlock|lease|orchestrate_run_lock/.test(line) ||
      (/해제|놓는다|놓아|반납|푼다|풀린다|풀리지|release/.test(line) && /lock/i.test(line))
  );
}

/**
 * The lines of that net which do not order a release of the P.5 lease — four name another lease,
 * two state when the abort release lands rather than ordering one — subtracted by an enumerated
 * table rather than filtered out by a predicate.
 *
 * A predicate would let a fifth release site join this set by wording alone and disappear silently.
 * A table cannot grow without an edit here, and the test fails if an entry stops matching exactly
 * one line — so a subtraction that goes stale is loud rather than quiet. @req FR-FLOW-170 AC-6
 */
const NOT_A_RELEASE_SITE = [
  { needle: "lease 밖 쓰기 금지", why: "the lane's write scope in §1.1's forbidden-action list" },
  { needle: "승격의 lease 위생", why: "the step lease an R-STEP promotion abandons" },
  { needle: "여섯 lane 동사", why: "the verb enum, where `release-lane` drops a lane lease" },
  { needle: "수확이 끝난 뒤에만", why: "returning a worktree, which is not a lease at all" },
  { needle: "기록이 착지한 뒤에만", why: "when the abort release lands, not a site that orders one" },
  { needle: "그 기록이 막히면", why: "the same condition restated in §V.abort-run" }
] as const;

/**
 * How many fields the shipped list must carry, read from AC-2's own `fields N`.
 *
 * A floor written here could be lowered in the same edit that shortens the instruction. Read from
 * the requirement, shortening it costs a requirement diff. @req FR-FLOW-170 AC-2
 */
function fieldFloor(): number {
  const document = readFileSync(path.join(REPO_ROOT, SRS_PATH), "utf8");
  const start = document.indexOf("### FR-FLOW-170 ");
  expect(start, "FR-FLOW-170 is not in the scope document, so the floor has no source").toBeGreaterThan(-1);
  const floor = /`fields (\d+)`/.exec(document.slice(start, start + 6000))?.[1];
  expect(floor, "AC-2 names no `fields N`, so nothing bounds the list the text may ship").toBeDefined();
  return Number(floor);
}

const FIELD_FLOOR = fieldFloor();

interface Envelope {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

/** A scratch git repository, because the run lock is keyed on the git common dir. */
function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), "flow170-"));
  scratch.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
  return root;
}

async function cli(root: string, args: readonly string[]): Promise<Envelope> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main(["--root", root, "orchestrate", ...args, "--json"], { stdout, stderr } as never);
  const text = stdout.read()?.toString() ?? "";
  return { exit, payload: text.trim().length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("FR-FLOW-170 §3.1 says how a run tells its own lease from a successor's", { timeout: 120_000 }, () => {
  describe.each(COPIES)("%s", (relPath) => {
    it("AC-1: records what the acquisition named, compares it at release, and releases only on a match", () => {
      const text = runLockSection(relPath);
      expect(text, `${relPath}: §3.1 does not exist`).not.toBe("");
      const block = comparisonBlock(text);
      // Three steps, all in the one block, because a step in a different paragraph is a step a reader
      // can follow without the other two.
      expect(block, `${relPath}: §3.1 does not say to record what P.5 named`).toContain("적어 둔다");
      expect(block, `${relPath}: §3.1 does not say to compare before the release`).toContain("대조한다");
      expect(block, `${relPath}: §3.1 does not make the release conditional on a full match`).toContain("전부 같을 때에만");
      expect(block, `${relPath}: the conditional step does not name the release action`).toContain("unlock");
    });

    it("AC-2: the fields the instruction names are exactly the fields the shipped commands return", async () => {
      const fields = distinctComparisonFields(relPath);
      expect(fields.length, `${relPath}: the instruction weighs fewer distinct values than the requirement admits: ${comparisonFields(relPath).join("·")}`)
        .toBeGreaterThanOrEqual(FIELD_FLOOR);

      const root = repository();
      const taken = await cli(root, ["run", "lock"]);
      expect(taken.exit, `taking the lock is the precondition: ${JSON.stringify(taken.payload)}`).toBe(0);
      const reported = await cli(root, ["run", "status"]);

      const acquired = taken.payload.holder as Record<string, unknown> | undefined;
      const observed = reported.payload.holder as Record<string, unknown> | null;
      expect(acquired, "`run lock` names no holder, so the instruction's first step cannot be taken").toBeDefined();
      expect(observed, "`run status` names no holder while the lock is held").not.toBeNull();
      // Set equality, not containment: containment lets the text ship a shorter comparison than the
      // response supports, and one repeated name satisfies a count while weighing a single value.
      expect([...fields].sort(), `${relPath}: the instruction and \`run lock\` do not name the same set`)
        .toEqual(Object.keys(acquired as Record<string, unknown>).sort());
      expect([...fields].sort(), `${relPath}: the instruction and \`run status\` do not name the same set`)
        .toEqual(Object.keys(observed as Record<string, unknown>).sort());
    });

    it("AC-2: the command the instruction says to call is one that reports a holder", async () => {
      const verb = readCommand(relPath);
      const root = repository();
      const taken = await cli(root, ["run", "lock"]);
      expect(taken.exit, `taking the lock is the precondition: ${JSON.stringify(taken.payload)}`).toBe(0);

      // Run whatever the text named, not what this file expects it to have named.
      const answer = await cli(root, ["run", verb]);
      expect(answer.payload, `${relPath}: \`run ${verb}\` reports no holder, so the comparison cannot be made from it`)
        .toHaveProperty("holder");
      expect(answer.payload.holder, `${relPath}: \`run ${verb}\` reports a null holder while the lock is held`).not.toBeNull();
    });

    it("AC-3: an unnameable holder is excluded from release rather than treated as free", () => {
      const block = comparisonBlock(runLockSection(relPath));
      expect(block, `${relPath}: §3.1 does not say what a null holder means for the release`).toContain("null");
      expect(block, `${relPath}: §3.1 does not exclude an unnameable holder from the release`).toContain("해제 대상에서 제외한다");
    });

    it("AC-4: the guard this procedure serves is still shipped, in this section", () => {
      expect(runLockSection(relPath), `${relPath}: §3.1 no longer carries the guard`).toContain(GUARD);
    });

    it("AC-6: the pin is kept in the file §1 reads first, so a compacted session still holds one half", () => {
      const block = comparisonBlock(runLockSection(relPath));
      expect(block, `${relPath}: the block does not say where the pin outlives the conversation`).toContain(RUN_CONTRACT);

      // The comparison is only followable on the resume path if its input is read there. §1 fixes the
      // procedure a compacted session runs and forbids reading anything before it, so the pin has to
      // be in that procedure's first step or a resumed session reaches the release without one.
      const resume = section(stripFrontmatter(readVariant(relPath)), /^#{2}\s+1\.\s/);
      expect(resume, `${relPath}: §1 does not exist`).not.toBe("");
      const contractAt = resume.indexOf(RUN_CONTRACT);
      expect(contractAt, `${relPath}: §1's fixed procedure never reads ${RUN_CONTRACT}`).toBeGreaterThan(-1);
      for (const later of ["orchestrate preflight", "orchestrate resume"]) {
        const offset = resume.indexOf(later);
        expect(offset, `${relPath}: §1 does not run ${later}`).toBeGreaterThan(-1);
        expect(contractAt, `${relPath}: ${RUN_CONTRACT} is read after ${later}, so the pin is not the first thing recovered`)
          .toBeLessThan(offset);
      }
    });

    it("AC-6: the run contract's closed list admits the pin, so writing it there is not a breach", () => {
      const preamble = section(stripFrontmatter(readVariant(relPath)), /^#{3}\s+1\.1\s/);
      expect(preamble, `${relPath}: §1.1 does not exist`).not.toBe("");
      expect(preamble, `${relPath}: §1.1 calls the contents a closed list`).toContain("닫힌 목록");
      expect(preamble, `${relPath}: the closed list does not admit the pin, so §3.1 tells a run to breach it`)
        .toContain("P.5 pin");
    });

    it("AC-6: every line naming the lock outside §3.1 says which lease it concerns", () => {
      const mentions = lockMentions(relPath);
      const subtracted = new Set<string>();
      for (const { needle, why } of NOT_A_RELEASE_SITE) {
        const hits = mentions.filter((line) => line.includes(needle));
        expect(hits.length, `${relPath}: the subtraction for ${why} — ${JSON.stringify(needle)} — matches ${hits.length} lines, not one, so the table no longer describes the text`)
          .toBe(1);
        subtracted.add(hits[0] as string);
      }

      const governed = mentions.filter((line) => !subtracted.has(line));
      expect(governed.length, `${relPath}: the table subtracted every line naming the lock, so the rule governs nothing`)
        .toBeGreaterThanOrEqual(releaseSites(relPath).length);
      for (const line of governed) {
        expect(/P\.5|abort-run/.test(line), `${relPath}: a line names the lock without naming P.5 or abort-run, so which lease it concerns is unstated: ${line.trim().slice(0, 140)}`)
          .toBe(true);
      }
    });

    it("AC-6: every site that instructs a release resolves to the P.5 lease, and the rule covers them all", () => {
      const sites = releaseSites(relPath);
      // Four today — the promoted outcome, the refused de-escalation, §15's abort and §V.abort-run.
      expect(sites.length, `${relPath}: no release site outside §3.1, so the rule governs nothing`).toBeGreaterThanOrEqual(4);
      for (const site of sites) {
        expect(/P\.5|abort-run/.test(site), `${relPath}: a release site names neither P.5 nor abort-run, so which lease it drops is unstated: ${site.trim().slice(0, 140)}`)
          .toBe(true);
      }

      const block = comparisonBlock(runLockSection(relPath));
      expect(block, `${relPath}: the comparison is stated for one release site rather than for all of them`)
        .toContain("해제하는 모든 자리");
      // Three of the four sites are abort, and §3.1's own earlier paragraph hands abort to §15; without
      // naming abort the rule reads as governing the fourth site alone.
      expect(block, `${relPath}: the comparison does not reach the abort releases`).toContain("abort");
    });
  });

  it.each(LEDGER_COPIES)("AC-6: %s admits the pin in the run contract's closed list", (relPath) => {
    const preamble = section(readFileSync(path.join(REPO_ROOT, relPath), "utf8"), /^#{2}\s*7\./);
    expect(preamble, `${relPath}: the run-contract preamble section does not exist`).not.toBe("");
    expect(preamble, `${relPath}: the shared ledger's closed list omits the pin the skill tells a run to write`)
      .toContain("P.5 pin");
  });

  it("AC-5: the four renderings name the same comparison fields", () => {
    const perCopy = COPIES.map((relPath) => ({ relPath, fields: comparisonFields(relPath).join("·") }));
    expect(new Set(perCopy.map((entry) => entry.fields)).size, JSON.stringify(perCopy)).toBe(1);
  });
});
