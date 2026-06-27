import {
  attemptId,
  brandId,
  hirExpressionId,
  hirLocalId,
  hirOriginId,
  hirStatementId,
  obligationId,
  resourcePlaceId,
  sessionId,
  validationId,
} from "../../../src/hir/ids";
import type { LayoutFactProgram, LayoutFunctionAbiFact } from "../../../src/layout/layout-program";
import { layoutFunctionKeyString } from "../../../src/layout/layout-fact-builder-support";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import {
  monoExpressionIdFor,
  monoStatementIdFor,
} from "../../../src/mono/function-instantiator-shell";
import { buildMonoTable, proofMetadataIdKey } from "../../../src/mono/proof-metadata-tables";
import type {
  MonoAttempt,
  MonoBlock,
  MonoExpression,
  MonoExternalRoot,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoLocalId,
  MonoMatchArm,
  MonoObligation,
  MonoResourcePlace,
  MonoStatement,
  MonoTakeStatement,
  MonoValidation,
  MonomorphizedHirProgram,
} from "../../../src/mono/mono-hir";
import { coreTypeId, functionId } from "../../../src/semantic/ids";
import {
  proofMirBuildInputFromMonoLayout,
  proofMirDefaultLayoutTarget,
  validatedBufferProofMirLayoutFixture,
  type ProofMirBuildInput,
} from "./proof-mir-fixtures";

const FIXTURE_SOURCE_ORIGIN = "proof-mir-integration-fixture";

function minimalLayoutFunctionAbiFact(functionInstanceId: MonoInstanceId): LayoutFunctionAbiFact {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
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
      sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function withExtraFunctionAbiFacts(
  layout: LayoutFactProgram,
  extraFunctionIds: readonly MonoInstanceId[],
): LayoutFactProgram {
  const mergedFacts = [...layout.functions.entries()];
  for (const functionInstanceId of extraFunctionIds) {
    if (layout.functions.has(functionInstanceId)) {
      continue;
    }
    mergedFacts.push(minimalLayoutFunctionAbiFact(functionInstanceId));
  }
  return {
    ...layout,
    functions: layoutDeterministicTable({
      entries: mergedFacts,
      keyOf: (entry) => entry.functionInstanceId,
      keyString: layoutFunctionKeyString,
    }),
  };
}

function withImageEntryFunction(
  layout: LayoutFactProgram,
  entryFunctionInstanceId: MonoInstanceId,
): LayoutFactProgram {
  return {
    ...layout,
    imageEntry: {
      ...layout.imageEntry,
      entryFunctionInstanceId,
    },
  };
}

function mergeProgramWithEntryFunction(input: {
  readonly program: MonomorphizedHirProgram;
  readonly entryFunction: MonoFunctionInstance;
}): MonomorphizedHirProgram {
  const functions = [
    ...input.program.functions
      .entries()
      .filter((functionInstance) => functionInstance.instanceId !== input.entryFunction.instanceId),
    input.entryFunction,
  ];
  const externalRoots: readonly MonoExternalRoot[] = [
    {
      functionInstanceId: input.entryFunction.instanceId,
      reason: "imageEntry",
      origin: hirOriginId(1),
    },
  ];
  return {
    ...input.program,
    image: {
      ...input.program.image,
      entryFunctionInstanceId: input.entryFunction.instanceId,
    },
    externalRoots,
    functions: {
      entries: () => functions,
      get: (instanceId) =>
        functions.find((functionInstance) => functionInstance.instanceId === instanceId),
    },
  };
}

function monoLocalPlaceFake(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly local: MonoLocal;
}): MonoResourcePlace {
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.functionInstanceId },
      hirId: resourcePlaceId(Number(String(input.local.localId.hirId))),
      instanceId: input.functionInstanceId,
    },
    canonicalKey: `function:${String(input.functionInstanceId)}/local:${input.local.name}`,
    root: { kind: "local", localId: input.local.localId },
    projection: [],
    type: input.local.type,
    resourceKind: input.local.resourceKind,
    sourceOrigin: input.local.sourceOrigin,
    kind: "local",
    localId: input.local.localId,
  };
}

function assignmentStatement(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly target: MonoLocal;
  readonly value: MonoLocal;
}): MonoStatement {
  return {
    statementId: monoStatementIdFor(input.functionInstanceId, hirStatementId(input.ordinal)),
    kind: {
      kind: "assignment",
      statement: {
        target: nameExpression(input.functionInstanceId, input.target),
        value: nameExpression(input.functionInstanceId, input.value),
        targetPlace: monoLocalPlaceFake({
          functionInstanceId: input.functionInstanceId,
          local: input.target,
        }),
      },
    },
    sourceOrigin: `source:stmt:assign:${input.ordinal}`,
  };
}

function literalExpression(functionInstanceId: MonoInstanceId, ordinal: number): MonoExpression {
  return {
    expressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(ordinal)),
    kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:expr:${ordinal}`,
  };
}

function matchArm(input: {
  readonly patternText: string;
  readonly body: readonly MonoStatement[];
  readonly bindingLocals: readonly MonoLocal[];
  readonly sourceOrigin: string;
}): MonoMatchArm {
  return {
    patternText: input.patternText,
    body: { statements: input.body, sourceOrigin: input.sourceOrigin },
    bindingLocals: input.bindingLocals,
    sourceOrigin: input.sourceOrigin,
  };
}

function attemptExpressionStatement(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly attempt: MonoAttempt;
}): MonoStatement {
  return {
    statementId: monoStatementIdFor(input.functionInstanceId, hirStatementId(input.ordinal)),
    kind: {
      kind: "expression",
      expression: {
        expressionId: input.attempt.attemptExpressionId,
        kind: { kind: "attempt", attempt: input.attempt },
        type: { kind: "primitive", name: "u8" } as never,
        resourceKind: "Copy",
        sourceOrigin: input.attempt.sourceOrigin,
      },
    },
    sourceOrigin: `source:stmt:attempt:${input.ordinal}`,
  };
}

function validationMatchBodyStatement(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly validation: MonoValidation;
  readonly okArm: MonoMatchArm;
  readonly errArm: MonoMatchArm;
}): MonoStatement {
  return {
    statementId: monoStatementIdFor(input.functionInstanceId, hirStatementId(input.ordinal)),
    kind: {
      kind: "validationMatch",
      statement: {
        validationMatchId: input.validation.validationId,
        scrutinee: literalExpression(input.functionInstanceId, input.ordinal * 10),
        validation: input.validation,
        okArm: input.okArm,
        errArm: input.errArm,
        sourceOrigin: `source:validationMatch:${input.ordinal}`,
      },
    },
    sourceOrigin: `source:stmt:validationMatch:${input.ordinal}`,
  };
}

function scalarCopyLocal(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly name: string;
}): MonoLocal {
  const localId = instantiatedHirId(input.functionInstanceId, hirLocalId(input.ordinal));
  return {
    localId,
    name: input.name,
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: `source:local:${input.name}`,
  };
}

function placeBackedLocal(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly name: string;
}): MonoLocal {
  const localId = instantiatedHirId(input.functionInstanceId, hirLocalId(input.ordinal));
  return {
    localId,
    name: input.name,
    type: {
      kind: "applied",
      constructor: { kind: "source", typeId: 1 as never },
      arguments: [],
      resourceKind: { kind: "concrete", value: "Affine" },
    } as never,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: `source:local:${input.name}`,
  };
}

function nameExpression(functionInstanceId: MonoInstanceId, local: MonoLocal): MonoExpression {
  return {
    expressionId: monoExpressionIdFor(
      functionInstanceId,
      hirExpressionId(Number(String(local.localId.hirId))),
    ),
    kind: { kind: "name", name: local.name, localId: local.localId },
    type: local.type,
    resourceKind: local.resourceKind,
    sourceOrigin: local.sourceOrigin,
  };
}

function streamTakeStatement(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly operandLocal: MonoLocal;
  readonly body: readonly MonoStatement[];
}): MonoTakeStatement {
  const sessionProofId: MonoInstantiatedProofId<ReturnType<typeof sessionId>> = {
    owner: { kind: "function", instanceId: input.functionInstanceId },
    hirId: sessionId(1),
    instanceId: input.functionInstanceId,
  };
  const brandProofId: MonoInstantiatedProofId<ReturnType<typeof brandId>> = {
    owner: { kind: "function", instanceId: input.functionInstanceId },
    hirId: brandId(2),
    instanceId: input.functionInstanceId,
  };
  const closureObligationId: MonoInstantiatedProofId<ReturnType<typeof obligationId>> = {
    owner: { kind: "function", instanceId: input.functionInstanceId },
    hirId: obligationId(3),
    instanceId: input.functionInstanceId,
  };
  return {
    operand: {
      kind: "place",
      place: monoLocalPlaceFake({
        functionInstanceId: input.functionInstanceId,
        local: input.operandLocal,
      }),
      expression: nameExpression(input.functionInstanceId, input.operandLocal),
    },
    takeKind: {
      kind: "stream",
      sessionId: sessionProofId,
      itemBrandId: brandProofId,
      closureObligationId,
      itemType: { kind: "core", coreTypeId: "u8" } as never,
      itemResourceKind: "Affine",
    },
    body: {
      statements: input.body,
      sourceOrigin: `source:take-body:${input.ordinal}`,
    },
    sourceOrigin: `source:take:${input.ordinal}`,
  };
}

function streamClosureObligation(
  obligationProofId: MonoInstantiatedProofId<ReturnType<typeof obligationId>>,
): MonoObligation {
  return {
    obligationId: obligationProofId,
    kind: "streamClosure",
    sourceOrigin: `source:obligation:${String(obligationProofId.hirId)}`,
  };
}

function functionInstanceShell(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
  readonly locals: readonly MonoLocal[];
  readonly isTerminal?: boolean;
}): MonoFunctionInstance {
  return {
    instanceId: input.functionInstanceId,
    sourceFunctionId: 1 as never,
    sourceItemId: 1 as never,
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: 1 as never,
      itemId: 1 as never,
      parameters: [],
      returnType: { kind: "primitive", name: "unit" } as never,
      returnKind: "Copy",
      modifiers: { isTerminal: input.isTerminal ?? false } as never,
      sourceSpan: { start: 0, end: 0 } as never,
    },
    bodyStatus: "sourceBody",
    body: input.body,
    bodyIndex: {
      statements: { entries: () => input.body.statements, get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    locals: {
      entries: () => input.locals,
      get: (localId: MonoLocalId) =>
        input.locals.find((local) => String(local.localId.hirId) === String(localId.hirId)),
    } as never,
    declaredRequirements: [],
    sourceOrigin: "source:function",
  };
}

export function validationAttemptProofMirFixture(): ProofMirBuildInput {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const validationFunctionId = monoInstanceId("fn:validation-integration");
  const attemptFunctionId = monoInstanceId("fn:attempt-integration");
  const buffer = layoutFixture.program.validatedBuffers.get(layoutFixture.bufferInstanceId);
  if (buffer === undefined) {
    throw new RangeError("validation attempt fixture is missing validated buffer metadata.");
  }

  const validationFunction = buildValidationIntegrationFunction({
    functionInstanceId: validationFunctionId,
    bufferTypeId: buffer.typeId,
  });
  const attemptFunction = buildAttemptIntegrationFunction({
    functionInstanceId: attemptFunctionId,
  });

  const functions = [
    ...layoutFixture.program.functions
      .entries()
      .filter(
        (functionInstance) =>
          functionInstance.instanceId !== validationFunctionId &&
          functionInstance.instanceId !== attemptFunctionId,
      ),
    validationFunction,
    attemptFunction,
  ];
  const program: MonomorphizedHirProgram = {
    ...layoutFixture.program,
    image: {
      ...layoutFixture.program.image,
      entryFunctionInstanceId: validationFunctionId,
    },
    externalRoots: [
      {
        functionInstanceId: validationFunctionId,
        reason: "imageEntry",
        origin: hirOriginId(1),
      },
      {
        functionInstanceId: attemptFunctionId,
        reason: "targetRequired",
        origin: hirOriginId(2),
      },
    ],
    functions: {
      entries: () => functions,
      get: (instanceId) =>
        functions.find((functionInstance) => functionInstance.instanceId === instanceId),
    },
  };
  const layout = withImageEntryFunction(
    withExtraFunctionAbiFacts(layoutFixture.layout, [validationFunctionId, attemptFunctionId]),
    validationFunctionId,
  );
  const layoutTarget = proofMirDefaultLayoutTarget();
  return proofMirBuildInputFromMonoLayout({
    program,
    layout,
    layoutTarget,
  });
}

function buildValidationIntegrationFunction(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bufferTypeId: import("../../../src/semantic/ids").TypeId;
}): MonoFunctionInstance {
  const { functionInstanceId } = input;
  const sourceLocal: MonoLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(1)),
    name: "source",
    type: { kind: "applied", constructor: { kind: "source", typeId: input.bufferTypeId } } as never,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: "source:local:source",
  };
  const pendingLocal: MonoLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(2)),
    name: "validation",
    type: { kind: "primitive", name: "unit" } as never,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: "source:local:validation",
  };
  const packetLocal: MonoLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(3)),
    name: "packet",
    type: input.bufferTypeId as never,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "validationArm",
    sourceOrigin: "source:local:packet",
  };
  const errLocal: MonoLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(4)),
    name: "errorPayload",
    type: { kind: "primitive", name: "unit" } as never,
    resourceKind: "Copy",
    mode: "ordinary",
    introducedBy: "validationArm",
    sourceOrigin: "source:local:error",
  };

  const validationProofId: MonoInstantiatedProofId<ReturnType<typeof validationId>> = {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: validationId(7),
    instanceId: functionInstanceId,
  };
  const validation: MonoValidation = {
    validationId: validationProofId,
    validationExpressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(11)),
    sourcePlace: monoLocalPlaceFake({ functionInstanceId, local: sourceLocal }),
    pendingResultPlace: monoLocalPlaceFake({ functionInstanceId, local: pendingLocal }),
    validatedBufferTypeId: input.bufferTypeId,
    okPayloadType: {
      kind: "applied",
      constructor: { kind: "source", typeId: input.bufferTypeId },
    } as never,
    errPayloadType: { kind: "primitive", name: "unit" } as never,
    sourceOrigin: "source:validation:7",
  };

  const okArm = matchArm({
    patternText: "ok",
    body: [],
    bindingLocals: [packetLocal],
    sourceOrigin: "source:arm:ok",
  });
  const errArm = matchArm({
    patternText: "err",
    body: [],
    bindingLocals: [errLocal],
    sourceOrigin: "source:arm:err",
  });

  const body: MonoBlock = {
    statements: [
      validationMatchBodyStatement({
        functionInstanceId,
        ordinal: 7,
        validation,
        okArm,
        errArm,
      }),
    ],
    sourceOrigin: "source:function",
  };

  return functionInstanceShell({
    functionInstanceId,
    body,
    locals: [sourceLocal, pendingLocal, packetLocal, errLocal],
  });
}

function buildAttemptIntegrationFunction(input: {
  readonly functionInstanceId: MonoInstanceId;
}): MonoFunctionInstance {
  const { functionInstanceId } = input;
  const attempt: MonoAttempt = {
    attemptId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: attemptId(8),
      instanceId: functionInstanceId,
    },
    attemptExpressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(80)),
    fallibleExpression: literalExpression(functionInstanceId, 8),
    declaredInputPlaces: [],
    sourceOrigin: "source:attempt:8",
  };

  const body: MonoBlock = {
    statements: [attemptExpressionStatement({ functionInstanceId, ordinal: 8, attempt })],
    sourceOrigin: "source:function",
  };

  return functionInstanceShell({
    functionInstanceId,
    body,
    locals: [],
  });
}

export function resourceOperationProofMirFixture(): ProofMirBuildInput {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const functionInstanceId = monoInstanceId("fn:resource-operation-integration");
  const handleLocal = placeBackedLocal({ functionInstanceId, ordinal: 1, name: "handle" });
  const scratchLocal = placeBackedLocal({ functionInstanceId, ordinal: 2, name: "scratch" });
  const readLocal = scalarCopyLocal({ functionInstanceId, ordinal: 4, name: "read" });

  const closureObligationId: MonoInstantiatedProofId<ReturnType<typeof obligationId>> = {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: obligationId(3),
    instanceId: functionInstanceId,
  };

  const takeStatement = streamTakeStatement({
    functionInstanceId,
    ordinal: 5,
    operandLocal: handleLocal,
    body: [],
  });

  const body: MonoBlock = {
    statements: [
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(10)),
        kind: {
          kind: "let",
          statement: {
            local: handleLocal,
            value: literalExpression(functionInstanceId, 10),
          },
        },
        sourceOrigin: "source:stmt:let:10",
      },
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(11)),
        kind: {
          kind: "let",
          statement: {
            local: readLocal,
            value: nameExpression(functionInstanceId, handleLocal),
          },
        },
        sourceOrigin: "source:stmt:let:11",
      },
      assignmentStatement({
        functionInstanceId,
        ordinal: 12,
        target: scratchLocal,
        value: handleLocal,
      }),
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(13)),
        kind: { kind: "take", statement: takeStatement },
        sourceOrigin: "source:stmt:take:13",
      },
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(14)),
        kind: {
          kind: "return",
        },
        sourceOrigin: "source:stmt:return:14",
      },
    ],
    sourceOrigin: "source:function",
  };

  const functionInstance = functionInstanceShell({
    functionInstanceId,
    body,
    locals: [handleLocal, scratchLocal, readLocal],
  });

  const obligation = streamClosureObligation(closureObligationId);
  const program = mergeProgramWithEntryFunction({
    program: {
      ...layoutFixture.program,
      proofMetadata: {
        ...layoutFixture.program.proofMetadata,
        obligations: buildMonoTable(
          [obligation],
          (entry) => proofMetadataIdKey(entry.obligationId),
          (id) => proofMetadataIdKey(id),
        ),
      },
    },
    entryFunction: functionInstance,
  });
  const layout = withImageEntryFunction(
    withExtraFunctionAbiFacts(layoutFixture.layout, [functionInstanceId]),
    functionInstanceId,
  );
  const layoutTarget = proofMirDefaultLayoutTarget();
  return proofMirBuildInputFromMonoLayout({
    program,
    layout,
    layoutTarget,
  });
}

export function panicExitProofMirFixture(): ProofMirBuildInput {
  const closedLayout = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const functionInstanceId = monoInstanceId("fn:panic-exit-integration");
  const body: MonoBlock = {
    statements: [
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(1)),
        kind: {
          kind: "error",
          reason: "reachable-mono-error",
        },
        sourceOrigin: "source:stmt:error:1",
      },
    ],
    sourceOrigin: "source:function",
  };
  const functionInstance = functionInstanceShell({
    functionInstanceId,
    body,
    locals: [],
  });
  const program = mergeProgramWithEntryFunction({
    program: closedLayout.program,
    entryFunction: functionInstance,
  });
  const layout = withImageEntryFunction(
    withExtraFunctionAbiFacts(closedLayout.layout, [functionInstanceId]),
    functionInstanceId,
  );
  return proofMirBuildInputFromMonoLayout({
    program,
    layout,
    layoutTarget: proofMirDefaultLayoutTarget(),
  });
}

export function terminalResourceProofMirFixture(): ProofMirBuildInput {
  const closedLayout = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const functionInstanceId = monoInstanceId("fn:terminal-resource-integration");
  const body: MonoBlock = {
    statements: [
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(1)),
        kind: {
          kind: "return",
          expression: literalExpression(functionInstanceId, 1),
        },
        sourceOrigin: "source:stmt:return:1",
      },
    ],
    sourceOrigin: "source:function",
  };
  const functionInstance = functionInstanceShell({
    functionInstanceId,
    body,
    locals: [],
    isTerminal: true,
  });
  const program = mergeProgramWithEntryFunction({
    program: closedLayout.program,
    entryFunction: functionInstance,
  });
  const layout = withImageEntryFunction(
    withExtraFunctionAbiFacts(closedLayout.layout, [functionInstanceId]),
    functionInstanceId,
  );
  return proofMirBuildInputFromMonoLayout({
    program,
    layout,
    layoutTarget: proofMirDefaultLayoutTarget(),
  });
}
