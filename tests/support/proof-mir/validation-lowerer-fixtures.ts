import {
  hirExpressionId,
  hirLocalId,
  hirOriginId,
  hirStatementId,
  resourcePlaceId,
  validationId,
} from "../../../src/hir/ids";
import type { ValidationId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import {
  monoExpressionIdFor,
  monoStatementIdFor,
} from "../../../src/mono/function-instantiator-shell";
import type {
  MonoBlock,
  MonoExpression,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoLocalId,
  MonoMatchArm,
  MonoResourcePlace,
  MonoStatement,
  MonoValidation,
  MonoValidationMatchStatement,
} from "../../../src/mono/mono-hir";
import { createProofMirCallTargetIndex } from "../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../src/proof-mir/draft/draft-builder-context";
import {
  createDraftGraphBuilder,
  type DraftGraphBuilder,
} from "../../../src/proof-mir/draft/draft-graph-builder";
import type { ProofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { createProofMirLocalClassifier } from "../../../src/proof-mir/lower/local-classifier";
import {
  createProofMirLoweringContext,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
} from "../../../src/proof-mir/lower/lowering-context";
import { createProofMirScopePlaceLowerer } from "../../../src/proof-mir/lower/scope-place-lowerer";
import { targetId } from "../../../src/semantic/ids";
import { validatedBufferProofMirLayoutFixture } from "./proof-mir-fixtures";

export interface ValidationLowererFixture {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly validation: MonoValidation;
  readonly bufferInstanceId: MonoInstanceId;
  readonly matchStatement: MonoValidationMatchStatement;
}

export interface ValidationLowererFixtureOptions {
  readonly omitOkArm?: boolean;
  readonly omitErrArm?: boolean;
  readonly omitValidationMetadata?: boolean;
  readonly errBindingName?: string;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
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

function literalExpression(functionInstanceId: MonoInstanceId, ordinal: number): MonoExpression {
  return {
    expressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(ordinal)),
    kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:expr:${ordinal}`,
  };
}

function validationMatchBodyStatement(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly ordinal: number;
  readonly validation: MonoValidation;
  readonly okArm: MonoMatchArm;
  readonly errArm?: MonoMatchArm;
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
        ...(input.errArm === undefined ? {} : { errArm: input.errArm }),
        sourceOrigin: `source:validationMatch:${input.ordinal}`,
      },
    },
    sourceOrigin: `source:stmt:validationMatch:${input.ordinal}`,
  };
}

function buildValidationLoweringContext(input: {
  readonly program: ReturnType<typeof validatedBufferProofMirLayoutFixture>["program"];
  readonly layout: ReturnType<typeof validatedBufferProofMirLayoutFixture>["layout"];
  readonly functionInstance: MonoFunctionInstance;
  readonly body: MonoBlock;
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
}> {
  const functionInstanceId = input.functionInstance.instanceId;
  const originMap = createProofMirOriginMap();
  const classifierResult = createProofMirLocalClassifier({
    functionInstance: input.functionInstance,
  });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }

  const layoutBindingIndex = createProofMirLayoutBindingIndex({
    layout: input.layout,
  });

  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId,
    body: input.body,
    originMap,
    layoutBindingIndex,
  });
  if (scopePlaceLowererResult.kind === "error") {
    return scopePlaceLowererResult;
  }

  const target = {
    targetId: targetId("uefi-aarch64"),
    features: [] as readonly string[],
    runtimeCatalog: {
      targetId: targetId("uefi-aarch64"),
      features: [] as readonly string[],
      get: () => undefined,
      entries: () => [],
    },
  };

  const graph: DraftGraphBuilder = createDraftGraphBuilder({ functionInstanceId });
  const entryOrigin = graph.allocateSyntheticOrigin("entry");
  const blockKey = graph.createBlock({
    role: "entry",
    scope: graph.rootScopeKey(),
    origin: entryOrigin,
  });

  const context = createProofMirLoweringContext({
    program: input.program,
    layout: input.layout,
    target,
    buildContext: createDraftProofMirBuildContext({
      program: input.program,
      layout: input.layout,
      target,
    }),
    functionInstanceId,
    originMap,
    layoutBindingIndex,
    callTargetIndex: createProofMirCallTargetIndex({
      program: input.program,
      layout: input.layout,
      target,
      callerFunctionInstanceId: functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId,
      storageForLocal(monoLocalId) {
        return classifierResult.value.classification().localById(monoLocalId)?.storage;
      },
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
      placeBackedLocals: emptyPlaceBackedLocals,
    },
    scopePlaceLowerer: {
      functionInstanceId,
      lowerMonoPlace(placeInput) {
        const lowered = scopePlaceLowererResult.value.lowerMonoPlace({
          monoPlace: placeInput.monoPlace,
          originKey: placeInput.originKey,
        });
        if (lowered.kind !== "ok") {
          return lowered;
        }
        return { kind: "ok", value: lowered.value.placeKey };
      },
    },
    functionScopePlaceLowerer: scopePlaceLowererResult.value,
    graph,
    ssa: createProofMirGraphSsa({
      functionInstanceId,
      ownerKey: `function:${String(functionInstanceId)}`,
    }),
    effects: createProofMirEffectsResources({ functionInstanceId }),
  });

  return loweringOk({ context, blockKey });
}

export function validationLowererFixture(
  options: ValidationLowererFixtureOptions = {},
): ValidationLowererFixture {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const functionInstanceId = monoInstanceId("fn:validation-test");
  const buffer = layoutFixture.program.validatedBuffers.get(layoutFixture.bufferInstanceId);
  if (buffer === undefined) {
    throw new RangeError("validation lowerer fixture is missing validated buffer metadata.");
  }

  const sourceLocal: MonoLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(1)),
    name: "source",
    type: { kind: "applied", constructor: { kind: "source", typeId: buffer.typeId } } as never,
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
    type: buffer.typeId as never,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "validationArm",
    sourceOrigin: "source:local:packet",
  };
  const errLocal: MonoLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(4)),
    name: options.errBindingName ?? "errorPayload",
    type: { kind: "primitive", name: "unit" } as never,
    resourceKind: "Copy",
    mode: "ordinary",
    introducedBy: "validationArm",
    sourceOrigin: "source:local:error",
  };

  const validationProofId: MonoInstantiatedProofId<ValidationId> = {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: validationId(7),
    instanceId: functionInstanceId,
  };

  const validation: MonoValidation = {
    validationId: validationProofId,
    validationExpressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(11)),
    sourcePlace: monoLocalPlaceFake({ functionInstanceId, local: sourceLocal }),
    pendingResultPlace: monoLocalPlaceFake({ functionInstanceId, local: pendingLocal }),
    validatedBufferTypeId: buffer.typeId,
    okPayloadType: {
      kind: "applied",
      constructor: { kind: "source", typeId: buffer.typeId },
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
    bindingLocals: options.errBindingName === undefined ? [] : [errLocal],
    sourceOrigin: "source:arm:err",
  });

  const matchStatement: MonoValidationMatchStatement = {
    validationMatchId: validationProofId,
    scrutinee: literalExpression(functionInstanceId, 20),
    ...(options.omitValidationMetadata ? {} : { validation }),
    okArm: options.omitOkArm ? undefined : okArm,
    errArm: options.omitErrArm ? undefined : errArm,
    sourceOrigin: "source:validationMatch:7",
  };

  const body: MonoBlock = {
    statements: [
      validationMatchBodyStatement({
        functionInstanceId,
        ordinal: 7,
        validation,
        okArm,
        errArm: options.omitErrArm ? undefined : errArm,
      }),
    ],
    sourceOrigin: "source:function",
  };

  const functionInstance: MonoFunctionInstance = {
    instanceId: functionInstanceId,
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
      modifiers: { isTerminal: false } as never,
      sourceSpan: { start: 0, end: 0 } as never,
    },
    bodyStatus: "sourceBody",
    body,
    bodyIndex: {
      statements: { entries: () => body.statements, get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    locals: {
      entries: () => [sourceLocal, pendingLocal, packetLocal, errLocal],
      get: (localId: MonoLocalId) =>
        [sourceLocal, pendingLocal, packetLocal, errLocal].find(
          (local) => String(local.localId.hirId) === String(localId.hirId),
        ),
    } as never,
    declaredRequirements: [],
    sourceOrigin: "source:function",
    hirSourceOrigin: hirOriginId(0),
  };

  const contextResult = buildValidationLoweringContext({
    program: layoutFixture.program,
    layout: layoutFixture.layout,
    functionInstance,
    body,
  });
  if (contextResult.kind === "error") {
    throw new RangeError(
      `validationLowererFixture failed: ${contextResult.diagnostics.map((diagnostic) => diagnostic.code).join(",")}`,
    );
  }

  return {
    context: contextResult.value.context,
    blockKey: contextResult.value.blockKey,
    validation,
    bufferInstanceId: layoutFixture.bufferInstanceId,
    matchStatement,
  };
}
