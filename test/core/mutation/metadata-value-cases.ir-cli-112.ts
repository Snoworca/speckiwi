import { addRelatedDoc } from "../../../src/core/mutation/add-related-doc.js";
import { setSupersede } from "../../../src/core/mutation/add-trace.js";
import { updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { repairRulesReferences } from "../../../src/core/mutation/repair-rules-references.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import type { ProjectRoot } from "../../../src/core/types.js";

/**
 * IR-CLI-112 AC-3 — one call per metadata-writing caller and field, each setting a value the
 * mutation-target fixture does not already hold for FR-ARCH-001. Shared by the tests that check the
 * writers against the parser, so every one of them covers the same callers.
 */
export interface MetadataValueCase {
  caller: string;
  field: string;
  /** Text the parser must read in the field after the call. */
  value: string;
  run: (root: ProjectRoot) => Promise<unknown>;
  /**
   * replace: the call sets the whole value, so nothing of the old one is carried over.
   * append: the call adds to the current value, so the old value must survive or the call must refuse.
   * text-edit: the call rewrites a token inside the row's own text, so the rest of the row survives.
   */
  kind: "replace" | "append" | "text-edit";
}

export const STALE_RULES_LINK = "[SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md)";

export const METADATA_VALUE_CASES: MetadataValueCase[] = [
  { caller: "add-related-doc.ts", field: "Related Docs", value: "docs/x.md", kind: "append", run: (root) => addRelatedDoc(root, { id: "FR-ARCH-001", reference: "docs/x.md", dryRun: false }) },
  { caller: "add-trace.ts", field: "Supersedes", value: "FR-ARCH-002", kind: "replace", run: (root) => setSupersede(root, { id: "FR-ARCH-001", supersedes: "FR-ARCH-002", dryRun: false }) },
  { caller: "add-trace.ts", field: "Superseded By", value: "FR-ARCH-002", kind: "replace", run: (root) => setSupersede(root, { id: "FR-ARCH-001", supersededBy: "FR-ARCH-002", dryRun: false }) },
  { caller: "edit-requirement.ts", field: "Priority", value: "low", kind: "replace", run: (root) => updateRequirementFields(root, { id: "FR-ARCH-001", priority: "low", dryRun: false }) },
  { caller: "edit-requirement.ts", field: "Risk", value: "high", kind: "replace", run: (root) => updateRequirementFields(root, { id: "FR-ARCH-001", risk: "high", dryRun: false }) },
  { caller: "edit-requirement.ts", field: "Tags", value: "dup-tag", kind: "replace", run: (root) => updateRequirementFields(root, { id: "FR-ARCH-001", tags: ["dup-tag"], dryRun: false }) },
  { caller: "edit-requirement.ts", field: "Related Docs", value: "docs/x.md", kind: "replace", run: (root) => updateRequirementFields(root, { id: "FR-ARCH-001", relatedDocs: ["docs/x.md"], dryRun: false }) },
  // The fixture setup puts STALE_RULES_LINK in Related Docs and installs the bundled rules document.
  { caller: "repair-rules-references.ts", field: "Related Docs", value: BUNDLED_SRS_RULES_FILENAME, kind: "text-edit", run: (root) => repairRulesReferences(root, { apply: true }) },
  { caller: "rename-target.ts", field: "Target", value: "v9.0.0", kind: "replace", run: (root) => renameTarget(root, { from: "v1.0.0", to: "v9.0.0", dryRun: false }) },
  { caller: "retarget.ts", field: "Target", value: "v1.1.0", kind: "replace", run: (root) => retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false }) },
  { caller: "update-field.ts", field: "Priority", value: "low", kind: "replace", run: (root) => updateField(root, { id: "FR-ARCH-001", field: "priority", value: "low" }) },
  { caller: "update-field.ts", field: "Risk", value: "high", kind: "replace", run: (root) => updateField(root, { id: "FR-ARCH-001", field: "risk", value: "high" }) },
  { caller: "update-field.ts", field: "Target", value: "v1.1.0", kind: "replace", run: (root) => updateField(root, { id: "FR-ARCH-001", field: "target", value: "v1.1.0" }) },
  { caller: "update-field.ts", field: "Verification Method", value: "review", kind: "replace", run: (root) => updateField(root, { id: "FR-ARCH-001", field: "verification-method", value: "review" }) },
  { caller: "update-stability.ts", field: "Stability", value: "evolving", kind: "replace", run: (root) => updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "probe", dryRun: false }) },
  { caller: "update-status.ts", field: "Status", value: "in_progress", kind: "replace", run: (root) => updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", dryRun: false }) }
];
