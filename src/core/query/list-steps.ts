import { parseStepState } from "../parser/index-parser.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type {
  ListStepsResult,
  ProjectRoot,
  RequirementRecord,
  StepAdvisory,
  StepListEntry,
  StepStateEntry
} from "../types.js";

// @req FR-NODE-044
/**
 * FR-NODE-044 — list_steps topological ordering with cycle detection and advisories.
 *
 * The handler fresh-parses docs/spec/steps/state.md (FR-PARSE-026 row columns
 * Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated) from the
 * ProjectRoot and orders the steps with a Kahn topological sort that honours the
 * DependsOn edges. Alongside the order it emits advisory-only diagnostics from the
 * STEP_DIAGNOSTIC_CODES namespace (src/core/diagnostic-registry.ts):
 *   - AC-1: dependent steps are ordered after the steps they depend on.
 *   - AC-2: a DependsOn cycle sets `cycle` true and emits STEP_CYCLE instead of a
 *           silent partial order.
 *   - AC-3: STEP_SUPERSEDE_PROTECTED (a step superseding a verified/frozen
 *           requirement), an orphan advisory (a DependsOn edge pointing at a
 *           non-existent step), and STEP_DRIFT (a non-active step still touching a
 *           requirement that has since reached verified/frozen) where applicable.
 */
export interface ListStepsOptions {
  target?: string;
}

// @req FR-NODE-044
/** Split a DependsOn/TouchesReq cell (comma/space separated) into its tokens. */
function parseCellTokens(cell: string): string[] {
  return cell
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "" && token !== "-");
}

// @req FR-NODE-044
/** A non-active step has merged into history and no longer participates in flight. */
function isActiveStep(entry: StepStateEntry): boolean {
  return entry.status === "active" || entry.status === "merging";
}

// @req FR-NODE-044
/** A requirement is protected once it is verified or frozen (claim-step parity). */
function isProtectedRecord(record: RequirementRecord | undefined): boolean {
  return record !== undefined && (record.status === "verified" || record.stability === "frozen");
}

// @req FR-NODE-044
/** Parse `<!-- supersede: step -> target -->` markers seeded below the state table. */
function parseSupersedeMarkers(lines: readonly string[]): Map<string, string[]> {
  const markers = new Map<string, string[]>();
  const re = /<!--\s*supersede:\s*(\S+)\s*->\s*(.+?)\s*-->/;
  for (const line of lines) {
    const match = re.exec(line);
    if (!match) continue;
    const step = match[1];
    const targetCell = match[2];
    if (step === undefined || targetCell === undefined) continue;
    const targets = parseCellTokens(targetCell);
    const existing = markers.get(step) ?? [];
    markers.set(step, [...existing, ...targets]);
  }
  return markers;
}

// @req FR-NODE-044
/**
 * Kahn topological sort over the DependsOn edges. Returns the order plus the set
 * of step names that could not be placed (the members of one or more cycles);
 * an empty unordered set means a valid total order exists.
 */
function kahnOrder(
  steps: readonly StepStateEntry[],
  dependsOn: ReadonlyMap<string, string[]>
): { order: string[]; unordered: string[] } {
  const names = steps.map((step) => step.step);
  const present = new Set(names);
  // indegree[node] = number of present dependencies the node waits on.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const name of names) {
    indegree.set(name, 0);
    dependents.set(name, []);
  }
  for (const name of names) {
    for (const dep of dependsOn.get(name) ?? []) {
      // Only edges to present steps gate ordering; orphan edges are reported
      // separately and do not block the sort.
      if (!present.has(dep)) continue;
      indegree.set(name, (indegree.get(name) ?? 0) + 1);
      dependents.get(dep)?.push(name);
    }
  }
  // Seed the queue with zero-indegree steps in their declared order for stable output.
  const queue = names.filter((name) => (indegree.get(name) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    order.push(node);
    for (const dependent of dependents.get(node) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  const unordered = names.filter((name) => !order.includes(name));
  return { order, unordered };
}

// @req FR-NODE-044
export async function listSteps(root: ProjectRoot, options: ListStepsOptions = {}): Promise<ListStepsResult> {
  void options;
  const workspace = await parseWorkspace(root);
  const advisories: StepAdvisory[] = [];

  const stateFile = workspace.stateFile;
  if (!stateFile) {
    return { steps: [], advisories, cycle: false };
  }

  const entries = parseStepState(stateFile.lines);
  const byName = new Map<string, StepStateEntry>(entries.map((entry) => [entry.step, entry]));
  const supersedeMarkers = parseSupersedeMarkers(stateFile.lines);

  // Resolve requirement records (body + step origin) so supersede/drift advisories can inspect
  // the live status/stability of the touched requirements. Protection is a property of the
  // canonical body requirement, so on an id collision the body record MUST win: a same-id step
  // copy (often unprotected/draft) must never shadow a verified/frozen body record and silently
  // suppress STEP_SUPERSEDE_PROTECTED / STEP_DRIFT. Step records seed the map first and body
  // records overwrite, giving body-wins precedence.
  const recordById = new Map<string, RequirementRecord>();
  for (const record of workspace.stepRecords ?? []) {
    recordById.set(record.id, record);
  }
  for (const record of workspace.records) {
    recordById.set(record.id, record);
  }

  // Build the DependsOn adjacency and emit an orphan advisory per edge that points
  // at a step name absent from state.md.
  const dependsOn = new Map<string, string[]>();
  for (const entry of entries) {
    const deps = parseCellTokens(entry.dependsOn);
    dependsOn.set(entry.step, deps);
    for (const dep of deps) {
      if (!byName.has(dep)) {
        advisories.push({
          code: "STEP_ORPHAN",
          step: entry.step,
          message: `Step '${entry.step}' depends on missing step '${dep}'`
        });
      }
    }
  }

  const { order, unordered } = kahnOrder(entries, dependsOn);
  const cycle = unordered.length > 0;
  if (cycle) {
    advisories.push({
      code: "STEP_CYCLE",
      message: `DependsOn cycle detected among steps: ${unordered.join(", ")}`
    });
  }

  // AC-3: a step that supersedes a verified/frozen requirement is protected.
  for (const entry of entries) {
    for (const targetId of supersedeMarkers.get(entry.step) ?? []) {
      if (isProtectedRecord(recordById.get(targetId))) {
        advisories.push({
          code: "STEP_SUPERSEDE_PROTECTED",
          step: entry.step,
          message: `Step '${entry.step}' supersedes protected requirement '${targetId}'`
        });
      }
    }
  }

  // AC-3: a non-active (merged/abandoned) step whose touched requirement has since
  // reached verified/frozen has drifted away from the requirement's current state.
  for (const entry of entries) {
    if (isActiveStep(entry)) continue;
    for (const reqId of parseCellTokens(entry.touchesReq)) {
      if (isProtectedRecord(recordById.get(reqId))) {
        advisories.push({
          code: "STEP_DRIFT",
          step: entry.step,
          message: `Merged step '${entry.step}' touches requirement '${reqId}' that has moved on`
        });
      }
    }
  }

  // The ordered list follows the Kahn order; any unordered (cyclic) steps are
  // appended in declared order so callers still see every step.
  const orderedNames = cycle ? [...order, ...unordered] : order;
  const steps: StepListEntry[] = orderedNames.map((name) => {
    const entry = byName.get(name) as StepStateEntry;
    return {
      step: entry.step,
      status: entry.status,
      dependsOn: parseCellTokens(entry.dependsOn)
    };
  });

  return { steps, advisories, cycle };
}
