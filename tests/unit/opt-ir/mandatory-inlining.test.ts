import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrCallId,
  optIrFactId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrIntrinsicCallOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrPlatformCallOperation,
  optIrSourceCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  runMandatoryInliningForTest,
  type MandatoryInliningFunctionSummary,
} from "../../../src/opt-ir/passes/mandatory-inlining";
import type { OptIrMandatoryInlineReason } from "../../../src/opt-ir/policy/inline-policy";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import { optIrBooleanType, optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { coreTypeId, functionId, itemId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";

const integer32 = optIrSignedIntegerType(32);

describe("mandatory semantic inlining", () => {
  test("inlines only checked mandatory candidates and rehomes caller-local facts", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("validate.wrapper") },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const helperOperation = addOperation(30, 40, 100, 2);

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "validate.wrapper",
        parameters: [optIrValueId(100)],
        operations: [helperOperation.operationId],
        terminatorValues: [optIrValueId(40)],
        summary: mandatorySummary("validationHelper"),
      }),
      operations: [call, helperOperation],
      facts: [
        {
          factId: optIrFactId(1),
          kind: "bounds",
          subject: { kind: "value", valueId: optIrValueId(40) },
          scope: { kind: "function", functionId: 2 },
          dependencies: [{ kind: "value", valueId: optIrValueId(100) }],
          invalidations: [],
        },
      ],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected mandatory inlining to succeed.");
    }
    expect(result.function.blocks[0]?.operations).toEqual([call.operationId]);
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      call.operationId,
      helperOperation.operationId,
    ]);
    const inlinedOperation = result.operations.find(
      (operation) => operation.operationId === call.operationId,
    );
    expect(inlinedOperation?.operandIds).toEqual([optIrValueId(1), optIrValueId(2)]);
    expect(inlinedOperation).toMatchObject({
      left: optIrValueId(1),
      right: optIrValueId(2),
    });
    expect(result.preservedFacts).toMatchObject([
      {
        factId: optIrFactId(100),
        kind: "bounds",
        subject: { kind: "value", valueId: optIrValueId(20) },
        scope: { kind: "function", functionId: 1 },
        dependencies: [{ kind: "value", valueId: optIrValueId(1) }],
      },
    ]);
    expect(result.droppedFacts).toEqual([]);
  });

  test("does not create mandatory candidates from body shape", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("ordinary.wrapper") },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const helperOperation = addOperation(30, 40, 100, 2);

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "ordinary.wrapper",
        parameters: [optIrValueId(100)],
        operations: [helperOperation.operationId],
        terminatorValues: [optIrValueId(40)],
        summary: { semanticInlinePolicy: { kind: "eligible" } },
      }),
      operations: [call, helperOperation],
      facts: [],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected mandatory inlining to skip ordinary candidate.");
    }
    expect(result.function.blocks[0]?.operations).toEqual([call.operationId]);
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      call.operationId,
      helperOperation.operationId,
    ]);
  });

  test("rewrites operation-specific value fields while inlining", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("compare.wrapper") },
      argumentIds: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(20)],
      resultTypes: [optIrBooleanType()],
      originId: optIrOriginId(1),
    });
    const comparison = optIrIntegerCompareOperation({
      operationId: optIrOperationId(30),
      resultId: optIrValueId(40),
      left: optIrValueId(100),
      right: optIrValueId(101),
      operator: "signedLessThan",
      originId: optIrOriginId(2),
    });

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "compare.wrapper",
        parameters: [optIrValueId(100), optIrValueId(101)],
        operations: [comparison.operationId],
        terminatorValues: [optIrValueId(40)],
        summary: mandatorySummary("validationHelper"),
      }),
      operations: [call, comparison],
      facts: [],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected mandatory inlining to succeed.");
    }
    const inlinedOperation = result.operations.find(
      (operation) => operation.operationId === call.operationId,
    );
    expect(inlinedOperation).toMatchObject({
      kind: "integerCompare",
      operandIds: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(20)],
      left: optIrValueId(1),
      right: optIrValueId(2),
    });
  });

  test("inlines mandatory platform wrappers at the source call site", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("console.wrapper") },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const platformCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(30),
      callId: optIrCallId(2),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(100)],
      resultIds: [optIrValueId(40)],
      resultTypes: [integer32],
      originId: optIrOriginId(2),
    });

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "console.wrapper",
        parameters: [optIrValueId(100)],
        operations: [platformCall.operationId],
        terminatorValues: [optIrValueId(40)],
        summary: mandatorySummary("platformWrapper"),
      }),
      operations: [call, platformCall],
      facts: [],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected mandatory platform wrapper inlining to succeed.");
    }
    expect(result.function.blocks[0]?.operations).toEqual([call.operationId]);
    const inlinedOperation = result.operations.find(
      (operation) => operation.operationId === call.operationId,
    );
    expect(inlinedOperation).toMatchObject({
      kind: "platformCall",
      callId: optIrCallId(10),
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
    });
  });

  test("inlines mandatory intrinsic wrappers at the source call site", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("utf16.wrapper") },
      argumentIds: [],
      resultIds: [optIrValueId(20)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const intrinsic = optIrIntrinsicCallOperation({
      operationId: optIrOperationId(30),
      callId: optIrCallId(2),
      target: {
        kind: "intrinsic",
        intrinsicKey: "uefi.utf16_static",
        sourceValueKey: "hir.expression:2",
      },
      argumentIds: [],
      resultIds: [optIrValueId(40)],
      resultTypes: [integer32],
      originId: optIrOriginId(2),
    });

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "utf16.wrapper",
        operations: [intrinsic.operationId],
        terminatorValues: [optIrValueId(40)],
        summary: mandatorySummary("runtimeWrapper"),
      }),
      operations: [call, intrinsic],
      facts: [],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected mandatory intrinsic wrapper inlining to succeed.");
    }
    expect(result.function.blocks[0]?.operations).toEqual([call.operationId]);
    const inlinedOperation = result.operations.find(
      (operation) => operation.operationId === call.operationId,
    );
    expect(inlinedOperation).toMatchObject({
      kind: "intrinsicCall",
      callId: optIrCallId(10),
      resultIds: [optIrValueId(20)],
    });
  });

  test("returns an internal compiler error when mandatory body shape is unsafe", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("platform.wrapper") },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const logging = optIrSourceCallOperation({
      operationId: optIrOperationId(30),
      callId: optIrCallId(2),
      target: { kind: "source", functionInstanceId: monoInstanceId("log.side.effect") },
      argumentIds: [optIrValueId(100)],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(2),
    });

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "platform.wrapper",
        parameters: [optIrValueId(100)],
        operations: [logging.operationId],
        terminatorValues: [optIrValueId(100)],
        summary: mandatorySummary("platformWrapper"),
      }),
      operations: [call, logging],
      facts: [],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected mandatory inlining to fail.");
    }
    expect(String(result.diagnostics[0]?.code)).toBe("OPT_IR_REWRITE_LEGALITY_INVALID");
    expect(result.diagnostics[0]?.messageTemplate).toContain("Internal compiler error");
  });

  test("returns an internal compiler error when callee operation ids collide with caller ids", () => {
    const call = optIrSourceCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("colliding.wrapper") },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(20)],
      resultTypes: [integer32],
      originId: optIrOriginId(1),
    });
    const callerOperation = addOperation(30, 90, 1, 2);
    const collidingCalleeOperation = addOperation(30, 40, 100, 2);

    const result = runMandatoryInliningForTest({
      caller: functionWithOperations({
        functionId: 1,
        instance: "caller",
        operations: [call.operationId, callerOperation.operationId],
      }),
      callee: functionWithOperations({
        functionId: 2,
        instance: "colliding.wrapper",
        parameters: [optIrValueId(100)],
        operations: [collidingCalleeOperation.operationId],
        terminatorValues: [optIrValueId(40)],
        summary: mandatorySummary("validationHelper"),
      }),
      operations: [call, callerOperation, collidingCalleeOperation],
      facts: [],
      nextFactId: counter(100, optIrFactId),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected mandatory inlining to fail.");
    }
    expect(result.diagnostics[0]?.arguments).toMatchObject({
      detail: "operation-id-collision",
    });
  });
});

function mandatorySummary(reason: OptIrMandatoryInlineReason): MandatoryInliningFunctionSummary {
  return {
    semanticInlinePolicy: {
      kind: "mandatory",
      reason,
      source: "checkedSummary",
      certificateId: "summary:1",
    },
    terminalBehavior: { kind: "returns" },
    divergence: [],
    observedRegions: [],
    consumedRegions: [],
    mutatedRegions: [],
    producedRegions: [],
    capabilityEffects: [],
    privateStateEffects: [],
    invalidations: [],
  };
}

function functionWithOperations(input: {
  readonly functionId: number;
  readonly instance: string;
  readonly parameters?: readonly ReturnType<typeof optIrValueId>[];
  readonly operations: readonly ReturnType<typeof optIrOperationId>[];
  readonly terminatorValues?: readonly ReturnType<typeof optIrValueId>[];
  readonly summary?: unknown;
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
    summary: input.summary,
    originId: optIrOriginId(input.functionId),
  };
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
    originId: optIrOriginId(1),
  });
}

function signatureForTest(identifier: number): MonoFunctionSignature {
  return {
    functionId: functionId(identifier),
    itemId: itemId(identifier),
    parameters: [],
    returnType: coreCheckedType(coreTypeId("I32")) as MonoCheckedType,
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

function counter<Value>(initial: number, create: (value: number) => Value): () => Value {
  let next = initial;
  return () => {
    const value = create(next);
    next += 1;
    return value;
  };
}
