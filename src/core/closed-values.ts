/**
 * @req FR-MCP-075 AC-1 AC-2 — how a closed set of values is named, in a field description and in the
 * refusal of a value outside it, both read from the constant the guard decides by so they cannot drift.
 */
export function oneOf(values: readonly string[]): string {
  return `one of ${values.join(", ")}`;
}
