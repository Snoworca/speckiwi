import type * as FsPromises from "node:fs/promises";

/**
 * @req REL-NODE-009 — fault and interleaving injection for the SRS mutation lock tests.
 *
 * A test file installs it with
 *   vi.mock("node:fs/promises", async (original) => (await import("<this file>")).wrapFsPromises(await original()));
 * Every wrapped call passes through to the real function unless a fault or a pause matches it.
 */

export type FaultOp = "open" | "readFile" | "rm" | "rename" | "link" | "handleWrite";

export interface Fault {
  op: FaultOp;
  /** Decides on the path the operation acts on (for `rename` the source, for `link` the new name). */
  match: (filePath: string) => boolean;
  code: string;
  /** How many matching calls fail; `Infinity` keeps failing. */
  times: number;
}

export interface Pause {
  /** One operation, or several counted together (a pause on whichever of them comes first). */
  op: FaultOp | readonly FaultOp[];
  match: (filePath: string) => boolean;
  /** Resolved by the test to let the paused call continue. */
  release: Promise<void>;
  /** Resolved by this module when the call reaches the pause. */
  reached: () => void;
  /** Only the n-th matching call pauses (1-based); default 1. */
  nth?: number;
}

interface State {
  faults: Fault[];
  pauses: Array<Pause & { seen: number }>;
  calls: Array<{ op: FaultOp; path: string; failed?: string }>;
  afterRename: Array<(source: string, destination: string) => Promise<void> | void>;
}

export const fsFaults: State = { faults: [], pauses: [], calls: [], afterRename: [] };

export function resetFsFaults(): void {
  fsFaults.faults = [];
  fsFaults.pauses = [];
  fsFaults.calls = [];
  fsFaults.afterRename = [];
}

/** A promise pair a test uses to hold one operation until it says go. */
export function pauseAt(op: FaultOp | readonly FaultOp[], match: (filePath: string) => boolean, nth = 1): { reached: Promise<void>; go: () => void } {
  let go = (): void => undefined;
  let reached = (): void => undefined;
  const release = new Promise<void>((resolve) => (go = resolve));
  const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
  fsFaults.pauses.push({ op, match, release, reached, nth, seen: 0 });
  return { reached: reachedPromise, go };
}

function toPath(value: unknown): string {
  return String(value).replace(/\\/g, "/");
}

async function gate(op: FaultOp, filePath: string): Promise<void> {
  // Count this call against every matching pause first, then wait: counting while waiting would let
  // a second call slip past a pause the first call has not counted yet.
  const covers = (pause: Pause): boolean => (Array.isArray(pause.op) ? pause.op.includes(op) : pause.op === op);
  const hits = fsFaults.pauses.filter((pause) => covers(pause) && pause.match(filePath) && ++pause.seen === (pause.nth ?? 1));
  for (const pause of hits) {
    pause.reached();
    await pause.release;
  }
  const fault = fsFaults.faults.find((candidate) => candidate.op === op && candidate.times > 0 && candidate.match(filePath));
  if (fault) {
    fault.times -= 1;
    fsFaults.calls.push({ op, path: filePath, failed: fault.code });
    throw Object.assign(new Error(`${fault.code}: injected ${op} '${filePath}'`), { code: fault.code, syscall: op, path: filePath });
  }
  fsFaults.calls.push({ op, path: filePath });
}

export function wrapFsPromises(actual: typeof FsPromises): typeof FsPromises {
  return {
    ...actual,
    open: (async (file: Parameters<typeof actual.open>[0], ...rest: unknown[]) => {
      const filePath = toPath(file);
      await gate("open", filePath);
      const handle = await (actual.open as (...args: unknown[]) => ReturnType<typeof actual.open>)(file, ...rest);
      const writeFile = handle.writeFile.bind(handle);
      handle.writeFile = (async (...args: Parameters<typeof handle.writeFile>) => {
        await gate("handleWrite", filePath);
        return writeFile(...args);
      }) as typeof handle.writeFile;
      return handle;
    }) as typeof actual.open,
    readFile: (async (file: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      await gate("readFile", toPath(file));
      return (actual.readFile as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof actual.readFile,
    rm: (async (file: Parameters<typeof actual.rm>[0], ...rest: unknown[]) => {
      await gate("rm", toPath(file));
      return (actual.rm as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof actual.rm,
    rename: (async (source: Parameters<typeof actual.rename>[0], destination: Parameters<typeof actual.rename>[1]) => {
      await gate("rename", toPath(source));
      await actual.rename(source, destination);
      for (const hook of fsFaults.afterRename) await hook(toPath(source), toPath(destination));
    }) as typeof actual.rename,
    link: (async (existing: Parameters<typeof actual.link>[0], newPath: Parameters<typeof actual.link>[1]) => {
      await gate("link", toPath(newPath));
      return actual.link(existing, newPath);
    }) as typeof actual.link
  };
}

export const isLock = (filePath: string): boolean => filePath.endsWith("kiwi/.srs.lock");
export const isGuard = (filePath: string): boolean => filePath.endsWith("kiwi/.srs.lock.guard");
/** The lock or guard file itself, or one of its quarantine names. */
export const isLockFamily = (filePath: string): boolean => /kiwi\/\.srs\.lock(\.guard)?(\.quarantine-[^/]*)?$/.test(filePath);
