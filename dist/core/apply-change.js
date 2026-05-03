import { resolve } from "node:path";
import { applyChange as applyChangeImpl, applyProposalToDocument } from "../write/apply.js";
import { clearReadModelMemo } from "./read-model.js";
export async function applyChange(input) {
    const result = await applyChangeImpl(input);
    clearReadModelMemo(resolve(input.root ?? process.cwd()));
    return result;
}
export { applyProposalToDocument };
//# sourceMappingURL=apply-change.js.map