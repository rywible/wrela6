import { describe, expect, test } from "bun:test";

import { compilerMetadataValue } from "../../../src/pipeline";
import { runScalarReplacementStep } from "../../../src/opt-ir/passes/pipeline-steps";

describe("scalar replacement pipeline metadata", () => {
  test("records scalar replacement pass state as typed metadata", () => {
    const state = {
      program: { regions: new Map() },
      operations: [],
      optimizationRegions: [],
      facts: { records: [] },
      diagnostics: [],
      decisionLog: undefined,
      verificationCheckpoints: [],
    };

    const result = runScalarReplacementStep(state as never);

    expect("kind" in result && result.kind === "error").toBe(false);
    if ("kind" in result && result.kind === "error") {
      throw new Error("Expected scalar replacement to succeed.");
    }
    if (result.metadata === undefined) {
      throw new Error("Expected scalar replacement to attach pipeline metadata.");
    }
    expect(compilerMetadataValue(result.metadata, "scalarReplacement")).toEqual({
      replacedRegionIds: [],
      rejectedCandidates: [],
    });
  });
});
