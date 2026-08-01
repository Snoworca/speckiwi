// A second *operating-system* process for FR-NODE-102 AC-1. `06` §5.3 records that the branch's
// only exclusion proof was 64 promises inside one process, which proves nothing about a second
// orchestrator run. This script acquires through the same module the parent uses, reports the
// outcome on stdout, and then holds the lock until the parent kills it.
//
// It is .mjs importing a .ts module on purpose: Node strips types natively, so the child runs the
// module under test rather than a compiled copy that could drift from it.
import { pathToFileURL } from "node:url";

const [, , modulePath, commonDir, owner] = process.argv;
const runLock = await import(pathToFileURL(modulePath).href);

try {
  const lock = await runLock.acquire({ commonDir, owner });
  process.stdout.write(`ACQUIRED ${lock.lockPath}\n`);
} catch (error) {
  process.stdout.write(`REFUSED ${error?.gate ?? "unknown-gate"}\n`);
  process.exit(3);
}

process.stdin.resume();
