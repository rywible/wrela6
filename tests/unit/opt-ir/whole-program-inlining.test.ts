import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
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
import {
  optIrCodeSizeBudget,
  optIrExpansionFuel,
} from "../../../src/opt-ir/policy/expansion-budget";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import {
  optIrIntegerBinaryOperation,
  optIrPlatformCallOperation,
  optIrSourceCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  runWholeProgramInliningForTest,
  type OptIrWholeProgramInliningWorkItem,
} from "../../../src/opt-ir/passes/whole-program-inlining";
import { optIrConstantTable } from "../../../src/opt-ir/program";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { coreTypeId, functionId, itemId, targetId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";

const integer32 = optIrSignedIntegerType(32);
const monoInteger32 = coreCheckedType(coreTypeId("I32")) as MonoCheckedType;

describe("budgeted whole-program inlining", () => {
  test("inlines an acyclic closed source call after reserving and committing budget", () => {
    const call = sourceCall(10, "small.callee", [1], [20]);
    const add = addOperation(30, 40, 100, 2);
    const program = programForTest([
      functionWithOperations({ functionId: 1, instance: "caller", operations: [call.operationId] }),
      functionWithOperations({
        functionId: 2,
        instance: "small.callee",
        parameters: [optIrValueId(100)],
        operations: [add.operationId],
        terminatorValues: [optIrValueId(40)],
      }),
    ]);

    const result = runWholeProgramInliningForTest({
      program,
      operations: [call, add],
      budget: budgetForTest(10),
    });

    expect(result.program.functions.get(optIrFunctionId(1))?.blocks[0]?.operations).toEqual([
      call.operationId,
    ]);
    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(result.operations.map((operation) => operation.operationId)).toEqual([call.operationId]);
    expect(
      result.operations.find((operation) => operation.operationId === call.operationId),
    ).toMatchObject({
      operandIds: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(20)],
      left: optIrValueId(1),
      right: optIrValueId(2),
    });
    expect(result.decisionLog.entries()).toEqual([
      expect.objectContaining({
        candidateKey: "inline:caller=1:callee=2:site=10",
        policyResult: "accepted",
        stableReason: "inline:accepted",
      }),
    ]);
    expect(result.worklist).toEqual([
      workItem("cleanup", 1, "inline:caller=1:callee=2:site=10"),
      workItem("sccp", 1, "inline:caller=1:callee=2:site=10"),
      workItem("specialization", 1, "inline:caller=1:callee=2:site=10"),
    ]);
    expect(result.remainingImageBudget.amount).toBe(9);
  });

  test("keeps ABI roots, recursive SCC calls, escaped callable identity, and hard effect boundaries", () => {
    const rootCall = sourceCall(10, "abi.root", [1], [20]);
    const selfCall = sourceCall(11, "recursive", [1], [21]);
    const recursiveSelfCall = sourceCall(33, "recursive", [100], [43]);
    const callbackCall = sourceCall(12, "callback.target", [1], [22]);
    const platformCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(13),
      callId: optIrCallId(13),
      target: { kind: "platform", platformKey: "uefi.exit-boot-services" },
      argumentIds: [optIrValueId(1)],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(13),
    });
    const body = addOperation(30, 40, 100, 2);
    const recursiveBody = addOperation(31, 41, 100, 2);
    const callbackBody = addOperation(32, 42, 100, 2);
    const program = programForTest([
      functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [
          rootCall.operationId,
          selfCall.operationId,
          callbackCall.operationId,
          platformCall.operationId,
        ],
      }),
      functionWithOperations({
        functionId: 2,
        instance: "abi.root",
        parameters: [optIrValueId(100)],
        operations: [body.operationId],
        terminatorValues: [optIrValueId(40)],
        externalRoot: true,
      }),
      functionWithOperations({
        functionId: 3,
        instance: "recursive",
        parameters: [optIrValueId(100)],
        operations: [recursiveSelfCall.operationId, recursiveBody.operationId],
        terminatorValues: [optIrValueId(41)],
      }),
      functionWithOperations({
        functionId: 4,
        instance: "callback.target",
        parameters: [optIrValueId(100)],
        operations: [callbackBody.operationId],
        terminatorValues: [optIrValueId(42)],
      }),
    ]);

    const result = runWholeProgramInliningForTest({
      program,
      operations: [
        rootCall,
        selfCall,
        callbackCall,
        platformCall,
        body,
        recursiveBody,
        callbackBody,
        recursiveSelfCall,
      ],
      budget: budgetForTest(10),
      escapedCallableFunctionIds: [optIrFunctionId(4)],
    });

    expect(result.program.functions.get(optIrFunctionId(1))?.blocks[0]?.operations).toEqual([
      rootCall.operationId,
      selfCall.operationId,
      callbackCall.operationId,
      platformCall.operationId,
    ]);
    expect(result.decisionLog.entries().map((entry) => entry.stableReason)).toEqual(
      expect.arrayContaining([
        "inline:denied:effect-boundary",
        "inline:denied:external-root",
        "inline:denied:recursive-scc",
        "inline:denied:escaped-callable-identity",
      ]),
    );
    expect(result.worklist).toEqual([]);
  });

  test("inlines source wrappers around non-terminal platform calls", () => {
    const call = sourceCall(10, "platform.wrapper", [1], [20]);
    const platformCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(30),
      callId: optIrCallId(30),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(100)],
      resultIds: [optIrValueId(40)],
      resultTypes: [integer32],
      originId: optIrOriginId(30),
    });
    const program = programForTest([
      functionWithOperations({ functionId: 1, instance: "caller", operations: [call.operationId] }),
      functionWithOperations({
        functionId: 2,
        instance: "platform.wrapper",
        parameters: [optIrValueId(100)],
        operations: [platformCall.operationId],
        terminatorValues: [optIrValueId(40)],
      }),
    ]);

    const result = runWholeProgramInliningForTest({
      program,
      operations: [call, platformCall],
      budget: budgetForTest(10),
    });

    expect(result.program.functions.get(optIrFunctionId(1))?.blocks[0]?.operations).toEqual([
      call.operationId,
    ]);
    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(
      result.operations.find((operation) => operation.operationId === call.operationId),
    ).toMatchObject({
      kind: "platformCall",
      callId: optIrCallId(10),
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
    });
    expect(result.decisionLog.entries()[0]).toMatchObject({
      policyResult: "accepted",
      stableReason: "inline:accepted",
    });
  });

  test("releases a successful reservation when rewrite legality rejects the candidate", () => {
    const call = sourceCall(10, "small.callee", [1], [20]);
    const sideEffect = sourceCall(30, "unknown.effect", [100], []);
    const program = programForTest([
      functionWithOperations({ functionId: 1, instance: "caller", operations: [call.operationId] }),
      functionWithOperations({
        functionId: 2,
        instance: "small.callee",
        parameters: [optIrValueId(100)],
        operations: [sideEffect.operationId],
        terminatorValues: [optIrValueId(100)],
      }),
    ]);

    const result = runWholeProgramInliningForTest({
      program,
      operations: [call, sideEffect],
      budget: budgetForTest(1),
    });

    expect(result.program.functions.get(optIrFunctionId(1))?.blocks[0]?.operations).toEqual([
      call.operationId,
    ]);
    expect(result.remainingImageBudget.amount).toBe(1);
    expect(result.decisionLog.entries()[0]).toMatchObject({
      policyResult: "denied",
      stableReason: "inline:denied:rewrite-legality",
    });
  });

  test("rejects candidates whose callee operation ids collide with caller operation ids", () => {
    const call = sourceCall(10, "small.callee", [1], [20]);
    const callerOperation = addOperation(30, 50, 1, 2);
    const collidingCalleeOperation = addOperation(30, 40, 100, 2);
    const program = programForTest([
      functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId, callerOperation.operationId],
      }),
      functionWithOperations({
        functionId: 2,
        instance: "small.callee",
        parameters: [optIrValueId(100)],
        operations: [collidingCalleeOperation.operationId],
        terminatorValues: [optIrValueId(40)],
      }),
    ]);

    const result = runWholeProgramInliningForTest({
      program,
      operations: [call, callerOperation, collidingCalleeOperation],
      budget: budgetForTest(2),
    });

    expect(result.program.functions.get(optIrFunctionId(1))?.blocks[0]?.operations).toEqual([
      call.operationId,
      callerOperation.operationId,
    ]);
    expect(result.remainingImageBudget.amount).toBe(2);
    expect(result.decisionLog.entries()[0]).toMatchObject({
      policyResult: "denied",
      stableReason: "inline:denied:rewrite-legality",
    });
  });
});

function budgetForTest(perImageGrowth: number) {
  return {
    perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", perImageGrowth),
    perSccGrowth: optIrCodeSizeBudget("normalizedOperation", perImageGrowth),
    perImageGrowth: optIrCodeSizeBudget("normalizedOperation", perImageGrowth),
    fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", perImageGrowth),
  };
}

function workItem(
  kind: OptIrWholeProgramInliningWorkItem["kind"],
  functionIdValue: number,
  reason: string,
): OptIrWholeProgramInliningWorkItem {
  return { kind, functionId: optIrFunctionId(functionIdValue), reason };
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

function addOperation(
  operationId: number,
  resultId: number,
  left: number,
  right: number,
): OptIrOperation {
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
  readonly externalRoot?: boolean;
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
    ...(input.externalRoot === true && {
      externalRoot: { reason: "imageEntry" as const, originId: optIrOriginId(input.functionId) },
    }),
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
