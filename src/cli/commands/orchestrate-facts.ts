import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WaveSdsDigest } from "../../core/orchestrator/freeze.js";
import type { OrchTrailerCommit } from "../../core/orchestrator/lane-state.js";
import type { ResumeCard } from "../../core/orchestrator/resume-card.js";
import type { DriftInputs, GitFacts } from "../../core/orchestrator/resume.js";
import { routeLockDigest, type RouteLock } from "../../core/orchestrator/route-lock.js";
import { declarationEntryDigest, parseWaveDeclaration } from "../../core/orchestrator/wave-declaration.js";
import type { WavesJournalView } from "../../core/orchestrator/waves-journal.js";
import { computeRunProgress } from "../../core/orchestrator/waves-validate.js";

// @req FR-NODE-216 AC-6, FR-NODE-217 AC-2 — the git facts the orchestrate verbs collect themselves.
//
// Collection lives here, in the CLI layer; the kernels under `src/core/orchestrator/` take what this
// reads as values and stay pure (FR-NODE-150).

/** How long one git call is given before it is abandoned. */
const GIT_TIMEOUT_MS = 10_000;

interface GitAnswer {
  /** The exit status; `null` when git could not be started or was killed. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one git command in `root`. A non-zero exit is an answer, not a failure — `merge-base
 * --is-ancestor` reports its verdict that way — so nothing here throws.
 */
export function git(root: string, args: readonly string[]): Promise<GitAnswer> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, ...args],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

/**
 * The paths tracked at HEAD, which is the dispatch base at scheduling time. `null` when git cannot
 * answer (no repository, no commit), so the caller can say what to pass instead. @req FR-NODE-216 AC-6
 */
export async function trackedPathsAtHead(root: string): Promise<string[] | null> {
  // `--full-tree`: repository-relative names however deep `root` sits, as declared paths are written.
  const answer = await git(root, ["ls-tree", "-r", "--full-tree", "--name-only", "-z", "HEAD"]);
  if (answer.code !== 0) return null;
  return answer.stdout.split("\0").filter((entry) => entry.length > 0);
}

// --- resume facts -------------------------------------------------------------------------------

/**
 * The pointer a card records for a file the tools wrote: `<path>@sha256:<hex>`, the sha256 of the
 * file's bytes. One definition for the verbs that report it (`freeze`, `schedule waves`) and for the
 * resume that recomputes it, as the route lock pointer already is (`frozenRouteEntry`). A freeze lock's
 * own `sha256` field is its seal, not this. @req FR-NODE-217 AC-2
 */
export function filePointer(relativePath: string, bytes: string | Buffer): string {
  return `${relativePath}@sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** A file's sha256, or `null` when it cannot be read. */
async function fileSha256(root: string, relativePath: string): Promise<string | null> {
  const bytes = await readFile(path.resolve(root, relativePath)).catch(() => null);
  return bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
}

/** The path half of a `<path>@sha256:<hex>` pointer. */
function pointerPath(pointer: string): string {
  return pointer.slice(0, pointer.lastIndexOf("@"));
}

/**
 * A card pointer re-taken over the file as it is now, in the card's own `<path>@sha256:<hex>` form,
 * so digest 1 compares like with like. A value that is not a pointer names nothing to re-read and is
 * handed back unchanged — there is nothing to compare it against.
 */
async function pointerNow(root: string, recorded: unknown): Promise<string> {
  if (typeof recorded !== "string" || !recorded.includes("@sha256:")) return recorded as string;
  const file = pointerPath(recorded);
  const bytes = await readFile(path.resolve(root, file)).catch(() => null);
  return bytes === null ? `${file}@missing` : filePointer(file, bytes);
}

async function readJsonOrNull(root: string, relativePath: string): Promise<unknown> {
  const text = await readFile(path.resolve(root, relativePath), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    // JSON.parse has no non-throwing form; an unparseable lock is read as absent, which digest 3 reports.
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The wave number a lock's wave id ends in (`…-wave-<n>`), or `null`. */
function trailingWaveNumber(waveId: string): number | null {
  const matches = [...waveId.matchAll(/wave-(\d+)/g)];
  const last = matches[matches.length - 1];
  return last === undefined ? null : Number.parseInt(last[1] as string, 10);
}

/**
 * Digest 3's two sides, read from the stage lock the card names and from the files that lock was
 * computed from. @req FR-NODE-217 AC-2, FR-NODE-216 AC-7
 */
async function laneInputs(
  root: string,
  runId: string,
  lanePointer: unknown,
  completeWaves: ReadonlySet<number>
): Promise<Pick<DriftInputs, "recordedLaneInputs" | "recomputedLaneInputDigests">> {
  const lockFile = typeof lanePointer === "string" && lanePointer.includes("@") ? pointerPath(lanePointer) : null;
  const read = lockFile === null ? null : await readJsonOrNull(root, lockFile);
  // A freeze envelope carries the schedule's body under `body`; the schedule writes the body bare.
  const body = isRecord(read) ? (isRecord(read.body) ? read.body : read) : {};
  const sdsDigests = (isRecord(body.sds_digests) ? body.sds_digests : {}) as Record<string, WaveSdsDigest>;
  const recordedDeclaration = isRecord(body.declaration_digests) ? (body.declaration_digests as Record<string, string>) : undefined;

  const nowSds: Record<string, WaveSdsDigest> = {};
  const closedOutWaves: string[] = [];
  const lanes = Array.isArray(body.lanes) ? body.lanes.filter(isRecord) : [];
  for (const lane of lanes) {
    const waveId = typeof lane.wave === "string" ? lane.wave : null;
    if (waveId === null || !(waveId in sdsDigests)) continue;
    const files = typeof lane.sds === "string" ? [lane.sds] : Array.isArray(lane.sds) ? lane.sds.filter((item): item is string => typeof item === "string") : [];
    const digests = await Promise.all(files.map(async (file) => [file, await fileSha256(root, file)] as const));
    const present = digests.filter((entry): entry is readonly [string, string] => entry[1] !== null);
    // FR-FLOW-183 AC-3 — a completed wave whose close-out deleted its SDS is not recomputed.
    const n = trailingWaveNumber(waveId);
    if (present.length === 0 && n !== null && completeWaves.has(n)) closedOutWaves.push(waveId);
    else if (typeof sdsDigests[waveId] === "string") {
      if (present[0] !== undefined) nowSds[waveId] = present[0][1];
    } else nowSds[waveId] = Object.fromEntries(present);
  }

  let nowDeclaration: Record<string, string> | undefined;
  if (recordedDeclaration !== undefined) {
    nowDeclaration = {};
    const parsed = typeof body.declaration === "string" ? parseWaveDeclaration(await readJsonOrNull(root, body.declaration)) : null;
    for (const entry of parsed?.ok === true ? parsed.declaration.waves : []) {
      nowDeclaration[`${runId}-${entry.wave}`] = declarationEntryDigest(entry);
    }
  }

  return {
    recordedLaneInputs: {
      sdsDigests,
      ...(recordedDeclaration === undefined ? {} : { declarationDigests: recordedDeclaration }),
      depends: (isRecord(body.depends) ? body.depends : {}) as Record<string, string[]>,
      laneCap: typeof body.lane_cap === "number" ? body.lane_cap : 0
    },
    recomputedLaneInputDigests: { sdsDigests: nowSds, closedOutWaves, ...(nowDeclaration === undefined ? {} : { declarationDigests: nowDeclaration }) }
  };
}

/** The route's probe and lock as they digest on disk now; `undefined` for a run with no frozen route. */
async function routeObserved(root: string, card: ResumeCard): Promise<DriftInputs["routeObserved"]> {
  const route = card.frozen?.route;
  if (route === undefined) return undefined;
  const lock = await readJsonOrNull(root, pointerPath(route.lock));
  if (!isRecord(lock)) return { probeDigest: "missing", lockDigest: "missing" };
  const probe = typeof lock.probe_path === "string" ? await fileSha256(root, lock.probe_path) : null;
  return { probeDigest: probe === null ? "missing" : `sha256:${probe}`, lockDigest: routeLockDigest(lock as unknown as RouteLock) };
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

/**
 * The paths `git status --porcelain=v1 -z` names: `XY path\0`, and for a rename or copy a second
 * `orig\0` entry that carries no status prefix. @req FR-NODE-217 AC-2
 */
export function parseStatusPaths(output: string): string[] {
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as string;
    paths.push(entry.slice(3));
    if (!/[RC]/.test(entry.slice(0, 2))) continue;
    index += 1;
    if (index < entries.length) paths.push(entries[index] as string);
  }
  return paths;
}

/** `git worktree list --porcelain`, one entry per block. */
function parseWorktrees(text: string): GitFacts["worktrees"] {
  return text
    .split(/\r?\n\r?\n/)
    .map(lines)
    .filter((block) => block.some((line) => line.startsWith("worktree ")))
    .map((block) => {
      const branch = block.find((line) => line.startsWith("branch "))?.slice("branch ".length) ?? null;
      return {
        path: (block.find((line) => line.startsWith("worktree ")) as string).slice("worktree ".length),
        branch: branch === null ? null : branch.replace(/^refs\/heads\//, ""),
        locked: block.some((line) => line === "locked" || line.startsWith("locked "))
      };
    });
}

/** Commits on the integration branch that name this run in an `Orch-Run` trailer, with their trailers. */
async function integrationCommits(root: string, branch: string, runId: string): Promise<OrchTrailerCommit[]> {
  const answer = await git(root, ["log", branch, "--fixed-strings", `--grep=Orch-Run: ${runId}`, "--format=%H%x1f%(trailers:only,unfold)%x1e"]);
  if (answer.code !== 0) return [];
  return answer.stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [commit, trailerText = ""] = record.split("\x1f");
      const trailers: Record<string, string> = {};
      for (const line of lines(trailerText)) {
        const colon = line.indexOf(":");
        if (colon > 0) trailers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
      return { commit: (commit as string).trim(), trailers };
    });
}

/** The git half of a resume's facts, read from the repository at `root`. @req FR-NODE-217 AC-2 */
async function collectGitFacts(root: string, card: ResumeCard, runId: string): Promise<GitFacts> {
  const branch = typeof card.frozen?.integration_branch === "string" ? card.frozen.integration_branch : "";
  const head = branch === "" ? null : await git(root, ["rev-parse", "--verify", "--quiet", `${branch}^{commit}`]);
  const integrationHead = head?.code === 0 ? head.stdout.trim() : "";

  const refs = await git(root, ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"]);
  const branches: GitFacts["branches"] = [];
  for (const line of refs.code === 0 ? lines(refs.stdout) : []) {
    const [name = "", sha = ""] = line.split("\t");
    // Only a lane's branch is ever looked up (`branchFor`), so the ancestry question is asked of those alone.
    if (!/(^|\/)lane-[^/]+$/.test(name)) continue;
    const ancestor = integrationHead === "" ? null : await git(root, ["merge-base", "--is-ancestor", sha, integrationHead]);
    branches.push({ name, sha, ancestorOfIntegration: ancestor?.code === 0 });
  }

  const worktrees = await git(root, ["worktree", "list", "--porcelain"]);
  const status = await git(root, ["status", "--porcelain=v1", "-z"]);
  return {
    branches,
    worktrees: worktrees.code === 0 ? parseWorktrees(worktrees.stdout) : [],
    // shortcut: no producer writes a lane heartbeat file yet and `computeResumeState` reads none; collect them when a contract names one.
    heartbeats: [],
    integrationHead,
    hostStatusPaths: status.code === 0 ? parseStatusPaths(status.stdout) : [],
    integrationCommits: integrationHead === "" ? [] : await integrationCommits(root, branch, runId)
  };
}

/**
 * Everything `computeResumeState` needs beyond the journal view and the card, read from the repository
 * at `root` rather than taken from the caller. Digest 2's comparand is deliberately left empty: there is
 * no per-verb list of declared inputs to re-digest, and the journal's own values compared against
 * themselves would always match — the caller reports that digest as unchecked. @req FR-NODE-217 AC-2, AC-3
 */
export async function collectResumeFacts(
  root: string,
  runId: string,
  card: ResumeCard,
  view: WavesJournalView
): Promise<{ gitFacts: GitFacts; driftInputs: DriftInputs }> {
  const progress = computeRunProgress(view);
  const completeWaves = new Set([...progress.waveStatuses].filter(([, status]) => status === "complete").map(([n]) => n));
  const frozen = card.frozen ?? ({} as ResumeCard["frozen"]);
  const lanePointer = frozen.lane_lock?.[`wave-${card.position?.wave}`];
  const route = await routeObserved(root, card);
  return {
    gitFacts: await collectGitFacts(root, card, runId),
    driftInputs: {
      lockDigests: {
        design: await pointerNow(root, frozen.design_lock),
        waves: await pointerNow(root, frozen.waves_lock),
        lanes: await pointerNow(root, lanePointer),
        issues: "",
        postmortem: ""
      },
      ...(await laneInputs(root, runId, lanePointer, completeWaves)),
      freshIntentDigests: {},
      ...(route === undefined ? {} : { routeObserved: route })
    }
  };
}
