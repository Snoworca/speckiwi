import { fail, ok, type Result } from "../result.js";
import type { RequirementRecord, RequirementStatus } from "../types.js";
import { isVerifiedRequirementValid } from "../validator/rules.js";

export function assertVerifiedGuard(record: RequirementRecord, nextStatus: RequirementStatus = record.status): Result<true> {
  if (nextStatus !== "verified") return ok(true);
  if (!isVerifiedRequirementValid(record)) {
    return fail("MUTATION_DENIED", "Cannot mark requirement verified until all AC are checked and evidence exists");
  }
  return ok(true);
}

export function mutationOk<T>(value: T, diagnostics = []) {
  return { ok: true as const, value, diagnostics };
}

export function mutationFail(code: string, message: string, diagnostics = []) {
  return { ok: false as const, error: { code, message }, diagnostics };
}
