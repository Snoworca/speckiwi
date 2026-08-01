/**
 * Deterministic JSON: object keys sorted, arrays in order, no whitespace.
 *
 * Two callers that build the same body with different key insertion orders must digest to the same
 * bytes, because a lock is compared byte-for-byte by 05 §4.7 digest 3.
 *
 * This lived twice — private in `freeze.ts`, copied into `resume-card.ts` — and both copies fed
 * digest comparisons. A divergence between them would not have surfaced as a serialisation bug: it
 * would have surfaced as `run-invariant-drift` on a run where nothing drifted, because each side
 * would have believed it was comparing the same bytes as the other. One function, one behaviour.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  // `JSON.stringify(undefined)` is `undefined`, not a string. Coalescing keeps an undefined member
  // visible in the digest as `null` rather than letting it vanish from the serialisation.
  return JSON.stringify(value) ?? "null";
}
