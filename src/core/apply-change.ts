import { resolve } from "node:path";
import { applyChange as applyChangeImpl, applyProposalToDocument } from "../write/apply.js";
import type { ApplyResult } from "./dto.js";
import type { ApplyChangeInput } from "./inputs.js";
import { clearReadModelMemo } from "./read-model.js";

export async function applyChange(input: ApplyChangeInput): Promise<ApplyResult> {
  const result = await applyChangeImpl(input);
  clearReadModelMemo(resolve(input.root ?? process.cwd()));
  return result;
}

export { applyProposalToDocument };
