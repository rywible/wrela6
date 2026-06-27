import {
  callSiteRequirementId,
  hirOriginId,
  hirRequirementId,
  obligationId,
} from "../../../../src/hir/ids";
import { monoInstanceId } from "../../../../src/mono/ids";
import { monoResolvedCallTargetTableFromEntries } from "../../../../src/mono/resolved-call-targets";
import type { MonoBlock, MonoForStatement, MonoStatement } from "../../../../src/mono/mono-hir";
import {
  buildExpressionForIteratorLowererTest,
  collectIteratorLowererBindings,
  expressionIdFor,
  statementIdFor,
} from "./iterator-lowerer-harness-bindings";
import {
  emptyProgramForIteratorLowererTest,
  functionInstanceForIteratorLowererTest,
  layoutForIteratorLowererTest,
  streamIterationForTest,
} from "./iterator-lowerer-harness-program";
import type { OrdinaryIteratorProtocolProofMirBuildInputParts } from "./iterator-lowerer-harness-types";

export function ordinaryIteratorProtocolProofMirBuildInputParts(): OrdinaryIteratorProtocolProofMirBuildInputParts {
  const functionInstanceId = monoInstanceId("fn:iterator-protocol");
  const nextFunctionInstanceId = monoInstanceId("fn:iterator-next");
  const iterableFunctionInstanceId = monoInstanceId("fn:packet-bytes");
  const bindings = collectIteratorLowererBindings({
    functionInstanceId,
    scalarLocalNames: [],
    placeBackedLocalNames: ["packet"],
    bindingName: "byte",
  });
  const iterable = buildExpressionForIteratorLowererTest({
    functionInstanceId,
    bindings,
    expressionText: "packet.bytes()",
    expressionIds: { next: () => expressionIdFor(functionInstanceId, 2) },
  });
  const forStatement: MonoForStatement = {
    binding: bindings.localsByName.get("byte")!,
    iterable,
    iteration: { kind: "ordinary" },
    body: { statements: [], sourceOrigin: "source:block:for-body" },
  };
  const monoStatement: MonoStatement = {
    statementId: statementIdFor(functionInstanceId, 1),
    kind: { kind: "for", statement: forStatement },
    sourceOrigin: "source:stmt:for",
  };
  const body: MonoBlock = {
    statements: [monoStatement],
    sourceOrigin: "source:function:body",
  };
  const iteratorObligationId = {
    owner: { kind: "function" as const, instanceId: functionInstanceId },
    hirId: obligationId(42),
    instanceId: functionInstanceId,
  };
  const nextExpressionId = expressionIdFor(functionInstanceId, 100);
  const program = emptyProgramForIteratorLowererTest({
    functionInstanceId,
    nextFunctionInstanceId,
    iterableFunctionInstanceId,
    iteratorObligation: {
      obligationId: iteratorObligationId,
      kind: "callRequirement",
      sourceOrigin: "source:obligation:iterator",
    },
    callSiteRequirements: [
      {
        callSiteRequirementId: {
          owner: { kind: "function", instanceId: functionInstanceId },
          hirId: callSiteRequirementId(1),
          instanceId: functionInstanceId,
        },
        callExpressionId: expressionIdFor(functionInstanceId, 2),
        requirement: {
          requirementId: {
            owner: { kind: "function", instanceId: functionInstanceId },
            hirId: hirRequirementId(1),
            instanceId: functionInstanceId,
          },
          owner: { kind: "function", functionInstanceId: functionInstanceId },
          expression: { kind: "opaque", text: "iterator-open" },
          sourceOrigin: "source:requirement:iterator",
        },
        sourceOrigin: "source:call-site:iterator",
      },
      {
        callSiteRequirementId: {
          owner: { kind: "function", instanceId: functionInstanceId },
          hirId: callSiteRequirementId(2),
          instanceId: functionInstanceId,
        },
        callExpressionId: nextExpressionId,
        requirement: {
          requirementId: {
            owner: { kind: "function", instanceId: functionInstanceId },
            hirId: hirRequirementId(2),
            instanceId: functionInstanceId,
          },
          owner: { kind: "function", functionInstanceId: functionInstanceId },
          expression: {
            kind: "opaque",
            text: `iterator-next:${String(nextFunctionInstanceId)}`,
          },
          sourceOrigin: "source:requirement:iterator-next",
        },
        sourceOrigin: "source:call-site:iterator-next",
      },
    ],
  });
  const iteratorFunction = functionInstanceForIteratorLowererTest({
    functionInstanceId,
    locals: bindings.locals,
    body,
  });
  const functions = program.functions
    .entries()
    .map((functionInstance) =>
      functionInstance.instanceId === functionInstanceId ? iteratorFunction : functionInstance,
    );
  return {
    program: {
      ...program,
      functions: {
        entries: () => functions,
        get: (instanceId) =>
          functions.find((functionInstance) => functionInstance.instanceId === instanceId),
      },
      externalRoots: [
        {
          functionInstanceId,
          reason: "targetRequired",
          origin: hirOriginId(1),
        },
      ],
      resolvedCallTargets: monoResolvedCallTargetTableFromEntries([
        {
          callerInstanceId: functionInstanceId,
          callExpressionId: expressionIdFor(functionInstanceId, 2),
          resolvedTarget: {
            kind: "sourceFunction",
            targetFunctionInstanceId: iterableFunctionInstanceId,
          },
        },
        {
          callerInstanceId: functionInstanceId,
          callExpressionId: nextExpressionId,
          resolvedTarget: {
            kind: "sourceFunction",
            targetFunctionInstanceId: nextFunctionInstanceId,
          },
        },
      ]),
    },
    layout: layoutForIteratorLowererTest({
      functionInstanceId,
      nextFunctionInstanceId,
      iterableFunctionInstanceId,
    }),
  };
}

export function streamForLoopProofMirBuildInputParts(): OrdinaryIteratorProtocolProofMirBuildInputParts {
  const ordinary = ordinaryIteratorProtocolProofMirBuildInputParts();
  const functionInstanceId = monoInstanceId("fn:iterator-protocol");
  const iteratorFunction = ordinary.program.functions.get(functionInstanceId);
  if (iteratorFunction?.body === undefined) {
    throw new Error("expected iterator protocol function body");
  }
  const forStatement = iteratorFunction.body.statements[0];
  if (forStatement?.kind.kind !== "for") {
    throw new Error("expected stream-for statement");
  }
  const streamForStatement: MonoStatement = {
    ...forStatement,
    kind: {
      kind: "for",
      statement: {
        ...forStatement.kind.statement,
        iteration: streamIterationForTest(functionInstanceId),
      },
    },
  };
  const updatedFunction = {
    ...iteratorFunction,
    body: {
      ...iteratorFunction.body,
      statements: [streamForStatement],
    },
  };
  const functions = ordinary.program.functions
    .entries()
    .map((functionInstance) =>
      functionInstance.instanceId === functionInstanceId ? updatedFunction : functionInstance,
    );
  return {
    program: {
      ...ordinary.program,
      functions: {
        entries: () => functions,
        get: (instanceId) =>
          functions.find((functionInstance) => functionInstance.instanceId === instanceId),
      },
    },
    layout: ordinary.layout,
  };
}
