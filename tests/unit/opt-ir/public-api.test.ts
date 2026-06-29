import { describe, expect, test } from "bun:test";

import * as optIrBarrel from "../../../src/opt-ir";
import * as topLevelExports from "../../../src";
import { buildOptimizedOptIr, constructOptIr } from "../../../src/opt-ir/public-api";
import { productionOptimizationPolicyForTest } from "../../../src/opt-ir/policy/optimization-profile";
import {
  invalidBoundaryConstructOptIrInputForTest,
  stableOptIrConstructionKey,
  validConstructOptIrInputForTest,
} from "../../support/opt-ir/construction-fixtures";

describe("OptIR public construction API", () => {
  test("constructOptIr returns a program, imported facts, provenance snapshot, and diagnostics", () => {
    const result = constructOptIr(validConstructOptIrInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    expect(result.program.functions.entries()).toHaveLength(1);
    expect(result.facts.records).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "construction-cleanup",
    ]);
    expect(result.provenance.originIds).toEqual(result.program.provenance.originIds);
    expect(result.provenance.fingerprint.digestHex).toHaveLength(64);
    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
  });

  test("construction output is stable across repeated public API calls", () => {
    const first = constructOptIr(validConstructOptIrInputForTest());
    const second = constructOptIr(validConstructOptIrInputForTest());

    expect(stableOptIrConstructionKey(first)).toBe(stableOptIrConstructionKey(second));
  });

  test("buildOptimizedOptIr composes construction and optimization", () => {
    const result = buildOptimizedOptIr({
      ...validConstructOptIrInputForTest(),
      policy: productionOptimizationPolicyForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected optimized construction to succeed.");
    }
    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "construction-cleanup",
    );
  });

  test("buildOptimizedOptIr propagates construction errors without optimizer execution", () => {
    let optimizerCalled = false;
    const result = buildOptimizedOptIr(
      {
        ...invalidBoundaryConstructOptIrInputForTest(),
        policy: productionOptimizationPolicyForTest(),
      },
      {
        optimizer() {
          optimizerCalled = true;
          throw new Error("optimizer should not run after construction failure");
        },
      },
    );

    expect(result.kind).toBe("error");
    expect(optimizerCalled).toBe(false);
  });

  test("OptIR is exported as a top-level namespace and direct barrel", () => {
    expect(Object.keys(topLevelExports)).toContain("optIr");
    expect(Object.keys(topLevelExports)).toContain("constructOptIr");
    expect(Object.keys(optIrBarrel)).toEqual(
      expect.arrayContaining(["constructOptIr", "buildOptimizedOptIr", "optimizeOptIr"]),
    );
  });
});
