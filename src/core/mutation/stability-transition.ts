import { STABILITY_LEVELS } from "../types.js";
import type { Stability } from "../types.js";

export type StabilityTransitionWarning = "skip-forward" | "rollback" | "redundant";

/**
 * FR-PARSE-017 AC-2 — Stability lifecycle 전이 분류 (Warning only 정책).
 *
 * canonical 순서: draft → evolving → stable → frozen → deprecated.
 * legacy `volatile` 입력은 본 함수의 검증 대상이 아니며 validator (FR-PARSE-015 AC-4) 영역.
 *
 * `from === undefined` 는 신규 REQ 입력으로 warning 없음.
 */
export function classifyStabilityTransition(
  from: Stability | undefined,
  to: Stability
): StabilityTransitionWarning | undefined {
  if (from === undefined) return undefined;
  if (from === to) return "redundant";
  const fromIndex = (STABILITY_LEVELS as readonly string[]).indexOf(from);
  const toIndex = (STABILITY_LEVELS as readonly string[]).indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return undefined;
  if (toIndex < fromIndex) return "rollback";
  if (toIndex - fromIndex > 1) return "skip-forward";
  return undefined;
}
