// A second *operating-system* process that takes the run lock, reports the holder its OWN
// acquisition named, and then exits.
//
// Exiting is the whole point. `isReclaimable` calls a same-host sentinel stale the moment its pid
// stops answering `process.kill(pid, 0)`, with no age condition, so the record this child leaves
// behind is reclaimable as soon as it is gone — which is the state a crashed run leaves for its
// successor. The parent then acquires, reclaims, and the two runs hold two different leases over one
// lock path, which is the situation FR-NODE-204 AC-2 has to discriminate.
//
// It is .mjs importing a .ts module on purpose, the way `run-lock-child.mjs` already does: Node
// strips types natively, so the child runs the module under test rather than a compiled copy.
import { pathToFileURL } from "node:url";

const [, , modulePath, commonDir, owner] = process.argv;
const runLock = await import(pathToFileURL(modulePath).href);

const lock = await runLock.acquire({ commonDir, owner });
process.stdout.write(`${JSON.stringify({ pid: process.pid, lockPath: lock.lockPath, holder: lock.holder })}\n`);
