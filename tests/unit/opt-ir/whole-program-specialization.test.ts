import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrBlockId,
  optIrCallId,
  optIrConstantId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrPlatformCallOperation,
  optIrSourceCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  optIrCodeSizeBudget,
  optIrExpansionFuel,
} from "../../../src/opt-ir/policy/expansion-budget";
import {
  runWholeProgramSpecializationForTest,
  type OptIrWholeProgramSpecializationWorkItem,
} from "../../../src/opt-ir/passes/whole-program-specialization";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
} from "../../../src/opt-ir/program";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { checkedFunctionSummaryCertificateId } from "../../../src/proof-check/model/certificates";
import type { CheckedFunctionSummary } from "../../../src/proof-check/model/function-summary";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { coreTypeId, functionId, itemId, targetId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";

const integer32 = optIrSignedIntegerType(32);
const monoInteger32 = coreCheckedType(coreTypeId("I32")) as MonoCheckedType;

describe("whole-program specialization", () => {
  test("evaluates static pure operations to interned constants with rewrite obligations", () => {
    const left = constantOperation(10, 1, 7n);
    const right = constantOperation(11, 2, 5n);
    const add = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(12),
      resultId: optIrValueId(3),
      left: optIrValueId(1),
      right: optIrValueId(2),
      operator: "add",
      resultType: integer32,
      originId: optIrOriginId(12),
    });
    const program = programForTest([
      functionForTest({ functionId: 1, instance: "main", operations: [10, 11, 12] }),
    ]);

    const result = runWholeProgramSpecializationForTest({
      program,
      operations: [add, right, left],
      budget: budgetForTest(8),
    });

    const replacement = result.operations.find(
      (operation) => operation.resultIds[0] === optIrValueId(3),
    );
    expect(replacement).toMatchObject({
      kind: "constant",
      constant: { normalizedValue: 12n },
    });
    expect(result.rewriteObligations.map((obligation) => obligation.ruleId)).toEqual([
      "specialization-static-evaluation",
    ]);
    expect(
      result.rewriteObligations[0]?.invariant.decomposesTo.map((entry) => entry.kind),
    ).toContain("pureAlgebraicEquivalence");
    expect(result.worklist).toEqual([workItem("cleanup", 1, "specialize:static-eval:12")]);
  });

  test("refuses clones across roots, effects, recursion, cold paths, and exhausted variant caps", () => {
    const rootCall = sourceCall(20, "root", [1], [30]);
    const recursiveCall = sourceCall(21, "recursive", [1], [31]);
    const effectCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(22),
      callId: optIrCallId(22),
      target: { kind: "platform", platformKey: "device.mmio" },
      argumentIds: [optIrValueId(1)],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(22),
    });
    const coldCall = sourceCall(23, "cold", [1], [32]);
    const cloneableCall = sourceCall(24, "cloneable", [1], [33]);
    const recursiveBodyCall = sourceCall(25, "recursive", [100], [101]);
    const program = programForTest([
      functionForTest({ functionId: 1, instance: "main", operations: [20, 21, 22, 23, 24] }),
      functionForTest({ functionId: 2, instance: "root", operations: [], externalRoot: true }),
      functionForTest({ functionId: 3, instance: "recursive", operations: [25] }),
      functionForTest({
        functionId: 4,
        instance: "cold",
        operations: [],
        summary: {
          ...checkedFunctionSummaryForOptIrTest(monoInstanceId("cold")),
          isCold: true,
        },
      }),
      functionForTest({ functionId: 5, instance: "cloneable", operations: [] }),
    ]);

    const result = runWholeProgramSpecializationForTest({
      program,
      operations: [rootCall, recursiveCall, effectCall, coldCall, cloneableCall, recursiveBodyCall],
      budget: budgetForTest(0),
      constantValues: new Map([
        [
          optIrValueId(1),
          optIrIntegerConstant({
            constantId: optIrConstantId(1),
            type: integer32,
            normalizedValue: 1n,
          }),
        ],
      ]),
      maxVariantsPerFunction: 0,
    });

    expect(result.decisionLog.entries().map((entry) => entry.stableReason)).toEqual(
      expect.arrayContaining([
        "specialize:denied:external-root",
        "specialize:denied:recursive-scc",
        "specialize:denied:effect-boundary",
        "specialize:denied:cold-path",
        "specialize:denied:variant-cap",
      ]),
    );
    expect(result.program.functions.entries().map((entry) => entry.functionId)).toEqual([
      optIrFunctionId(1),
      optIrFunctionId(2),
      optIrFunctionId(3),
      optIrFunctionId(4),
      optIrFunctionId(5),
    ]);
  });

  test("materializes and deduplicates clone variants for canonical static arguments", () => {
    const constant = constantOperation(10, 1, 7n);
    const firstCall = sourceCall(20, "cloneable", [1], [30]);
    const secondCall = sourceCall(21, "cloneable", [1], [31]);
    const calleeAdd = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(30),
      resultId: optIrValueId(101),
      left: optIrValueId(100),
      right: optIrValueId(100),
      operator: "add",
      resultType: integer32,
      originId: optIrOriginId(30),
    });
    const program = programForTest([
      functionForTest({ functionId: 1, instance: "main", operations: [10, 20, 21] }),
      functionForTest({ functionId: 2, instance: "cloneable", operations: [30] }),
    ]);

    const result = runWholeProgramSpecializationForTest({
      program,
      operations: [secondCall, calleeAdd, constant, firstCall],
      budget: budgetForTest(8),
    });

    const clone = result.program.functions
      .entries()
      .find((func) => String(func.monoInstanceId).startsWith("cloneable.specialized."));
    if (clone === undefined) {
      throw new Error("Expected whole-program specialization to materialize a clone.");
    }
    const retargetedCalls = result.operations.filter(isRetargetedSourceCallForTest);
    expect(retargetedCalls.map((operation) => operation.target)).toEqual([
      { kind: "source", functionInstanceId: clone.monoInstanceId },
      { kind: "source", functionInstanceId: clone.monoInstanceId },
    ]);
    expect(retargetedCalls.map((operation) => operation.argumentIds)).toEqual([[], []]);
    expect(clone.blocks[0]?.parameters).toEqual([]);
    expect(clone.blocks[0]?.operations.length).toBe(2);
    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(
      result.operations.some((operation) => operation.operationId === calleeAdd.operationId),
    ).toBe(false);
    expect(result.decisionLog.entries().map((entry) => entry.stableReason)).toEqual([
      "specialize:clone:materialized",
      "specialize:clone:deduplicated",
    ]);
    expect(result.remainingImageBudget.amount).toBe(7);
    expect(result.rewriteObligations.map((obligation) => obligation.ruleId)).toContain(
      "specialization-clone-materialization",
    );
  });
});

type SourceCallOperationForTest = OptIrOperation & {
  readonly kind: "sourceCall";
  readonly target: { readonly kind: "source" };
  readonly argumentIds: readonly ReturnType<typeof optIrValueId>[];
};

function isRetargetedSourceCallForTest(
  operation: OptIrOperation,
): operation is SourceCallOperationForTest {
  return (
    operation.kind === "sourceCall" &&
    (operation.operationId === optIrOperationId(20) ||
      operation.operationId === optIrOperationId(21))
  );
}

function budgetForTest(perImageGrowth: number) {
  return {
    perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", perImageGrowth),
    perSccGrowth: optIrCodeSizeBudget("normalizedOperation", perImageGrowth),
    perImageGrowth: optIrCodeSizeBudget("normalizedOperation", perImageGrowth),
    fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", perImageGrowth),
  };
}

function constantOperation(operationId: number, resultId: number, value: bigint): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operationId),
      type: integer32,
      normalizedValue: value,
    }),
    originId: optIrOriginId(operationId),
  });
}

function sourceCall(
  operationId: number,
  callee: string,
  argumentIds: readonly number[],
  resultIds: readonly number[],
): OptIrOperation {
  return optIrSourceCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "source", functionInstanceId: monoInstanceId(callee) },
    argumentIds: argumentIds.map(optIrValueId),
    resultIds: resultIds.map(optIrValueId),
    resultTypes: resultIds.map(() => integer32),
    originId: optIrOriginId(operationId),
  });
}

function programForTest(functions: readonly OptIrFunction[]) {
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("test-target"),
    functions: optIrFunctionTable(functions),
    regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId: optIrOriginId(1) }]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [] },
  });
}

function functionForTest(input: {
  readonly functionId: number;
  readonly instance: string;
  readonly operations: readonly number[];
  readonly externalRoot?: boolean;
  readonly summary?: CheckedFunctionSummary & { readonly isCold?: boolean };
}): OptIrFunction {
  const block: OptIrBlock = {
    blockId: optIrBlockId(input.functionId),
    parameters: [
      optIrBlockParameter({
        valueId: optIrValueId(100),
        type: integer32,
        incomingRole: "entry",
        originId: optIrOriginId(input.functionId),
      }),
    ],
    operations: input.operations.map(optIrOperationId),
    originId: optIrOriginId(input.functionId),
  };
  return {
    functionId: optIrFunctionId(input.functionId),
    monoInstanceId: monoInstanceId(input.instance),
    signature: signatureForTest(input.functionId),
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    ...(input.externalRoot === true && {
      externalRoot: { reason: "imageEntry" as const, originId: optIrOriginId(input.functionId) },
    }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    originId: optIrOriginId(input.functionId),
  };
}

function checkedFunctionSummaryForOptIrTest(
  functionInstanceId: ReturnType<typeof monoInstanceId>,
): CheckedFunctionSummary {
  return {
    functionInstanceId,
    requiredFacts: [],
    observedInputs: [],
    consumedInputs: [],
    mutatedInputs: [],
    producedPlaces: [],
    returnedFacts: [],
    invalidatedFacts: [],
    privateStateEffects: [],
    producedCapabilities: [],
    terminalEffects: [],
    divergence: [],
    certificateId: checkedFunctionSummaryCertificateId(1),
  };
}

function workItem(
  kind: OptIrWholeProgramSpecializationWorkItem["kind"],
  functionIdValue: number,
  reason: string,
): OptIrWholeProgramSpecializationWorkItem {
  return { kind, functionId: optIrFunctionId(functionIdValue), reason };
}

function signatureForTest(identifier: number): MonoFunctionSignature {
  return {
    functionId: functionId(identifier),
    itemId: itemId(identifier),
    parameters: [],
    returnType: monoInteger32,
    returnKind: "Copy",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}
