import { fail, ok, type Result } from "../result.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import type { Diagnostic, MutationStaleGuard, RequirementRecord, RequirementStatus } from "../types.js";
import { isVerifiedRequirementValid } from "../validator/rules.js";

export function assertVerifiedGuard(record: RequirementRecord, nextStatus: RequirementStatus = record.status): Result<true> {
  if (nextStatus !== "verified") return ok(true);
  if (!isVerifiedRequirementValid(record)) {
    return fail("MUTATION_DENIED", "Cannot mark requirement verified until all AC are checked and evidence exists");
  }
  return ok(true);
}

export function mutationOk<T>(value: T, diagnostics: Diagnostic[] = []) {
  return { ok: true as const, value, diagnostics, diagnosticsSummary: summarizeDiagnostics(diagnostics) };
}

export function mutationFail(code: string, message: string, diagnostics: Diagnostic[] = [], options: { staleGuard?: MutationStaleGuard } = {}) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
      ...(options.staleGuard ? { staleGuard: options.staleGuard } : {})
    },
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics)
  };
}
