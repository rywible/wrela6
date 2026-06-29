import { describe, expect, test } from "bun:test";
import {
  optIrBlockId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRewriteRegionId,
  optimizationPassId,
} from "../../../src/opt-ir/ids";
import {
  optIrOperationIdFromNamespace,
  optIrPassIdNamespace,
} from "../../../src/opt-ir/deterministic-ids";
import { compareCodeUnitStrings } from "../../../src/opt-ir/deterministic-sort";
import { optIrProgramIdForTest } from "../../support/opt-ir/ids-diagnostics-fakes";

describe("OptIR IDs", () => {
  test("numeric constructors preserve dense values", () => {
    expect(optIrProgramId(0)).toBe(optIrProgramIdForTest(0));
    expect(optIrOriginId(1)).toBe(optIrOriginId(1));
    expect(optIrFunctionId(2)).toBe(optIrFunctionId(2));
    expect(optIrBlockId(3)).toBe(optIrBlockId(3));
    expect(optIrOperationId(4)).toBe(optIrOperationId(4));
    expect(optIrRewriteRegionId(5)).toBe(optIrRewriteRegionId(5));
  });

  test("numeric constructors reject negative and non-integer values", () => {
    const constructors = [
      optIrProgramId,
      optIrOriginId,
      optIrFunctionId,
      optIrBlockId,
      optIrOperationId,
      optIrRewriteRegionId,
    ];

    for (const build of constructors) {
      expect(() => build(-1)).toThrow("must be a non-negative integer");
      expect(() => build(1.5)).toThrow("must be a non-negative integer");
      expect(() => build(NaN)).toThrow("must be a non-negative integer");
      expect(() => build(Infinity)).toThrow("must be a non-negative integer");
    }
  });

  test("string ID constructors reject empty strings", () => {
    expect(optimizationPassId("bounds-check-elimination") as string).toBe(
      "bounds-check-elimination",
    );
    expect(() => optimizationPassId("")).toThrow("OptimizationPassId must be non-empty");
  });
});

describe("OptIR deterministic ID namespaces", () => {
  test("pass namespaces include every deterministic creation component", () => {
    const namespace = optIrPassIdNamespace({
      optimizationProfileVersion: "production-v1",
      pipelineIndex: 7,
      passId: optimizationPassId("bounds-check-elimination"),
      functionId: optIrFunctionId(4),
      rewriteRegionId: optIrRewriteRegionId(2),
      creationRole: "replacementOperation",
    });

    expect(namespace.key).toBe(
      "profile:production-v1/pipeline:7/pass:bounds-check-elimination/function:4/rewriteRegion:2/role:replacementOperation",
    );
    expect(optIrOperationIdFromNamespace(namespace, 3)).toBe(optIrOperationId(3));
    expect(namespace).toEqual({
      optimizationProfileVersion: "production-v1",
      pipelineIndex: 7,
      passId: optimizationPassId("bounds-check-elimination"),
      functionId: optIrFunctionId(4),
      rewriteRegionId: optIrRewriteRegionId(2),
      creationRole: "replacementOperation",
      key: namespace.key,
    });
  });

  test("pass-created operation ordinals reject invalid values", () => {
    const namespace = optIrPassIdNamespace({
      optimizationProfileVersion: "production-v1",
      pipelineIndex: 0,
      passId: optimizationPassId("cleanup"),
      functionId: optIrFunctionId(0),
      rewriteRegionId: optIrRewriteRegionId(0),
      creationRole: "temporaryValue",
    });

    expect(() => optIrOperationIdFromNamespace(namespace, -1)).toThrow(
      "OptIrOperationId must be a non-negative integer",
    );
    expect(() => optIrOperationIdFromNamespace(namespace, 1.5)).toThrow(
      "OptIrOperationId must be a non-negative integer",
    );
  });
});

describe("OptIR deterministic sort helpers", () => {
  test("compareCodeUnitStrings orders deterministically", () => {
    expect(compareCodeUnitStrings("a", "b")).toBe(-1);
    expect(compareCodeUnitStrings("b", "a")).toBe(1);
    expect(compareCodeUnitStrings("a", "a")).toBe(0);
  });
});
