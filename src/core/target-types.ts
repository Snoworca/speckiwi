// @req FR-NODE-098 — the single source for the target type vocabulary.
//
// The shipped authoring rules document (`docs/rule/SRS-MD-Rules-v2.5.0.md`, "Target type values")
// defines these six. That document travels inside the npm package, so a consuming project reads it
// and expects the runtime to honour it. Three enforcement points previously each carried their own
// three-value array and had drifted from the document and from each other; the accepted set is stated
// here once and imported, so widening it cannot leave one surface behind.
export const TARGET_TYPES = ["version", "release", "milestone", "phase", "objective", "experiment"] as const;

export type TargetType = (typeof TARGET_TYPES)[number];

/** The accepted values, rendered for a refusal message or a help string. */
export const TARGET_TYPES_SENTENCE = `${TARGET_TYPES.slice(0, -1).join(", ")}, or ${TARGET_TYPES[TARGET_TYPES.length - 1]}`;


export function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

// @req FR-NODE-099, FR-NODE-100 — the Target Map status vocabulary, from the same rules document
// section. `completed` and `released` were defined there and written by nothing, which is how twelve
// rows in this repository came to say "not started yet" about work that in several cases had shipped.
export const TARGET_STATUSES = ["planned", "active", "frozen", "completed", "released", "archived"] as const;

export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const TARGET_STATUS_PLANNED: TargetStatus = "planned";
export const TARGET_STATUS_ACTIVE: TargetStatus = "active";
export const TARGET_STATUS_COMPLETED: TargetStatus = "completed";
export const TARGET_STATUS_RELEASED: TargetStatus = "released";

export const TARGET_STATUSES_SENTENCE = `${TARGET_STATUSES.slice(0, -1).join(", ")}, or ${TARGET_STATUSES[TARGET_STATUSES.length - 1]}`;


export function isTargetStatus(value: string): value is TargetStatus {
  return (TARGET_STATUSES as readonly string[]).includes(value);
}
