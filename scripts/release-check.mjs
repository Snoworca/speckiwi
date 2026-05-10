import { parseWorkspace } from "../dist/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../dist/core/project-root.js";
import { summarizeReleaseReadiness } from "../dist/core/workflow/release-readiness.js";

const root = await resolveProjectRoot(process.cwd());
const workspace = await parseWorkspace(root);
const target = Object.prototype.hasOwnProperty.call(process.env, "SPECKIWI_TARGET") ? process.env.SPECKIWI_TARGET : undefined;
const summary = summarizeReleaseReadiness(workspace, target === undefined ? undefined : { target });
const strict = process.argv.includes("--strict") || process.env.SPECKIWI_STRICT_READY === "1";
process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exitCode = summary.diagnosticsSummary.errors > 0 || (strict && !summary.ready) ? 1 : 0;
