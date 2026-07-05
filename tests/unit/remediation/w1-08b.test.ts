import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrCallId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import {
  optIrIntegerBinaryOperation,
  optIrSourceCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { createOptIrFreshIdAllocator } from "../../../src/opt-ir/id-allocation";
import {
  runWholeProgramInliningForTest,
  type RunWholeProgramInliningResult,
} from "../../../src/opt-ir/passes/whole-program-inlining";
import { verifyPipelineState } from "../../../src/opt-ir/passes/pipeline-state";
import {
  optIrCodeSizeBudget,
  optIrExpansionFuel,
} from "../../../src/opt-ir/policy/expansion-budget";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { coreTypeId, functionId, itemId, targetId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";

const integer32 = optIrSignedIntegerType(32);
const monoInteger32 = coreCheckedType(coreTypeId("I32")) as MonoCheckedType;

describe("W1-08b return-result binding", () => {
  test("a callee returning a used parameter keeps cloned operands bound to caller arguments", () => {
    const call = sourceCall(10, "uses.then.returns.parameter", [1], [20]);
    const calleeUse = addOperation(30, 40, 100, 2);
    const callerUse = addOperation(11, 21, 20, 3);
    const program = programForTest([
      functionWithOperations({
        functionId: 1,
        instance: "caller",
        parameters: [optIrValueId(1), optIrValueId(2), optIrValueId(3)],
        operations: [call.operationId, callerUse.operationId],
        terminatorValues: [optIrValueId(21)],
      }),
      functionWithOperations({
        functionId: 2,
        instance: "uses.then.returns.parameter",
        parameters: [optIrValueId(100)],
        operations: [calleeUse.operationId],
        terminatorValues: [optIrValueId(100)],
      }),
    ]);

    const result = inline(program, [call, callerUse, calleeUse]);
    const clonedUse = result.operations.find(
      (operation) =>
        operation.kind === "integerBinary" && operation.operationId !== callerUse.operationId,
    );
    const rewrittenCallerUse = result.operations.find(
      (operation) => operation.operationId === callerUse.operationId,
    );

    expect(clonedUse).toMatchObject({
      kind: "integerBinary",
      operandIds: [optIrValueId(1), optIrValueId(2)],
      left: optIrValueId(1),
      right: optIrValueId(2),
    });
    expect(rewrittenCallerUse).toMatchObject({
      operandIds: [optIrValueId(20), optIrValueId(3)],
      left: optIrValueId(20),
      right: optIrValueId(3),
    });
    expect(verifyResult(result)).toEqual([]);
  });
});

function inline(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
): RunWholeProgramInliningResult {
  return runWholeProgramInliningForTest({
    program,
    operations,
    budget: {
      perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 10),
    },
    freshIds: createOptIrFreshIdAllocator({ program, operations }),
  });
}

function verifyResult(result: RunWholeProgramInliningResult): readonly string[] {
  const verified = verifyPipelineState(
    {
      program: result.program,
      operations: result.operations,
      optimizationRegions: [],
      facts: emptyOptIrFactSet(),
      diagnostics: [],
      decisionLog: result.decisionLog,
      verificationCheckpoints: [],
    },
    { kind: "after-scope-expansion-mutation", passId: "whole-program-inlining" },
  );
  return "kind" in verified && verified.kind === "error"
    ? verified.diagnostics.map((diagnostic) => diagnostic.code)
    : [];
}

function sourceCall(
  operationId: number,
  callee: string,
  argumentIds: readonly number[],
  resultIds: readonly number[],
) {
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

function addOperation(operationId: number, resultId: number, left: number, right: number) {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    left: optIrValueId(left),
    right: optIrValueId(right),
    operator: "add",
    resultType: integer32,
    originId: optIrOriginId(operationId),
  });
}

function programForTest(functions: readonly OptIrFunction[]): OptIrProgram {
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

function functionWithOperations(input: {
  readonly functionId: number;
  readonly instance: string;
  readonly parameters?: readonly ReturnType<typeof optIrValueId>[];
  readonly operations: readonly ReturnType<typeof optIrOperationId>[];
  readonly terminatorValues?: readonly ReturnType<typeof optIrValueId>[];
}): OptIrFunction {
  const block: OptIrBlock = {
    blockId: optIrBlockId(input.functionId),
    parameters: (input.parameters ?? []).map((valueId) =>
      optIrBlockParameter({
        valueId,
        type: integer32,
        incomingRole: "entry",
        originId: optIrOriginId(input.functionId),
      }),
    ),
    operations: input.operations,
    terminator:
      input.terminatorValues === undefined
        ? undefined
        : {
            kind: "return",
            operationId: optIrOperationId(input.functionId + 1000),
            values: input.terminatorValues,
            originId: optIrOriginId(input.functionId),
          },
    originId: optIrOriginId(input.functionId),
  };
  return {
    functionId: optIrFunctionId(input.functionId),
    monoInstanceId: monoInstanceId(input.instance),
    signature: signatureForTest(input.functionId),
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId: optIrOriginId(input.functionId),
  };
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
