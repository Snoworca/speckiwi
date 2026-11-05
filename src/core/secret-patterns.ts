// @req FR-NODE-245, FR-NODE-056 — the one list of recognized secret patterns. Synthesis redaction, the
// work-graph check and the run journal's action errors read it from here, so a pattern added for one
// reader protects all of them.

/**
 * Recognized secret patterns. Patterns are intentionally specific to avoid over-redaction; the `-` is
 * placed last in each character class so it is a literal range delimiter, not an escape.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /ghp_[0-9A-Za-z]{36}/g, // GitHub personal access token
  /github_pat_[0-9A-Za-z_]+/g, // GitHub fine-grained personal access token
  /Bearer\s+[0-9A-Za-z._~+/-]{16,}=*/g, // Bearer authorization token
  // Full PEM private key block: redact the BEGIN...END envelope and the base64 body between
  // them so the key material never reaches the committed SRS (not just the header line). The `i`
  // flag also catches lowercase headers (e.g. `-----begin private key-----`).
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/gi,
  // Bare PEM private key header/footer (e.g. an unterminated block) — defense in depth so a
  // lone BEGIN/END line is still redacted even when its counterpart is absent (any case).
  /-----(?:BEGIN|END)[^-]*PRIVATE KEY-----/gi,
  // key=value / key: value credential assignments (case-insensitive key names). A leading word
  // boundary keeps an identifier like `KEEP_TOKEN` or `MONKEY_KEY` (no boundary before `TOKEN` or
  // `KEY`) from matching while still catching a standalone `token=` / `api_key:` / `key=`
  // assignment, including one in a URL query string (`?key=...&token=...`). The value side is
  // narrowed to a plausible literal credential so normal code/prose is preserved: either a
  // quoted token, or a bare credential token (charset, length >= 6) that contains a digit. This
  // excludes code expressions like `= computeToken();`, `=== storedHash`, and `: design uses ...`
  // (no digit, or value too short / not in the charset) while still redacting real secrets such
  // as `password=hunter2` and `api_key: sk_live_abc123XYZ`. @req FR-NODE-245 AC-2 — `key` joined
  // the alternatives; the value rule is unchanged.
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|key)\s*[:=]\s*(?:["'][A-Za-z0-9+/=_.-]{6,}["']|(?=[A-Za-z0-9+/=_.-]*[0-9])[A-Za-z0-9+/=_.-]{6,})/gi,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT (header.payload.signature)
  /xox[baprs]-[A-Za-z0-9-]+/g, // Slack token
  /sk-[A-Za-z0-9_-]{20,}/g // OpenAI-style secret key
];

/** What every match is replaced by. */
export const REDACTION_MARKER = "[REDACTED]";

export interface RedactionResult {
  readonly text: string;
  readonly count: number;
}

/** Replaces every recognized secret with {@link REDACTION_MARKER}, counting each replacement. */
export function redactSecrets(input: string): RedactionResult {
  let count = 0;
  let text = input;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      return REDACTION_MARKER;
    });
  }
  return { text, count };
}
