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
import { buildProposalDocument, currentDocumentHash, currentTargetHash, ProposalError, readProposalAt } from "./proposal.js";
import { PatchError } from "./patch.js";
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
    const backupPath = cacheMode === "bypass" ? undefined : await writeBackup(root, targetStorePath);
    try {
        await assertRealPathInsideWorkspace(targetPath);
        await atomicWriteText(targetPath.absolutePath, updated.raw);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = backupPath === undefined
            ? {
                recovery: `Original YAML should remain at .speckiwi/${targetStorePath}; retry after checking workspace state.`
            }
            : {
                backupPath,
                recovery: `Original YAML should remain at .speckiwi/${targetStorePath}; inspect backup ${backupPath} before retrying.`
            };
        return applyFailure("APPLY_REJECTED_ATOMIC_WRITE_FAILED", `Atomic write failed for .speckiwi/${targetStorePath}.`, diagnosticBag("APPLY_REJECTED_ATOMIC_WRITE_FAILED", message, details));
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
        try {
            return await buildProposalDocument(input.change, root);
        }
        catch (error) {
            if (error instanceof ProposalError || error instanceof PatchError) {
                throw new ApplyError(error.code, error.message);
            }
            throw error;
        }
    }
    if ("proposalPath" in input && input.proposalPath !== undefined) {
        try {
            return await readProposalAt(root, proposalStorePathFromInput(input.proposalPath));
        }
        catch (error) {
            if (error instanceof ProposalError) {
                throw new ApplyError(error.code, error.message);
            }
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
        catch (error) {
            if ((error instanceof ProposalError || error instanceof PatchError) && (await proposalFileDeclaresId(root, storePath, proposalId))) {
                throw new ApplyError(error.code, error.message);
            }
            continue;
        }
    }
    throw new ApplyError("APPLY_REJECTED_PROPOSAL_NOT_FOUND", `Proposal not found: ${proposalId}.`);
}
async function proposalFileDeclaresId(root, storePath, proposalId) {
    try {
        const loaded = await loadYamlDocument(resolveStorePath(root, storePath));
        const value = loaded.value;
        return typeof value === "object" && value !== null && !Array.isArray(value) && value.id === proposalId;
    }
    catch {
        return false;
    }
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
function applyFailure(code, message, diagnostics) {
    return fail({ code, message }, diagnostics === undefined ? diagnosticBag(code, message, recoveryDetailsForApplyFailure(code)) : withApplyRecovery(diagnostics, code));
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
function withApplyRecovery(diagnostics, code) {
    const recovery = recoveryDetailsForApplyFailure(code);
    if (recovery === undefined) {
        return diagnostics;
    }
    return createDiagnosticBag([...diagnostics.errors, ...diagnostics.warnings, ...diagnostics.infos].map((diagnostic) => {
        if (diagnostic.severity !== "error") {
            return diagnostic;
        }
        const details = diagnostic.details ?? {};
        if (typeof details.recovery === "string") {
            return diagnostic;
        }
        return {
            ...diagnostic,
            details: {
                ...details,
                recovery: recovery.recovery
            }
        };
    }));
}
function recoveryDetailsForApplyFailure(code) {
    switch (code) {
        case "APPLY_REJECTED_CONFIRM_REQUIRED":
            return { recovery: "Review the proposal or change, then retry with confirm=true only when the write is intended." };
        case "APPLY_REJECTED_INVALID_INPUT":
            return { recovery: "Retry with exactly one proposalId, proposalPath, or inline change." };
        case "APPLY_REJECTED_ALLOW_APPLY_FALSE":
            return { recovery: "Enable settings.agent.allowApply in .speckiwi/index.yaml or use proposal mode without applying." };
        case "APPLY_REJECTED_PROPOSAL_NOT_FOUND":
            return { recovery: "Check the proposal id or .speckiwi/proposals path, then regenerate the proposal if it is missing." };
        case "APPLY_REJECTED_STALE_PROPOSAL":
            return { recovery: "Regenerate the proposal from the current YAML source before applying again." };
        case "APPLY_REJECTED_VALIDATION_ERROR":
            return { recovery: "Fix the reported validation errors or adjust the proposal, then rerun apply." };
        case "APPLY_REJECTED_LOCK_CONFLICT":
            return { recovery: "Wait for the active writer to finish, then retry after confirming the target YAML has not changed." };
        case "APPLY_REJECTED_ATOMIC_WRITE_FAILED":
            return { recovery: "Inspect the target YAML and backup path if present, then retry after resolving filesystem errors." };
        case "APPLY_REJECTED_TARGET_INVALID":
            return { recovery: "Check that the target document still exists inside .speckiwi and is valid YAML." };
        case "PROPOSAL_SCHEMA_INVALID":
        case "INVALID_PATCH":
        case "INVALID_PATCH_PATH":
            return { recovery: "Regenerate the proposal or correct its JSON Pointer patch paths before applying." };
        default:
            return undefined;
    }
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