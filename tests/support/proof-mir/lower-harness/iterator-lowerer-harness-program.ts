import { brandId, hirOriginId, obligationId, sessionId } from "../../../../src/hir/ids";
import type {
  LayoutFactProgram,
  LayoutFunctionAbiFact,
} from "../../../../src/layout/layout-program";
import {
  emptyFunctionAbiTable,
  emptyPlatformAbiTable,
} from "../../../../src/layout/layout-fact-builder-support";
import { type MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoCallExpression,
  MonoCallSiteRequirement,
  MonoCheckedType,
  MonoExpressionId,
  MonoForIteration,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoLocalId,
  MonoObligation,
  MonomorphizedHirProgram,
} from "../../../../src/mono/mono-hir";
import { buildMonoTable, proofMetadataIdKey } from "../../../../src/mono/proof-metadata-tables";
import { emptyMonoResolvedCallTargetTable } from "../../../../src/mono/resolved-call-targets";
import { coreTypeId, functionId, itemId, targetId } from "../../../../src/semantic/ids";
import type { ConcreteResourceKind } from "../../../../src/semantic/surface/resource-kind";
import { SourceSpan } from "../../../../src/shared/source-span";
import { proofMirRuntimeCallId, proofMirRuntimeOperationId } from "../../../../src/proof-mir/ids";
import { expressionIdFor, scalarType } from "./iterator-lowerer-harness-bindings";

export function functionInstanceForIteratorLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly locals: readonly MonoLocal[];
  readonly body: MonoBlock;
}): MonoFunctionInstance {
  const sourceFunctionId = functionId(1);
  const sourceItemId = itemId(1);
  return {
    instanceId: input.functionInstanceId,
    sourceFunctionId,
    sourceItemId,
    ownerTypeArguments: [],
    functionTypeArguments: [],
    locals: {
      entries: () => input.locals,
      get: (localId: MonoLocalId) => input.locals.find((local) => local.localId === localId),
    },
    body: input.body,
    bodyIndex: {
      statements: { entries: () => input.body.statements, get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    bodyStatus: "sourceBody",
    signature: {
      functionId: sourceFunctionId,
      itemId: sourceItemId,
      modifiers: {
        isTerminal: false,
        isPlatform: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      parameters: [],
      returnType: neverTypeForIteratorLowererTest(),
      returnKind: "Never",
      sourceSpan: SourceSpan.from(0, 0),
    },
    declaredRequirements: [],
    sourceOrigin: "source:test",
    hirSourceOrigin: hirOriginId(0),
  };
}

function neverTypeForIteratorLowererTest(): MonoCheckedType {
  return { kind: "core", coreTypeId: coreTypeId("Never") } as MonoCheckedType;
}

export function emptyProgramForIteratorLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly nextFunctionInstanceId: MonoInstanceId;
  readonly iterableFunctionInstanceId: MonoInstanceId;
  readonly iteratorObligation: MonoObligation;
  readonly callSiteRequirements?: readonly MonoCallSiteRequirement[];
}): MonomorphizedHirProgram {
  const functionEntries = [
    functionInstanceForIteratorLowererTest({
      functionInstanceId: input.functionInstanceId,
      locals: [],
      body: { statements: [], sourceOrigin: "source:body" },
    }),
    functionInstanceForIteratorLowererTest({
      functionInstanceId: input.nextFunctionInstanceId,
      locals: [],
      body: { statements: [], sourceOrigin: "source:body" },
    }),
    functionInstanceForIteratorLowererTest({
      functionInstanceId: input.iterableFunctionInstanceId,
      locals: [],
      body: { statements: [], sourceOrigin: "source:body" },
    }),
  ];
  return {
    functions: {
      entries: () => functionEntries,
      get: (instanceId: MonoInstanceId) => {
        if (instanceId === input.functionInstanceId) {
          return functionEntries[0];
        }
        if (instanceId === input.nextFunctionInstanceId) {
          return functionEntries[1];
        }
        if (instanceId === input.iterableFunctionInstanceId) {
          return functionEntries[2];
        }
        return undefined;
      },
    },
    proofMetadata: {
      obligations: buildMonoTable(
        [input.iteratorObligation],
        (entry) => proofMetadataIdKey(entry.obligationId),
        proofMetadataIdKey,
      ),
      callSiteRequirements: buildMonoTable(
        input.callSiteRequirements ?? [],
        (entry) => proofMetadataIdKey(entry.callSiteRequirementId),
        proofMetadataIdKey,
      ),
      platformContractEdges: buildMonoTable([] as const, (_entry: never) => "", proofMetadataIdKey),
    },
    resolvedCallTargets: emptyMonoResolvedCallTargetTable(),
  } as unknown as MonomorphizedHirProgram;
}

function minimalFunctionAbiFact(functionInstanceId: MonoInstanceId): LayoutFunctionAbiFact {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: "source:test",
  };
  return {
    functionInstanceId,
    sourceFunctionId: functionId(1),
    hiddenParameters: [],
    parameters: [],
    returnValue: {
      type: neverLayout.key,
      layout: neverLayout,
      shape: { kind: "none", reason: "never", proofCarrying: false },
      sourceOrigin: "source:test",
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: "source:test",
  };
}

export function layoutForIteratorLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly nextFunctionInstanceId: MonoInstanceId;
  readonly iterableFunctionInstanceId: MonoInstanceId;
}): LayoutFactProgram {
  const functionFacts = [
    minimalFunctionAbiFact(input.functionInstanceId),
    minimalFunctionAbiFact(input.nextFunctionInstanceId),
    minimalFunctionAbiFact(input.iterableFunctionInstanceId),
  ];
  return {
    targetId: targetId("x64-test"),
    types: emptyFunctionAbiTable() as never,
    fields: emptyFunctionAbiTable() as never,
    functions: {
      get: (key: MonoInstanceId) => functionFacts.find((fact) => fact.functionInstanceId === key),
      has: (key: MonoInstanceId) => functionFacts.some((fact) => fact.functionInstanceId === key),
      entries: () => functionFacts,
      keyString: (key: MonoInstanceId) => String(key) as never,
    },
    platformAbis: emptyPlatformAbiTable(),
    imageDevices: emptyFunctionAbiTable() as never,
    validatedBuffers: emptyFunctionAbiTable() as never,
  } as unknown as LayoutFactProgram;
}

interface IteratorLoweringMetadata {
  readonly nextCall: MonoCallExpression;
  readonly nextExpressionId: MonoExpressionId;
  readonly finishExpressionId: MonoExpressionId;
  readonly nextResultType: MonoCheckedType;
  readonly nextResultResourceKind: ConcreteResourceKind;
  readonly finishResultType: MonoCheckedType;
  readonly finishResultResourceKind: ConcreteResourceKind;
  readonly iteratorObligationId?: MonoInstantiatedProofId<ReturnType<typeof obligationId>>;
  readonly finishRuntimeCallId: ReturnType<typeof proofMirRuntimeCallId>;
  readonly finishRuntimeOperationId: ReturnType<typeof proofMirRuntimeOperationId>;
}

export function iteratorMetadataForTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly nextFunctionInstanceId: MonoInstanceId;
  readonly iteratorObligationId: MonoInstantiatedProofId<ReturnType<typeof obligationId>>;
}): IteratorLoweringMetadata {
  const nextExpressionId = expressionIdFor(input.functionInstanceId, 100);
  return {
    nextCall: {
      callee: {
        expressionId: expressionIdFor(input.functionInstanceId, 101),
        kind: { kind: "name", name: "next" },
        type: scalarType(),
        resourceKind: "Copy",
        sourceOrigin: "source:iterator:next",
      },
      ownerTypeArguments: [],
      ownerTypeArgumentSource: "none",
      arguments: [],
      typeArguments: [],
      resolvedTarget: {
        kind: "sourceFunction",
        targetFunctionInstanceId: input.nextFunctionInstanceId,
      },
      sourceOrigin: "source:iterator:next",
    },
    nextExpressionId,
    finishExpressionId: expressionIdFor(input.functionInstanceId, 102),
    nextResultType: scalarType(),
    nextResultResourceKind: "Copy",
    finishResultType: scalarType(),
    finishResultResourceKind: "Copy",
    iteratorObligationId: input.iteratorObligationId,
    finishRuntimeCallId: proofMirRuntimeCallId(1),
    finishRuntimeOperationId: proofMirRuntimeOperationId(1),
  };
}

export function streamIterationForTest(
  functionInstanceId: MonoInstanceId,
): Extract<MonoForIteration, { readonly kind: "stream" }> {
  return {
    kind: "stream",
    sessionId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: sessionId(1),
      instanceId: functionInstanceId,
    },
    itemBrandId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: brandId(1),
      instanceId: functionInstanceId,
    },
    closureObligationId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: obligationId(1),
      instanceId: functionInstanceId,
    },
    itemType: scalarType(),
    itemResourceKind: "Affine",
  };
}
