import {
  PRIORITY_LEVELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  LEGACY_STABILITY_LEVELS,
  STABILITY_LEVELS
} from "./types.js";

export function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isRequirementStatus(value: unknown) {
  return isOneOf(REQUIREMENT_STATUSES, value);
}

export function isRequirementType(value: unknown) {
  return isOneOf(REQUIREMENT_TYPES, value);
}

export function isPriority(value: unknown) {
  return isOneOf(PRIORITY_LEVELS, value);
}

export function isRisk(value: unknown) {
  return isOneOf(RISK_LEVELS, value);
}

export function isStability(value: unknown): value is (typeof STABILITY_LEVELS)[number] | (typeof LEGACY_STABILITY_LEVELS)[number] {
  return isKnownStability(value);
}

export function isCanonicalStability(value: unknown): value is (typeof STABILITY_LEVELS)[number] {
  return isOneOf(STABILITY_LEVELS, value);
}

export function isLegacyStability(value: unknown): value is (typeof LEGACY_STABILITY_LEVELS)[number] {
  return isOneOf(LEGACY_STABILITY_LEVELS, value);
}

export function isKnownStability(value: unknown): value is (typeof STABILITY_LEVELS)[number] | (typeof LEGACY_STABILITY_LEVELS)[number] {
  return isCanonicalStability(value) || isLegacyStability(value);
}
