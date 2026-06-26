import { describe, expect, test } from "bun:test";
import { layoutOwnerKey } from "../../../src/layout/builder-context";
import { layoutDiagnostic, layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { collectSourceFunctionAbiFailures } from "../../../src/layout/layout-fact-builder-support";
import {
  classifySourceAbiParameter,
  classifySourceAbiReturn,
  validateHiddenAbiParameters,
} from "../../../src/layout/source-function-abi";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import { coreTypeId, functionId, parameterId } from "../../../src/semantic/ids";
import type {
  LayoutAbiHiddenParameterFact,
  LayoutAbiValueShape,
  LayoutTypeFact,
} from "../../../src/layout/layout-program";
import {
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  pointerShape64,
  sourceLayoutTypeKey,
} from "../../support/layout/layout-fixtures";
import { computeFunctionAbiFactForFixture } from "../../support/layout/function-abi-fixtures";
import { functionAbiFixture } from "../../support/layout/layout-fixtures";

describe("computeFunctionAbiFact", () => {
  test("consume indirect parameter uses caller-allocated ABI ownership", () => {
    const result = computeFunctionAbiFactForFixture(
      functionAbiFixture({
        parameterMode: "consume",
        classifierShape: {
          kind: "indirect",
          pointer: pointerShape64(),
          pointee: sourceLayoutTypeKey("Packet"),
          ownership: "callerAllocated",
        },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const shape = result.value.fact.parameters[0]!.shape;
    expect(shape.kind).toBe("indirect");
    if (shape.kind === "indirect") expect(shape.ownership).toBe("callerAllocated");
  });

  test("observe indirect parameter uses borrowed ABI ownership", () => {
    const result = computeFunctionAbiFactForFixture(
      functionAbiFixture({
        parameterMode: "observe",
        classifierShape: {
          kind: "indirect",
          pointer: pointerShape64(),
          pointee: sourceLayoutTypeKey("Packet"),
          ownership: "borrowed",
        },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const shape = result.value.fact.parameters[0]!.shape;
    expect(shape.kind).toBe("indirect");
    if (shape.kind === "indirect") expect(shape.ownership).toBe("borrowed");
  });

  test("zero-sized capability tokens classify as none with proofCarrying", () => {
    const result = computeFunctionAbiFactForFixture(
      functionAbiFixture({
        classifierShape: {
          kind: "none",
          reason: "zeroSizedCapability",
          proofCarrying: true,
        },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const shape = result.value.fact.parameters[0]!.shape;
    expect(shape).toEqual({
      kind: "none",
      reason: "zeroSizedCapability",
      proofCarrying: true,
    });
  });

  test("ABI classifier errors produce layout diagnostics and no partial ABI fact", () => {
    const result = computeFunctionAbiFactForFixture(
      functionAbiFixture({
        target: layoutTargetSurfaceFake({ forceClassifierError: "forced classifier failure" }),
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.ownerKey.startsWith("function:")),
    ).toBe(true);
  });
});

describe("validateHiddenAbiParameters", () => {
  test("rejects hidden parameters listed but not referenced by indirect shapes", () => {
    const functionInstanceId = monoInstanceId("fn:test");
    const hidden: LayoutAbiHiddenParameterFact = {
      kind: "sret",
      physicalIndex: 0,
      type: sourceLayoutTypeKey("Packet"),
      shape: pointerShape64(),
      source: "targetAbi",
    };

    const diagnostics = validateHiddenAbiParameters({
      functionInstanceId,
      hiddenParameters: [hidden],
      shapes: [],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT"),
    );
  });

  test("rejects hidden parameters referenced by indirect shapes but missing from list", () => {
    const functionInstanceId = monoInstanceId("fn:test");
    const hidden: LayoutAbiHiddenParameterFact = {
      kind: "sret",
      physicalIndex: 0,
      type: sourceLayoutTypeKey("Packet"),
      shape: pointerShape64(),
      source: "targetAbi",
    };
    const shape: LayoutAbiValueShape = {
      kind: "indirect",
      pointer: pointerShape64(),
      pointee: sourceLayoutTypeKey("Packet"),
      ownership: "callerAllocated",
      hiddenParameter: hidden,
    };

    const diagnostics = validateHiddenAbiParameters({
      functionInstanceId,
      hiddenParameters: [],
      shapes: [shape],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT"),
    );
  });

  test("accepts hidden parameters referenced exactly once in physical order", () => {
    const functionInstanceId = monoInstanceId("fn:test");
    const hidden: LayoutAbiHiddenParameterFact = {
      kind: "sret",
      physicalIndex: 0,
      type: sourceLayoutTypeKey("Packet"),
      shape: pointerShape64(),
      source: "targetAbi",
    };
    const shape: LayoutAbiValueShape = {
      kind: "indirect",
      pointer: pointerShape64(),
      pointee: sourceLayoutTypeKey("Packet"),
      ownership: "callerAllocated",
      hiddenParameter: hidden,
    };

    const diagnostics = validateHiddenAbiParameters({
      functionInstanceId,
      hiddenParameters: [hidden],
      shapes: [shape],
    });

    expect(diagnostics).toHaveLength(0);
  });

  test("rejects distinct hidden parameters claiming the same physical slot", () => {
    const functionInstanceId = monoInstanceId("fn:test");
    const firstHidden: LayoutAbiHiddenParameterFact = {
      kind: "sret",
      physicalIndex: 0,
      type: sourceLayoutTypeKey("Packet"),
      shape: pointerShape64(),
      source: "targetAbi",
    };
    const secondHidden: LayoutAbiHiddenParameterFact = {
      kind: "context",
      physicalIndex: 0,
      type: sourceLayoutTypeKey("Packet"),
      shape: pointerShape64(),
      source: "targetAbi",
    };
    const shape: LayoutAbiValueShape = {
      kind: "indirect",
      pointer: pointerShape64(),
      pointee: sourceLayoutTypeKey("Packet"),
      ownership: "callerAllocated",
      hiddenParameter: firstHidden,
    };

    const diagnostics = validateHiddenAbiParameters({
      functionInstanceId,
      hiddenParameters: [firstHidden, secondHidden],
      shapes: [shape],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT"),
    );
  });
});

describe("classifySourceAbiParameter", () => {
  test("classifies unsigned integer parameters as direct lanes", () => {
    const target = layoutTargetSurfaceFake();
    const targetFacts = normalizeTargetFactsForTest(target);
    const layout: LayoutTypeFact = {
      key: { kind: "core", coreTypeId: coreTypeId("u32") },
      sizeBytes: 4n,
      alignmentBytes: 4n,
      strideBytes: 4n,
      representation: { kind: "primitive", primitive: "unsignedInteger" },
    };

    const result = classifySourceAbiParameter({
      target,
      targetFacts,
      parameterId: parameterId(0),
      mode: "observe",
      type: layout.key,
      layout,
      sourceOrigin: "test:0:0",
    });

    expect(result.fact?.shape.kind).toBe("direct");
  });
});

describe("classifySourceAbiReturn", () => {
  test("classifies Never return values as none", () => {
    const target = layoutTargetSurfaceFake();
    const targetFacts = normalizeTargetFactsForTest(target);
    const layout: LayoutTypeFact = {
      key: { kind: "core", coreTypeId: coreTypeId("Never") },
      sizeBytes: 0n,
      alignmentBytes: 1n,
      strideBytes: 0n,
      representation: { kind: "never" },
    };

    const result = classifySourceAbiReturn({
      target,
      targetFacts,
      type: layout.key,
      layout,
      sourceOrigin: "test:0:0",
    });

    expect(result.fact?.shape).toEqual({
      kind: "none",
      reason: "never",
      proofCarrying: false,
    });
  });
});

describe("collectSourceFunctionAbiFailures", () => {
  test("collects source function IDs from per-function diagnostic owner keys on grouped issues", () => {
    const functionInstanceId = monoInstanceId("fn:GroupedAbiFailure");
    const sourceFunctionId = functionId(42);
    const program = {
      functions: {
        get(id: import("../../../src/mono/ids").MonoInstanceId) {
          if (String(id) === String(functionInstanceId)) {
            return { sourceFunctionId };
          }
          return undefined;
        },
        entries: () => [],
      },
    } as unknown as MonomorphizedHirProgram;

    const failures = collectSourceFunctionAbiFailures(program, [
      {
        ownerKey: layoutOwnerKey("functions:target-1"),
        dependencies: [],
        diagnostics: [
          layoutDiagnostic({
            severity: "error",
            code: layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
            message: "ABI classification failed.",
            ownerKey: `function:${String(functionInstanceId)}`,
            rootCauseKey: `abi:${String(functionInstanceId)}`,
            stableDetail: "grouped-failure",
          }),
        ],
      },
    ]);

    expect(failures.has(sourceFunctionId)).toBe(true);
  });
});
