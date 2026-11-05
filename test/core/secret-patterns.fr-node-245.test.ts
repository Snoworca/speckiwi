import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REDACTION_MARKER, SECRET_PATTERNS, redactSecrets } from "../../src/core/secret-patterns.js";

// @req FR-NODE-245 — one exported secret-pattern module, which also catches a `key=` credential.
//
// Every credential-looking value below is fake and shaped so that no provider's format scanner reads
// it as a live key.

const FAKE = "FAKEvalue0000fake";

describe("FR-NODE-245 AC-1 — the shared module", () => {
  // @req FR-NODE-245 AC-1
  it("FR-NODE-245 AC-1: exports the patterns, the marker and the redaction function", () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
    expect(REDACTION_MARKER).toBe("[REDACTED]");
    expect(redactSecrets(`password=${FAKE}`)).toEqual({ text: REDACTION_MARKER, count: 1 });
  });

  // @req FR-NODE-245 AC-1
  it("FR-NODE-245 AC-1: synthesis imports the patterns rather than declaring its own", () => {
    const source = readFileSync(path.resolve("src/core/mutation/synthesis.ts"), "utf8");
    expect(source).toMatch(/from "\.\.\/secret-patterns\.js"/);
    expect(source).not.toMatch(/const SECRET_PATTERNS\b/);
    expect(source).not.toMatch(/function redactSecrets\b/);
  });
});

describe("FR-NODE-245 AC-2 — a key= credential", () => {
  // @req FR-NODE-245 AC-2
  it("FR-NODE-245 AC-2: matches key=<value> and key: <value> under the credential value rule", () => {
    for (const text of [`key=${FAKE}`, `key: ${FAKE}`, `KEY = "${FAKE}"`, `key: 'quotedvalue'`, "key=abc123"]) {
      expect(redactSecrets(text), text).toEqual({ text: REDACTION_MARKER, count: 1 });
    }
  });

  // @req FR-NODE-245 AC-2
  it("FR-NODE-245 AC-2: redacts both credentials of a webhook URL query string and keeps the rest", () => {
    const url = `https://chat.example.invalid/v1/spaces/SPACE/messages?key=${FAKE}&token=${FAKE}9`;
    const redacted = redactSecrets(`send failed: POST ${url} returned 500`);
    expect(redacted.count).toBe(2);
    expect(redacted.text).toBe(`send failed: POST https://chat.example.invalid/v1/spaces/SPACE/messages?${REDACTION_MARKER}&${REDACTION_MARKER} returned 500`);
    expect(redacted.text).not.toContain(FAKE);
  });

  // @req FR-NODE-245 AC-2
  it("FR-NODE-245 AC-2: leaves an identifier such as MONKEY_KEY and a code expression or prose unmatched", () => {
    for (const text of [
      "MONKEY_KEY",
      `MONKEY_KEY=${FAKE}`,
      "const key = computeKey();",
      "key: design choice",
      "if (key === storedKey)",
      "key=abcdefgh",
      "key=ab12",
      "the hotkey=abc123 binding"
    ]) {
      expect(redactSecrets(text), text).toEqual({ text, count: 0 });
    }
  });
});
