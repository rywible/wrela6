import { hirStatementId } from "../../hir/ids";
import type { ValidationId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import { instantiatedHirId, instantiatedHirIdKey } from "../../mono/ids";
import type {
  MonoInstantiatedProofId,
  MonoLocal,
  MonoResourcePlace,
  MonoStatementId,
  MonoValidation,
  MonoValidationMatchStatement,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import type { TypeId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { draftLocalKey } from "../draft/draft-keys";
import {
  proofMirOriginId,
  proofMirPlaceId,
  proofMirStatementId,
  proofMirValueId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirStatementId,
  type ProofMirValueId,
} from "../ids";
import type { DraftProofMirLayoutTermReference } from "../draft/draft-layout-term-reference";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermReference,
} from "../model/layout-bindings";
import type {
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirStatementKind,
  DraftProofMirValidationStart,
} from "../draft/draft-statement";
import type { ProofMirProducedOperand, ProofMirValidationArmBinding } from "../model/operands";
import {
  type DraftGraphEdgeView,
  type DraftGraphTerminator,
  type DraftGraphValidationArmBinding,
} from "../draft/draft-graph-builder";

import { setEmptyArmUnreachableTerminator } from "./empty-arm-terminator";
import {
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirValidationLoweringInput,
  type ProofMirValidationLowerer,
} from "./lowering-context";

interface RecordedProofMirStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

interface ValidationLoweringIdAllocator {
  valueForKey(key: ProofMirCanonicalKey): ProofMirValueId;
  placeForKey(key: ProofMirCanonicalKey): ProofMirPlaceId;
  nextStatementId(): ProofMirStatementId;
  nextOrigin(): ProofMirOriginId;
}

interface LoweredValidationPlaces {
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly pendingResultPlaceKey: ProofMirCanonicalKey;
  readonly okPacketPlaceKey: ProofMirCanonicalKey;
  readonly okPayloadPlaceKey?: ProofMirCanonicalKey;
  readonly errPayloadPlaceKey?: ProofMirCanonicalKey;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function createValidationLoweringIdAllocator(): ValidationLoweringIdAllocator {
  let nextValue = 0;
  let nextPlace = 0;
  let nextStatement = 0;
  let nextOrigin = 1;
  const valueKeys = new Map<ProofMirCanonicalKey, ProofMirValueId>();
  const placeKeys = new Map<ProofMirCanonicalKey, ProofMirPlaceId>();

  return {
    valueForKey(key) {
      const existing = valueKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirValueId(nextValue++);
      valueKeys.set(key, id);
      return id;
    },
    placeForKey(key) {
      const existing = placeKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirPlaceId(nextPlace++);
      placeKeys.set(key, id);
      return id;
    },
    nextStatementId() {
      return proofMirStatementId(nextStatement++);
    },
    nextOrigin() {
      return proofMirOriginId(nextOrigin++);
    },
  };
}

function resolveValidatedBufferInstanceId(
  program: MonomorphizedHirProgram,
  validatedBufferTypeId: TypeId,
): MonoInstanceId | undefined {
  for (const buffer of program.validatedBuffers.entries()) {
    if (buffer.typeId === validatedBufferTypeId) {
      return buffer.instanceId;
    }
  }
  return undefined;
}

function lowerMonoPlaceKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly monoPlace: MonoResourcePlace;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  return input.context.scopePlaceLowerer.lowerMonoPlace({
    context: input.context,
    monoPlace: input.monoPlace,
    originKey: input.originKey,
  });
}

function validationPacketPlaceKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const valueKey = input.context.graph.createValue({
    role: `validation:packet:${String(input.validationId.hirId)}`,
    origin: input.originKey,
  });
  return input.context.effects.placeFromRuntimeTemporary({
    valueKey,
    originKey: input.originKey,
  });
}

function allocateValidationPlaces(input: {
  readonly context: ProofMirLoweringContext;
  readonly validation: MonoValidation;
  readonly originKey: ProofMirCanonicalKey;
  readonly materializeOkPayload: boolean;
  readonly materializeErrPayload: boolean;
}): ProofMirLoweringResult<LoweredValidationPlaces> {
  const sourcePlaceResult = lowerMonoPlaceKey({
    context: input.context,
    monoPlace: input.validation.sourcePlace,
    originKey: input.originKey,
  });
  if (sourcePlaceResult.kind === "error") {
    return sourcePlaceResult;
  }

  const pendingResultResult = lowerMonoPlaceKey({
    context: input.context,
    monoPlace: input.validation.pendingResultPlace,
    originKey: input.originKey,
  });
  if (pendingResultResult.kind === "error") {
    return pendingResultResult;
  }

  const okPacketPlaceKey = validationPacketPlaceKey({
    context: input.context,
    validationId: input.validation.validationId,
    originKey: input.originKey,
  });

  let okPayloadPlaceKey: ProofMirCanonicalKey | undefined;
  if (input.materializeOkPayload) {
    okPayloadPlaceKey = input.context.effects.placeFromValidationPayload({
      validationId: input.validation.validationId,
      originKey: input.originKey,
      type: input.validation.okPayloadType,
      resourceKind: "Copy",
    });
  }

  let errPayloadPlaceKey: ProofMirCanonicalKey | undefined;
  if (input.materializeErrPayload) {
    errPayloadPlaceKey = input.context.effects.placeFromValidationPayload({
      validationId: input.validation.validationId,
      originKey: input.originKey,
      type: input.validation.errPayloadType,
      resourceKind: "Copy",
    });
  }

  return loweringOk({
    sourcePlaceKey: sourcePlaceResult.value,
    pendingResultPlaceKey: pendingResultResult.value,
    okPacketPlaceKey,
    ...(okPayloadPlaceKey === undefined ? {} : { okPayloadPlaceKey }),
    ...(errPayloadPlaceKey === undefined ? {} : { errPayloadPlaceKey }),
  });
}

function layoutTermReferenceForRoot(input: {
  readonly context: ProofMirLoweringContext;
  readonly root: ProofMirLayoutTermReference["path"]["root"];
  readonly childPath: ProofMirLayoutTermReference["path"]["childPath"];
  readonly expectedUnit: ProofMirLayoutTermReference["unit"];
}): DraftProofMirLayoutTermReference | undefined {
  const resolved = input.context.layoutBindingIndex.resolveTerm({
    root: input.root,
    childPath: input.childPath,
    expectedUnit: input.expectedUnit,
  });
  if (resolved.kind !== "ok") {
    return undefined;
  }
  return {
    termKey: resolved.key,
    unit: resolved.unit,
    path: {
      root: input.root,
      childPath: input.childPath,
    },
  };
}

function recordValidationEvidenceFacts(input: {
  readonly context: ProofMirLoweringContext;
  readonly validation: MonoValidation;
  readonly bufferInstanceId: MonoInstanceId;
  readonly packetPlaceKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ValidationLoweringIdAllocator;
}): readonly ProofMirCanonicalKey[] {
  const buffer = input.context.layout.validatedBuffers.get(input.bufferInstanceId);
  if (buffer === undefined) {
    return [];
  }

  const factKeys: ProofMirCanonicalKey[] = [];

  const sourceLengthEnd = layoutTermReferenceForRoot({
    context: input.context,
    root: {
      kind: "validatedBufferSourceLength",
      instanceId: input.bufferInstanceId,
    },
    childPath: [],
    expectedUnit: "byteLength",
  });
  if (sourceLengthEnd !== undefined) {
    const factKey = input.context.factRecorder.recordLayoutFitsFact({
      role: "evidence",
      dependsOn: [
        {
          kind: "layout",
          layout: {
            kind: "validatedBuffer",
            instanceId: input.bufferInstanceId,
          } satisfies ProofMirLayoutReference,
        },
      ],
      origin: input.originKey,
      sourcePlaceKey: input.packetPlaceKey,
      end: sourceLengthEnd,
    });
    if (factKey !== undefined) {
      factKeys.push(factKey);
    }
  }

  for (const derivedField of buffer.derivedFields) {
    const payloadEnd = layoutTermReferenceForRoot({
      context: input.context,
      root: {
        kind: "validatedBufferDerivedSource",
        instanceId: input.bufferInstanceId,
        fieldId: derivedField.fieldId,
      },
      childPath: [],
      expectedUnit: derivedField.source.unit,
    });
    if (payloadEnd === undefined) {
      continue;
    }
    const factKey = input.context.factRecorder.recordPayloadEndFact({
      role: "evidence",
      dependsOn: [
        {
          kind: "layout",
          layout: {
            kind: "validatedBuffer",
            instanceId: input.bufferInstanceId,
          } satisfies ProofMirLayoutReference,
        },
      ],
      origin: input.originKey,
      sourcePlaceKey: input.packetPlaceKey,
      end: payloadEnd,
    });
    if (factKey !== undefined) {
      factKeys.push(factKey);
    }
  }

  void input.validation;
  return factKeys;
}

function buildValidationStart(input: {
  readonly validation: MonoValidation;
  readonly places: LoweredValidationPlaces;
  readonly bufferInstanceId: MonoInstanceId;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirValidationStart {
  const layout: ProofMirLayoutReference & { readonly kind: "validatedBuffer" } = {
    kind: "validatedBuffer",
    instanceId: input.bufferInstanceId,
  };

  return {
    validationId: input.validation.validationId,
    sourcePlaceKey: input.places.sourcePlaceKey,
    pendingResultPlaceKey: input.places.pendingResultPlaceKey,
    okPacketPlaceKey: input.places.okPacketPlaceKey,
    ...(input.places.okPayloadPlaceKey === undefined
      ? {}
      : { okPayloadPlaceKey: input.places.okPayloadPlaceKey }),
    ...(input.places.errPayloadPlaceKey === undefined
      ? {}
      : { errPayloadPlaceKey: input.places.errPayloadPlaceKey }),
    okPayloadType: input.validation.okPayloadType,
    errPayloadType: input.validation.errPayloadType,
    validatedBufferInstanceId: input.bufferInstanceId,
    layout,
    originKey: input.originKey,
  };
}

function recordValidateStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly recorded: RecordedProofMirStatement[];
  readonly originKey: ProofMirCanonicalKey;
  readonly validationStart: DraftProofMirValidationStart;
  readonly monoStatementId: MonoStatementId;
}): DraftProofMirGraphStatementSnapshot {
  const statementKey = input.context.graph.addStatement(input.blockKey, {
    origin: input.originKey,
  });
  const snapshot: DraftProofMirGraphStatementSnapshot = {
    statementKey,
    originKey: input.originKey,
    kind: { kind: "validate", validation: input.validationStart },
  };
  input.recorded.push(snapshot);
  input.context.graph.recordLoweredStatement(input.blockKey, snapshot);
  return snapshot;
}

function producedOperandForPlace(input: {
  readonly placeKey: ProofMirCanonicalKey;
  readonly idAllocator: ValidationLoweringIdAllocator;
}): ProofMirProducedOperand {
  const placeId = input.idAllocator.placeForKey(input.placeKey);
  const valueId = input.idAllocator.valueForKey(input.placeKey);
  return {
    kind: "valueAndPlace",
    value: valueId,
    place: placeId,
  };
}

function argumentValueKeyForPlace(input: {
  readonly context: ProofMirLoweringContext;
  readonly placeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const structured = input.context.effects.draftPlace(input.placeKey);
  if (structured.root.kind === "runtimeTemporary") {
    return structured.root.valueKey;
  }
  return input.context.graph.createValue({
    role: `place-argument:${String(input.placeKey)}`,
    origin: input.originKey,
    ...(structured.type === undefined ? {} : { type: structured.type }),
    ...(structured.resourceKind === undefined ? {} : { resourceKind: structured.resourceKind }),
  });
}

function draftBindingForArmLocal(input: {
  readonly context: ProofMirLoweringContext;
  readonly bindingKind: ProofMirValidationArmBinding["bindingKind"];
  readonly local?: MonoLocal;
  readonly placeKey: ProofMirCanonicalKey;
  readonly payloadType: MonoValidation["okPayloadType"];
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ValidationLoweringIdAllocator;
}): {
  readonly draft: DraftGraphValidationArmBinding;
  readonly model: ProofMirValidationArmBinding;
  readonly argumentKeys: readonly ProofMirCanonicalKey[];
} {
  const operand = producedOperandForPlace({
    placeKey: input.placeKey,
    idAllocator: input.idAllocator,
  });
  const argumentValueKey = argumentValueKeyForPlace({
    context: input.context,
    placeKey: input.placeKey,
    originKey: input.originKey,
  });
  const monoLocalIdKey =
    input.local === undefined
      ? undefined
      : draftLocalKey({
          functionInstanceId: input.local.localId.instanceId,
          monoLocalId: input.local.localId,
        });

  return {
    draft: {
      ...(monoLocalIdKey === undefined ? {} : { monoLocalIdKey }),
      bindingKind: input.bindingKind,
      operandValueKey: argumentValueKey,
      operandPlaceKey: input.placeKey,
      operandType: input.payloadType,
      origin: input.originKey,
    },
    model: {
      ...(input.local === undefined ? {} : { monoLocalId: input.local.localId }),
      bindingKind: input.bindingKind,
      operand,
      type: input.payloadType,
      origin: input.idAllocator.nextOrigin(),
    },
    argumentKeys: [argumentValueKey],
  };
}

function validationArmScopeKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly statementId: MonoStatementId;
  readonly arm: "ok" | "err";
  readonly parentScopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const stmtPrefix = `stmt:${instantiatedHirIdKey(input.statementId)}`;
  return input.context.graph.createScope({
    role: `validationArm:${stmtPrefix}:${input.arm}`,
    parentScopeKey: input.parentScopeKey,
    origin: input.originKey,
  });
}

function invalidValidationBindingDiagnostic(input: {
  readonly context: ProofMirLoweringContext;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALIDATION_BINDING",
    message: "Validation match is missing required ok or err arm metadata.",
    functionInstanceId: input.context.functionInstanceId,
    ownerKey: `function:${String(input.context.functionInstanceId)}`,
    rootCauseKey: "validation-binding",
    stableDetail: input.stableDetail,
  });
}

function invalidValidationEdgeEffectsDiagnostic(input: {
  readonly context: ProofMirLoweringContext;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALIDATION_EDGE_EFFECTS",
    message: "Validation match cannot construct consistent ok and err edge effects.",
    functionInstanceId: input.context.functionInstanceId,
    ownerKey: `function:${String(input.context.functionInstanceId)}`,
    rootCauseKey: "validation-edge-effects",
    stableDetail: input.stableDetail,
  });
}

function buildValidationEdgeEffects(input: {
  readonly places: LoweredValidationPlaces;
  readonly includeErrPayload: boolean;
}): {
  readonly okEffects: readonly {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[];
  readonly errEffects: readonly {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[];
} {
  const okEffects: {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[] = [
    { kind: "consumePlace", placeKey: input.places.pendingResultPlaceKey },
    { kind: "consumePlace", placeKey: input.places.sourcePlaceKey },
    { kind: "introducePlace", placeKey: input.places.okPacketPlaceKey },
  ];
  if (input.places.okPayloadPlaceKey !== undefined) {
    okEffects.push({ kind: "introducePlace", placeKey: input.places.okPayloadPlaceKey });
  }

  const errEffects: {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[] = [{ kind: "consumePlace", placeKey: input.places.pendingResultPlaceKey }];
  if (input.includeErrPayload && input.places.errPayloadPlaceKey !== undefined) {
    errEffects.push({ kind: "introducePlace", placeKey: input.places.errPayloadPlaceKey });
  }

  return { okEffects, errEffects };
}

function lowerValidationCreationImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly validation: MonoValidation;
  readonly blockKey: ProofMirCanonicalKey;
  readonly materializeOkPayload: boolean;
  readonly materializeErrPayload: boolean;
  readonly recorded: RecordedProofMirStatement[];
  readonly idAllocator: ValidationLoweringIdAllocator;
}): ProofMirLoweringResult<{
  readonly validationStart: DraftProofMirValidationStart;
  readonly places: LoweredValidationPlaces;
  readonly validateStatement: DraftProofMirGraphStatementSnapshot;
}> {
  const bufferInstanceId = resolveValidatedBufferInstanceId(
    input.context.program,
    input.validation.validatedBufferTypeId,
  );
  if (bufferInstanceId === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Validation creation references a validated buffer with no mono instance.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "missing-validated-buffer",
        stableDetail: String(input.validation.validatedBufferTypeId),
      }),
    ]);
  }

  const originKey = input.context.originMap.fromMonoProof({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    monoProofId: input.validation.validationId,
  });

  const placesResult = allocateValidationPlaces({
    context: input.context,
    validation: input.validation,
    originKey,
    materializeOkPayload: input.materializeOkPayload,
    materializeErrPayload: input.materializeErrPayload,
  });
  if (placesResult.kind === "error") {
    return placesResult;
  }

  const validationStart = buildValidationStart({
    validation: input.validation,
    places: placesResult.value,
    bufferInstanceId,
    originKey,
  });

  const validateStatement = recordValidateStatement({
    context: input.context,
    blockKey: input.blockKey,
    recorded: input.recorded,
    originKey,
    validationStart,
    monoStatementId: instantiatedHirId(
      input.context.functionInstanceId,
      hirStatementId(Number(String(input.validation.validationId.hirId))),
    ),
  });

  return loweringOk({ validationStart, places: placesResult.value, validateStatement });
}

function lowerValidationMatchImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoValidationMatchStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly recorded: RecordedProofMirStatement[];
  readonly idAllocator: ValidationLoweringIdAllocator;
}): ProofMirLoweringResult<{
  readonly validation: MonoValidation;
  readonly validateStatement?: DraftProofMirGraphStatementSnapshot;
  readonly terminator: DraftGraphTerminator;
  readonly okEdge: DraftGraphEdgeView;
  readonly errEdge: DraftGraphEdgeView;
}> {
  if (input.statement.validation === undefined) {
    return loweringError([
      invalidValidationEdgeEffectsDiagnostic({
        context: input.context,
        stableDetail: "missing-validation-metadata",
      }),
    ]);
  }

  if (input.statement.okArm === undefined || input.statement.errArm === undefined) {
    return loweringError([
      invalidValidationBindingDiagnostic({
        context: input.context,
        stableDetail: `ok:${input.statement.okArm === undefined}:err:${input.statement.errArm === undefined}`,
      }),
    ]);
  }

  const validation = input.statement.validation;
  const materializeErrPayload = input.statement.errArm.bindingLocals.length > 0;
  const matchStatementId = instantiatedHirId(
    input.context.functionInstanceId,
    hirStatementId(Number(String(validation.validationId.hirId))),
  );

  const creationResult = lowerValidationCreationImpl({
    context: input.context,
    validation,
    blockKey: input.blockKey,
    materializeOkPayload: false,
    materializeErrPayload,
    recorded: input.recorded,
    idAllocator: input.idAllocator,
  });
  if (creationResult.kind === "error") {
    return creationResult;
  }

  const places = creationResult.value.places;
  const bufferInstanceId = resolveValidatedBufferInstanceId(
    input.context.program,
    validation.validatedBufferTypeId,
  );
  if (bufferInstanceId === undefined) {
    return loweringError([
      invalidValidationEdgeEffectsDiagnostic({
        context: input.context,
        stableDetail: "missing-buffer-instance",
      }),
    ]);
  }

  const matchOriginKey = input.context.originMap.fromMonoStatement({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    monoStatementId: instantiatedHirId(
      input.context.functionInstanceId,
      hirStatementId(Number(String(validation.validationId.hirId)) + 1000),
    ),
  });

  const okArmOriginKey = input.context.graph.allocateSyntheticOrigin("validation.ok");
  const errArmOriginKey = input.context.graph.allocateSyntheticOrigin("validation.err");
  const statementOrdinal = Number(String(validation.validationId.hirId));

  const sourceScopeKey = input.context.graph.block(input.blockKey).scopeKey;

  const okScopeKey = validationArmScopeKey({
    context: input.context,
    statementId: matchStatementId,
    arm: "ok",
    parentScopeKey: sourceScopeKey,
    originKey: okArmOriginKey,
  });
  const errScopeKey = validationArmScopeKey({
    context: input.context,
    statementId: matchStatementId,
    arm: "err",
    parentScopeKey: sourceScopeKey,
    originKey: errArmOriginKey,
  });

  const okBlockKey = input.context.graph.createBlock({
    role: `validation:ok:${statementOrdinal}`,
    scope: okScopeKey,
    origin: okArmOriginKey,
  });
  const errBlockKey = input.context.graph.createBlock({
    role: `validation:err:${statementOrdinal}`,
    scope: errScopeKey,
    origin: errArmOriginKey,
  });

  const finalizeOkArm = setEmptyArmUnreachableTerminator({
    context: input.context,
    blockKey: okBlockKey,
    origin: okArmOriginKey,
  });
  if (finalizeOkArm.kind === "error") {
    return finalizeOkArm;
  }
  const finalizeErrArm = setEmptyArmUnreachableTerminator({
    context: input.context,
    blockKey: errBlockKey,
    origin: errArmOriginKey,
  });
  if (finalizeErrArm.kind === "error") {
    return finalizeErrArm;
  }

  const { okEffects, errEffects } = buildValidationEdgeEffects({
    places,
    includeErrPayload: materializeErrPayload,
  });

  const okFactKeys = recordValidationEvidenceFacts({
    context: input.context,
    validation,
    bufferInstanceId,
    packetPlaceKey: places.okPacketPlaceKey,
    originKey: okArmOriginKey,
    idAllocator: input.idAllocator,
  });

  const okBindings: DraftGraphValidationArmBinding[] = [];
  const okModelBindings: ProofMirValidationArmBinding[] = [];
  const okArgumentKeys: ProofMirCanonicalKey[] = [];
  const okBindingLocal = input.statement.okArm.bindingLocals[0];
  if (okBindingLocal !== undefined) {
    const binding = draftBindingForArmLocal({
      context: input.context,
      bindingKind: "packet",
      local: okBindingLocal,
      placeKey: places.okPacketPlaceKey,
      payloadType: validation.okPayloadType,
      originKey: okArmOriginKey,
      idAllocator: input.idAllocator,
    });
    okBindings.push(binding.draft);
    okModelBindings.push(binding.model);
    okArgumentKeys.push(...binding.argumentKeys);
  }

  const errBindings: DraftGraphValidationArmBinding[] = [];
  const errModelBindings: ProofMirValidationArmBinding[] = [];
  const errArgumentKeys: ProofMirCanonicalKey[] = [];
  const errBindingLocal = input.statement.errArm.bindingLocals[0];
  if (errBindingLocal !== undefined && places.errPayloadPlaceKey !== undefined) {
    const binding = draftBindingForArmLocal({
      context: input.context,
      bindingKind: "error",
      local: errBindingLocal,
      placeKey: places.errPayloadPlaceKey,
      payloadType: validation.errPayloadType,
      originKey: errArmOriginKey,
      idAllocator: input.idAllocator,
    });
    errBindings.push(binding.draft);
    errModelBindings.push(binding.model);
    errArgumentKeys.push(...binding.argumentKeys);
  }

  const okEdgeKey = input.context.graph.createValidationEdge({
    kind: "validationOk",
    fromBlock: input.blockKey,
    toBlock: okBlockKey,
    sourceScope: sourceScopeKey,
    targetScope: okScopeKey,
    origin: okArmOriginKey,
    factKeys: okFactKeys,
    effects: okEffects,
    argumentKeys: okArgumentKeys,
  });
  const errEdgeKey = input.context.graph.createValidationEdge({
    kind: "validationErr",
    fromBlock: input.blockKey,
    toBlock: errBlockKey,
    sourceScope: sourceScopeKey,
    targetScope: errScopeKey,
    origin: errArmOriginKey,
    effects: errEffects,
    argumentKeys: errArgumentKeys,
  });

  const terminator: DraftGraphTerminator = {
    kind: "matchValidation",
    validationId: validation.validationId,
    okTarget: { edge: okEdgeKey, block: okBlockKey },
    errTarget: { edge: errEdgeKey, block: errBlockKey },
    okBindings,
    errBindings,
    origin: matchOriginKey,
  };

  const setTerminatorResult = input.context.graph.setTerminator(input.blockKey, terminator);
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  void okModelBindings;
  void errModelBindings;

  return loweringOk({
    validation,
    validateStatement: creationResult.value.validateStatement,
    terminator,
    okEdge: input.context.graph.edge(okEdgeKey),
    errEdge: input.context.graph.edge(errEdgeKey),
  });
}

export function createProofMirValidationLowerer(): ProofMirValidationLowerer & {
  readonly statements: () => readonly DraftProofMirGraphStatementSnapshot[];
  lowerValidationCreation(input: {
    readonly context: ProofMirLoweringContext;
    readonly validation: MonoValidation;
    readonly blockKey: ProofMirCanonicalKey;
    readonly materializeOkPayload?: boolean;
    readonly materializeErrPayload?: boolean;
  }): ProofMirLoweringResult<DraftProofMirGraphStatementSnapshot>;
} {
  const recorded: RecordedProofMirStatement[] = [];
  const idAllocator = createValidationLoweringIdAllocator();

  return {
    lowerValidation(lowererInput: ProofMirValidationLoweringInput): ProofMirLoweringResult<void> {
      const result = lowerValidationMatchImpl({
        context: lowererInput.context,
        statement: lowererInput.statement,
        blockKey: lowererInput.blockKey,
        recorded,
        idAllocator,
      });
      if (result.kind === "error") {
        return result;
      }
      return loweringOk(undefined);
    },
    lowerValidationCreation(input) {
      const creationRecorded: RecordedProofMirStatement[] = [];
      const result = lowerValidationCreationImpl({
        context: input.context,
        validation: input.validation,
        blockKey: input.blockKey,
        materializeOkPayload: input.materializeOkPayload ?? false,
        materializeErrPayload: input.materializeErrPayload ?? false,
        recorded: creationRecorded,
        idAllocator,
      });
      if (result.kind === "error") {
        return result;
      }
      recorded.push(result.value.validateStatement);
      return loweringOk(result.value.validateStatement);
    },
    statements(): readonly DraftProofMirGraphStatementSnapshot[] {
      return recorded.map((entry) => ({
        statementKey: entry.statementKey,
        originKey: entry.originKey,
        kind: entry.kind,
      }));
    },
  };
}
