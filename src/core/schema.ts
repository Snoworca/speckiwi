import {
  PRIORITY_LEVELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
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

export function isStability(value: unknown) {
  return isOneOf(STABILITY_LEVELS, value);
}
