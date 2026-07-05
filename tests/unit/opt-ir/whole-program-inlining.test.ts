import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrCallId,
  optIrEdgeId,
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
  createOptIrFreshIdAllocator,
  type OptIrFreshIdAllocator,
} from "../../../src/opt-ir/id-allocation";
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
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  runWholeProgramInliningForTest as runWholeProgramInliningRawForTest,
  type OptIrWholeProgramInliningWorkItem,
  type RunWholeProgramInliningInput,
  type RunWholeProgramInliningResult,
} from "../../../src/opt-ir/passes/whole-program-inlining";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import { OptIrDiagnosticSink } from "../../../src/opt-ir/diagnostics";
import { runWholeProgramInliningStep } from "../../../src/opt-ir/passes/pipeline-steps";
import { verifyPipelineState } from "../../../src/opt-ir/passes/pipeline-state";
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

    const callerFunction = result.program.functions.get(optIrFunctionId(1));
    const inlinedAdd = result.operations.find(
      (operation) =>
        operation.kind === "integerBinary" && operation.operationId !== add.operationId,
    );
    expect(inlinedAdd).toBeDefined();
    if (inlinedAdd === undefined) return;
    expect(callerFunction?.blocks.flatMap((block) => block.operations)).toEqual([
      inlinedAdd.operationId,
    ]);
    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(result.operations.some((operation) => operation.operationId === call.operationId)).toBe(
      false,
    );
    expect(inlinedAdd).toMatchObject({
      operandIds: [optIrValueId(1), optIrValueId(2)],
      left: optIrValueId(1),
      right: optIrValueId(2),
    });
    expect(
      callerFunction?.blocks.some((block) =>
        block.parameters.some((parameter) => parameter.valueId === optIrValueId(20)),
      ),
    ).toBe(true);
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

  test("uses the supplied canonical allocator when cloning inline bodies", () => {
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
      freshIds: fixedFreshIds({
        blockIds: [501, 502],
        edgeIds: [601, 602],
        operationIds: [701, 702, 703],
        valueIds: [801],
      }),
    });

    expect(result.operations).toContainEqual(
      expect.objectContaining({
        operationId: optIrOperationId(701),
        resultIds: [optIrValueId(801)],
      }),
    );
    const callerFunction = result.program.functions.get(optIrFunctionId(1));
    expect(callerFunction?.blocks.map((block) => block.blockId)).toEqual([
      optIrBlockId(1),
      optIrBlockId(502),
      optIrBlockId(501),
    ]);
    expect(callerFunction?.edges.entries().map((edge) => edge.edgeId)).toEqual([
      optIrEdgeId(601),
      optIrEdgeId(602),
    ]);
  });

  test("production whole-program inlining step uses the pass context allocator", () => {
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

    const result = runWholeProgramInliningStep(
      {
        program,
        operations: [call, add],
        optimizationRegions: [],
        facts: emptyOptIrFactSet(),
        diagnostics: [],
        decisionLog: undefined,
        verificationCheckpoints: [],
      },
      {
        passName: "whole-program-inlining",
        verifierMode: "strict",
        diagnostics: new OptIrDiagnosticSink(),
        freshIds: fixedFreshIds({
          blockIds: [511, 512],
          edgeIds: [611, 612],
          operationIds: [711, 712, 713],
          valueIds: [811],
        }),
      },
    );

    expect(result.operations).toContainEqual(
      expect.objectContaining({
        operationId: optIrOperationId(711),
        resultIds: [optIrValueId(811)],
      }),
    );
  });

  test("denies return binding when callee return arity does not match call results", () => {
    const call = sourceCall(10, "bad.return.arity", [1], [20, 21]);
    const add = addOperation(30, 40, 100, 2);
    const program = programForTest([
      functionWithOperations({ functionId: 1, instance: "caller", operations: [call.operationId] }),
      functionWithOperations({
        functionId: 2,
        instance: "bad.return.arity",
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

    expect(result.program).toBe(program);
    expect(result.operations).toEqual([call, add]);
    expect(result.decisionLog.entries()[0]).toMatchObject({
      policyResult: "denied",
      stableReason: "inline:denied:rewrite-legality",
    });
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

    const callerFunction = result.program.functions.get(optIrFunctionId(1));
    const inlinedPlatformCall = result.operations.find(
      (operation) =>
        operation.kind === "platformCall" && operation.operationId !== platformCall.operationId,
    );
    expect(inlinedPlatformCall).toBeDefined();
    if (inlinedPlatformCall === undefined) return;
    expect(callerFunction?.blocks.flatMap((block) => block.operations)).toEqual([
      inlinedPlatformCall.operationId,
    ]);
    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(inlinedPlatformCall).toMatchObject({
      kind: "platformCall",
      argumentIds: [optIrValueId(1)],
    });
    expect(result.decisionLog.entries()[0]).toMatchObject({
      policyResult: "accepted",
      stableReason: "inline:accepted",
    });
  });

  test("inlines a multi-block callee with branch returns verifier-clean", () => {
    const call = sourceCall(10, "branching.callee", [1, 2], [20]);
    const callerUse = addOperation(11, 21, 20, 3);
    const trueAdd = addOperation(30, 40, 100, 101);
    const falseAdd = addOperation(31, 41, 101, 100);
    const entryToTrue = optIrEdgeId(1);
    const entryToFalse = optIrEdgeId(2);
    const entryBlock: OptIrBlock = {
      blockId: optIrBlockId(20),
      parameters: [optIrValueId(100), optIrValueId(101)].map((valueId) =>
        optIrBlockParameter({
          valueId,
          type: integer32,
          incomingRole: "entry",
          originId: optIrOriginId(20),
        }),
      ),
      operations: [],
      terminator: {
        kind: "branch",
        operationId: optIrOperationId(200),
        condition: optIrValueId(100),
        trueEdge: entryToTrue,
        falseEdge: entryToFalse,
        originId: optIrOriginId(20),
      },
      originId: optIrOriginId(20),
    };
    const trueBlock: OptIrBlock = {
      blockId: optIrBlockId(21),
      parameters: [],
      operations: [trueAdd.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(201),
        values: [optIrValueId(40)],
        originId: optIrOriginId(21),
      },
      originId: optIrOriginId(21),
    };
    const falseBlock: OptIrBlock = {
      blockId: optIrBlockId(22),
      parameters: [],
      operations: [falseAdd.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(202),
        values: [optIrValueId(41)],
        originId: optIrOriginId(22),
      },
      originId: optIrOriginId(22),
    };
    const program = programForTest([
      functionWithOperations({
        functionId: 1,
        instance: "caller",
        parameters: [optIrValueId(1), optIrValueId(2), optIrValueId(3)],
        operations: [call.operationId, callerUse.operationId],
        terminatorValues: [optIrValueId(21)],
      }),
      {
        functionId: optIrFunctionId(2),
        monoInstanceId: monoInstanceId("branching.callee"),
        signature: signatureForTest(2),
        blocks: [entryBlock, trueBlock, falseBlock],
        edges: optIrCfgEdgeTable([
          {
            edgeId: entryToTrue,
            from: entryBlock.blockId,
            toBlock: trueBlock.blockId,
            ordinal: 0,
            kind: "branchTrue",
            arguments: [],
            condition: optIrValueId(100),
            originId: optIrOriginId(20),
          },
          {
            edgeId: entryToFalse,
            from: entryBlock.blockId,
            toBlock: falseBlock.blockId,
            ordinal: 1,
            kind: "branchFalse",
            arguments: [],
            condition: optIrValueId(100),
            originId: optIrOriginId(20),
          },
        ]),
        entryBlock: entryBlock.blockId,
        originId: optIrOriginId(20),
      },
    ]);

    const result = runWholeProgramInliningForTest({
      program,
      operations: [call, callerUse, trueAdd, falseAdd],
      budget: budgetForTest(10),
    });
    const callerFunction = result.program.functions.get(optIrFunctionId(1));

    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(result.operations.some((operation) => operation.operationId === call.operationId)).toBe(
      false,
    );
    expect(callerFunction?.blocks.some((block) => block.terminator?.kind === "branch")).toBe(true);
    expect(
      callerFunction?.blocks.some((block) =>
        block.parameters.some((parameter) => parameter.valueId === optIrValueId(20)),
      ),
    ).toBe(true);
    expect(verifyResult(result)).toEqual([]);
  });

  test("releases a successful reservation when rewrite legality rejects the candidate", () => {
    const call = sourceCall(10, "small.callee", [1], [20]);
    const sideEffect = optIrRuntimeCallOperation({
      operationId: optIrOperationId(30),
      callId: optIrCallId(30),
      target: { kind: "runtime", runtimeKey: "unknown.effect" },
      argumentIds: [optIrValueId(100)],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(30),
    });
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

  test("freshens candidates whose callee operation ids collide with caller operation ids", () => {
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

    const callerOperationIds = result.program.functions
      .get(optIrFunctionId(1))
      ?.blocks.flatMap((block) => block.operations);
    const inlinedOperation = result.operations.find(
      (operation) =>
        operation.kind === "integerBinary" &&
        operation.operationId !== callerOperation.operationId &&
        operation.operationId !== collidingCalleeOperation.operationId,
    );
    expect(callerOperationIds).toContain(callerOperation.operationId);
    expect(callerOperationIds).toContain(inlinedOperation?.operationId);
    expect(result.program.functions.get(optIrFunctionId(2))).toBeUndefined();
    expect(result.remainingImageBudget.amount).toBe(1);
    expect(result.decisionLog.entries()[0]).toMatchObject({
      policyResult: "accepted",
      stableReason: "inline:accepted",
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

function runWholeProgramInliningForTest(
  input: Omit<RunWholeProgramInliningInput, "freshIds"> & {
    readonly freshIds?: OptIrFreshIdAllocator;
  },
): RunWholeProgramInliningResult {
  return runWholeProgramInliningRawForTest({
    ...input,
    freshIds:
      input.freshIds ??
      createOptIrFreshIdAllocator({ program: input.program, operations: input.operations }),
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

function fixedFreshIds(input: {
  readonly functionIds?: readonly number[];
  readonly blockIds?: readonly number[];
  readonly edgeIds?: readonly number[];
  readonly operationIds?: readonly number[];
  readonly valueIds?: readonly number[];
  readonly regionIds?: readonly number[];
}): OptIrFreshIdAllocator {
  return {
    functionId: nextId(input.functionIds ?? [], optIrFunctionId, "function"),
    blockId: nextId(input.blockIds ?? [], optIrBlockId, "block"),
    edgeId: nextId(input.edgeIds ?? [], optIrEdgeId, "edge"),
    operationId: nextId(input.operationIds ?? [], optIrOperationId, "operation"),
    valueId: nextId(input.valueIds ?? [], optIrValueId, "value"),
    regionId: nextId(input.regionIds ?? [], optIrRegionId, "region"),
  };
}

function nextId<Identifier>(
  values: readonly number[],
  convert: (value: number) => Identifier,
  label: string,
): () => Identifier {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error(`fixed allocator exhausted:${label}:${index}`);
    }
    index += 1;
    return convert(value);
  };
}
