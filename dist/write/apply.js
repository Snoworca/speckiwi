import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createDiagnosticBag, fail, ok } from "../core/result.js";
import { validateWorkspace } from "../core/validate.js";
import { atomicWriteText } from "../io/file-store.js";
import { assertRealPathInsideWorkspace, normalizeStorePath, resolveRealStorePath, resolveStorePath, WorkspacePathError } from "../io/path.js";
import { loadYamlDocument } from "../io/yaml-loader.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { WriteLockError, withTargetWriteLock } from "./lock.js";
import { buildProposalDocument, currentDocumentHash, currentTargetHash, readProposalAt } from "./proposal.js";
import { applyProposalToDocument } from "./yaml-update.js";
export async function applyChange(input) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    if (input.confirm !== true) {
        return applyFailure("APPLY_REJECTED_CONFIRM_REQUIRED", "Apply requires confirm=true.");
    }
    if (!hasExactlyOneChangeSource(input)) {
        return applyFailure("APPLY_REJECTED_INVALID_INPUT", "Apply requires exactly one of proposalId, proposalPath, or change.");
    }
    try {
        if (!(await allowApply(root))) {
            return applyFailure("APPLY_REJECTED_ALLOW_APPLY_FALSE", "Apply is disabled by settings.agent.allowApply=false.");
        }
        const proposal = await resolveProposal(input, root);
        const targetStorePath = normalizeStorePath(proposal.base.documentPath);
        return await withTargetWriteLock(root, targetStorePath, async () => applyResolvedProposal(root, targetStorePath, proposal, input.cacheMode ?? "auto"));
    }
    catch (error) {
        if (error instanceof WriteLockError) {
            return applyFailure(error.code, error.message);
        }
        if (error instanceof ApplyError) {
            return applyFailure(error.code, error.message);
        }
        const message = error instanceof Error ? error.message : String(error);
        return applyFailure("APPLY_REJECTED_TARGET_INVALID", message);
    }
}
export { applyProposalToDocument } from "./yaml-update.js";
async function applyResolvedProposal(root, targetStorePath, proposal, cacheMode) {
    const stale = await staleDiagnostics(root, proposal);
    if (stale !== undefined) {
        return applyFailure("APPLY_REJECTED_STALE_PROPOSAL", "Apply rejected because the proposal base is stale.", stale);
    }
    const targetPath = await resolveRealStorePath(root, targetStorePath);
    const loaded = await loadYamlDocument(targetPath);
    const updated = applyProposalToDocument(loaded, proposal);
    const validationDiagnostics = await validateUpdatedWorkspace(root, targetStorePath, updated.raw);
    if (validationDiagnostics.summary.errorCount > 0) {
        return applyFailure("APPLY_REJECTED_VALIDATION_ERROR", "Apply rejected because validation errors exist.", validationDiagnostics);
    }
    const race = await staleDiagnostics(root, proposal);
    if (race !== undefined) {
        return applyFailure("APPLY_REJECTED_STALE_PROPOSAL", "Apply rejected because the target changed after validation.", race);
    }
    const backupPath = await writeBackup(root, targetStorePath);
    try {
        await assertRealPathInsideWorkspace(targetPath);
        await atomicWriteText(targetPath.absolutePath, updated.raw);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return applyFailure("APPLY_REJECTED_ATOMIC_WRITE_FAILED", `Atomic write failed for .speckiwi/${targetStorePath}.`, diagnosticBag("APPLY_REJECTED_ATOMIC_WRITE_FAILED", message, {
            backupPath,
            recovery: `Original YAML should remain at .speckiwi/${targetStorePath}; inspect backup ${backupPath} before retrying.`
        }));
    }
    if (cacheMode === "bypass") {
        return ok({
            mode: "apply",
            applied: true,
            modifiedFiles: [`.speckiwi/${targetStorePath}`],
            cacheStale: false
        });
    }
    let cacheStale = true;
    let diagnostics = createDiagnosticBag();
    try {
        await markCacheStale(root, [`.speckiwi/${targetStorePath}`]);
    }
    catch (error) {
        cacheStale = false;
        diagnostics = createDiagnosticBag([
            {
                severity: "warning",
                code: "CACHE_STALE_MARK_FAILED",
                message: error instanceof Error ? error.message : String(error)
            }
        ]);
    }
    return ok({
        mode: "apply",
        applied: true,
        modifiedFiles: [`.speckiwi/${targetStorePath}`],
        cacheStale
    }, diagnostics);
}
async function resolveProposal(input, root) {
    if ("change" in input && input.change !== undefined) {
        return buildProposalDocument(input.change, root);
    }
    if ("proposalPath" in input && input.proposalPath !== undefined) {
        try {
            return await readProposalAt(root, proposalStorePathFromInput(input.proposalPath));
        }
        catch (error) {
            throw new ApplyError("APPLY_REJECTED_PROPOSAL_NOT_FOUND", error instanceof Error ? error.message : String(error));
        }
    }
    if ("proposalId" in input && input.proposalId !== undefined) {
        return readProposalAt(root, await findProposalById(root, input.proposalId));
    }
    throw new Error("No proposal source was provided.");
}
async function findProposalById(root, proposalId) {
    const proposalDir = resolve(root.speckiwiPath, "proposals");
    let entries;
    try {
        entries = (await readdir(proposalDir)).filter((entry) => entry.endsWith(".yaml")).sort();
    }
    catch {
        throw new ApplyError("APPLY_REJECTED_PROPOSAL_NOT_FOUND", `Proposal not found: ${proposalId}.`);
    }
    for (const entry of entries) {
        const storePath = normalizeStorePath(`proposals/${entry}`);
        try {
            const proposal = await readProposalAt(root, storePath);
            if (proposal.id === proposalId) {
                return storePath;
            }
        }
        catch {
            continue;
        }
    }
    throw new ApplyError("APPLY_REJECTED_PROPOSAL_NOT_FOUND", `Proposal not found: ${proposalId}.`);
}
function proposalStorePathFromInput(input) {
    const normalized = input.replace(/\\/g, "/").replace(/^\.speckiwi\//, "");
    const storePath = normalizeStorePath(normalized);
    if (!storePath.startsWith("proposals/")) {
        throw new Error("proposalPath must point under .speckiwi/proposals.");
    }
    return storePath;
}
async function staleDiagnostics(root, proposal) {
    const documentHash = await currentDocumentHash(root, proposal);
    const targetHash = await currentTargetHash(root, proposal);
    const diagnostics = [];
    if (documentHash !== proposal.base.documentHash) {
        diagnostics.push({
            severity: "error",
            code: "APPLY_REJECTED_STALE_PROPOSAL",
            message: "Target document hash does not match the proposal base hash.",
            path: `.speckiwi/${proposal.base.documentPath}`,
            details: {
                expected: proposal.base.documentHash,
                actual: documentHash,
                hash: "documentHash"
            }
        });
    }
    if (targetHash !== proposal.base.targetHash) {
        diagnostics.push({
            severity: "error",
            code: "APPLY_REJECTED_STALE_PROPOSAL",
            message: "Target entity hash does not match the proposal base hash.",
            path: `.speckiwi/${proposal.base.documentPath}`,
            details: {
                expected: proposal.base.targetHash,
                actual: targetHash,
                hash: "targetHash"
            }
        });
    }
    return diagnostics.length === 0 ? undefined : createDiagnosticBag(diagnostics);
}
async function validateUpdatedWorkspace(root, targetStorePath, raw) {
    const tempRoot = await mkdtemp(join(tmpdir(), "speckiwi-apply-"));
    try {
        await cp(root.speckiwiPath, resolve(tempRoot, ".speckiwi"), { recursive: true });
        const target = resolve(tempRoot, ".speckiwi", targetStorePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, raw, "utf8");
        const result = await validateWorkspace({ root: tempRoot });
        return result.diagnostics;
    }
    finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
}
async function allowApply(root) {
    try {
        const indexPath = await resolveRealStorePath(root, normalizeStorePath("index.yaml"));
        const raw = await readFile(indexPath.absolutePath, "utf8");
        const { parse } = await import("yaml");
        const parsed = parse(raw);
        if (isJsonObject(parsed)) {
            const settings = jsonObjectValue(parsed.settings);
            const agent = jsonObjectValue(settings?.agent);
            return agent?.allowApply !== false;
        }
    }
    catch (error) {
        if (error instanceof WorkspacePathError) {
            throw error;
        }
        return true;
    }
    return true;
}
async function writeBackup(root, targetStorePath) {
    const source = (await resolveRealStorePath(root, targetStorePath)).absolutePath;
    const backupStorePath = normalizeStorePath(`cache/backups/${timestampSegment(new Date().toISOString())}/${targetStorePath}`);
    const backupPath = resolveStorePath(root, backupStorePath);
    await assertRealPathInsideWorkspace(backupPath);
    const backup = backupPath.absolutePath;
    await mkdir(dirname(backup), { recursive: true });
    await assertRealPathInsideWorkspace(backupPath);
    await cp(source, backup);
    return `.speckiwi/${backupStorePath}`;
}
async function markCacheStale(root, modifiedFiles) {
    const marker = normalizeStorePath("cache/stale.json");
    const markerPath = await resolveRealStorePath(root, marker);
    await atomicWriteText(markerPath.absolutePath, `${JSON.stringify({ stale: true, modifiedFiles, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}
function hasExactlyOneChangeSource(input) {
    return [
        "proposalId" in input && input.proposalId !== undefined,
        "proposalPath" in input && input.proposalPath !== undefined,
        "change" in input && input.change !== undefined
    ].filter(Boolean).length === 1;
}
function applyFailure(code, message, diagnostics = diagnosticBag(code, message)) {
    return fail({ code, message }, diagnostics);
}
function diagnosticBag(code, message, details) {
    const diagnostic = {
        severity: "error",
        code,
        message
    };
    if (details !== undefined) {
        diagnostic.details = details;
    }
    return createDiagnosticBag([diagnostic]);
}
function timestampSegment(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
function jsonObjectValue(value) {
    return isJsonObject(value) ? value : undefined;
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
class ApplyError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ApplyError";
    }
}
//# sourceMappingURL=apply.js.map