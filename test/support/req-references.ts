/**
 * @req REL-NODE-007 @req FR-NODE-210 AC-1 — resolve `@req` citations in source against the
 * requirements that exist. The scanner is the product's own (`src/core/testing/test-citations.ts`);
 * this module only hands it to the repository's tests, so the two cannot drift.
 */
export {
  classifyReqReferences,
  collectReqReferences,
  extractReqReferences,
  formatReqReferences,
  type ReqReference,
  type ReqReferenceReport
} from "../../src/core/testing/test-citations.js";
