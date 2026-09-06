// A second *operating-system* process that takes the run lock, reports the holder its OWN
// acquisition named, and then exits.
//
// Exiting is the whole point: the lease left behind belongs to a process that is gone, which is what
// a crashed run — or an ordinary CLI-driven one, whose invocation exits the moment it has written the
// sentinel — leaves for its successor. What it is NOT any more is reclaimable on that account:
// FR-NODE-207 replaced the pid liveness probe with the expiry the writer stamps, so the parent
// advances past that recorded expiry before acquiring. The two runs then hold two different leases
// over one lock path, which is the situation FR-NODE-204 AC-2 has to discriminate.
//
// It is .mjs importing a .ts module on purpose, the way `run-lock-child.mjs` already does: Node
// strips types natively, so the child runs the module under test rather than a compiled copy.
import { pathToFileURL } from "node:url";

const [, , modulePath, commonDir, owner] = process.argv;
const runLock = await import(pathToFileURL(modulePath).href);

const lock = await runLock.acquire({ commonDir, owner });
process.stdout.write(`${JSON.stringify({ pid: process.pid, lockPath: lock.lockPath, holder: lock.holder })}\n`);
