import type { MonoExpression, MonoResourcePlace } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import { findLayoutValidatedBufferForPlace } from "../domains/validated-buffer-layout-lookup";
import {
  classifyValidatedBufferMemberRead,
  containerPlaceForMemberPlace,
  splitMemberPlace,
} from "../domains/validated-buffer-read-detection";
import type { DraftProofMirOriginKey } from "../domains/origin-map";
import type {
  DraftProofMirLayoutTermBinding,
  DraftProofMirValidatedBufferRead,
} from "../draft/draft-statement";
import type { ProofMirDraftOperand } from "./lowering-operands";
import { loweringError, loweringOk } from "./call-lowering-shared";
import type {
  ProofMirLoweringResult,
  ProofMirValidatedBufferReadLoweringInput,
} from "./lowering-context";
import { recordReadRequirementFacts } from "./validated-buffer-read-facts";
import {
  collectDynamicLayoutTermBindings,
  fieldTermUnit,
  resolveLayoutTermReference,
} from "./validated-buffer-read-layout-terms";
import {
  type RecordedProofMirStatement,
  recordValidatedBufferReadStatement,
} from "./validated-buffer-read-statement-recorder";

function unlowerableExpressionDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly stableDetail: string;
  readonly sourceOrigin?: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
    message: "Proof MIR validated-buffer read lowering does not handle this mono expression shape.",
    functionInstanceId: input.functionInstanceId,
    ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "validated-buffer-read-shape",
    stableDetail: input.stableDetail,
  });
}

function originForExpression(
  context: ProofMirValidatedBufferReadLoweringInput["context"],
  expression: MonoExpression,
): ProofMirCanonicalKey {
  return context.originMap.fromMonoExpression({
    owner: { kind: "function", functionInstanceId: context.functionInstanceId },
    sourceOrigin: expression.sourceOrigin,
    monoExpressionId: expression.expressionId,
  });
}

function lowerPlaceFromMono(input: {
  readonly context: ProofMirValidatedBufferReadLoweringInput["context"];
  readonly monoPlace: MonoResourcePlace;
  readonly originKey: DraftProofMirOriginKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  return input.context.scopePlaceLowerer.lowerMonoPlace({
    context: input.context,
    monoPlace: input.monoPlace,
    originKey: input.originKey,
  });
}

export function lowerLayoutFieldRead(input: {
  readonly loweringInput: ProofMirValidatedBufferReadLoweringInput;
  readonly expression: MonoExpression;
  readonly memberPlace: MonoResourcePlace;
  readonly resultType?: MonoExpression["type"];
  readonly resultResourceKind?: MonoExpression["resourceKind"];
  readonly recorded: RecordedProofMirStatement[];
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const split = splitMemberPlace(input.memberPlace);
  if (split === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:missing-field-projection",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }
  const containerPlace = containerPlaceForMemberPlace({
    program: input.loweringInput.context.program,
    memberPlace: input.memberPlace,
  });
  if (containerPlace === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:missing-container-place",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const layoutBuffer = findLayoutValidatedBufferForPlace({
    program: input.loweringInput.context.program,
    layout: input.loweringInput.context.layout,
    place: containerPlace,
  });
  if (layoutBuffer === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Required validated-buffer layout fact is missing from LayoutFactProgram.",
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        ownerKey: `function:${String(input.loweringInput.context.functionInstanceId)}`,
        rootCauseKey: "validated-buffer",
        stableDetail: "missing-buffer",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const readKind = classifyValidatedBufferMemberRead({
    layoutBuffer,
    fieldId: split.fieldProjection.fieldId,
  });
  if (readKind?.kind !== "layoutField") {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:not-layout-field",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const originKey = originForExpression(input.loweringInput.context, input.expression);
  const layoutFieldReference = {
    kind: "validatedBufferField" as const,
    instanceId: layoutBuffer.instanceId,
    fieldId: readKind.fieldId,
  };
  const containerPlaceKey = lowerPlaceFromMono({
    context: input.loweringInput.context,
    monoPlace: containerPlace,
    originKey,
  });
  if (containerPlaceKey.kind !== "ok") {
    return containerPlaceKey;
  }

  const sourcePlaceKey = containerPlaceKey.value;

  const offsetUnit = fieldTermUnit(layoutBuffer, readKind.fieldId, "offset");
  const endUnit = fieldTermUnit(layoutBuffer, readKind.fieldId, "end");
  if (offsetUnit === undefined || endUnit === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Required validated-buffer field layout fact is missing from LayoutFactProgram.",
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        ownerKey: String(layoutBuffer.instanceId),
        rootCauseKey: "layout-field",
        stableDetail: String(readKind.fieldId),
      }),
    ]);
  }

  const offsetTerm = resolveLayoutTermReference({
    context: input.loweringInput.context,
    root: {
      kind: "validatedBufferFieldTerm",
      instanceId: layoutBuffer.instanceId,
      fieldId: readKind.fieldId,
      slot: "offset",
    },
    childPath: [],
    expectedUnit: offsetUnit,
  });
  if (offsetTerm.kind === "error") {
    return offsetTerm;
  }
  const endTerm = resolveLayoutTermReference({
    context: input.loweringInput.context,
    root: {
      kind: "validatedBufferFieldTerm",
      instanceId: layoutBuffer.instanceId,
      fieldId: readKind.fieldId,
      slot: "end",
    },
    childPath: [],
    expectedUnit: endUnit,
  });
  if (endTerm.kind === "error") {
    return endTerm;
  }

  const offsetBindings = collectDynamicLayoutTermBindings({
    context: input.loweringInput.context,
    layoutBuffer,
    fieldId: readKind.fieldId,
    slot: "offset",
    sourcePlaceKey: containerPlaceKey.value,
    originKey,
    blockKey: input.loweringInput.blockKey,
    recorded: input.recorded,
  });
  if (offsetBindings.kind === "error") {
    return offsetBindings;
  }
  const endBindings = collectDynamicLayoutTermBindings({
    context: input.loweringInput.context,
    layoutBuffer,
    fieldId: readKind.fieldId,
    slot: "end",
    sourcePlaceKey: containerPlaceKey.value,
    originKey,
    blockKey: input.loweringInput.blockKey,
    recorded: input.recorded,
  });
  if (endBindings.kind === "error") {
    return endBindings;
  }

  const readRequirements = recordReadRequirementFacts({
    context: input.loweringInput.context,
    layoutBuffer,
    fieldId: readKind.fieldId,
    sourcePlaceKey,
    originKey,
  });
  if (readRequirements.kind === "error") {
    return readRequirements;
  }

  const resultKey = input.loweringInput.context.graph.createValue({
    role: `validatedBufferRead:${String(readKind.fieldId)}`,
    origin: originKey,
    type: input.resultType ?? input.expression.type,
    resourceKind: input.resultResourceKind ?? input.expression.resourceKind,
  });
  const read: DraftProofMirValidatedBufferRead = {
    sourcePlaceKey: containerPlaceKey.value,
    packetPlaceKey: containerPlaceKey.value,
    validatedBufferInstanceId: layoutBuffer.instanceId,
    fieldId: readKind.fieldId,
    layoutField: layoutFieldReference,
    offsetTerm: offsetTerm.value,
    endTerm: endTerm.value,
    termBindingKeys: [...offsetBindings.value, ...endBindings.value],
    readRequiresFactKeys: readRequirements.value,
    resultKey,
    originKey,
  };
  recordValidatedBufferReadStatement({
    recorded: input.recorded,
    context: input.loweringInput.context,
    blockKey: input.loweringInput.blockKey,
    originKey,
    kind: { kind: "readValidatedBufferField", read },
  });

  return loweringOk({ kind: "value", value: resultKey });
}

function lowerSourceLengthRead(input: {
  readonly loweringInput: ProofMirValidatedBufferReadLoweringInput;
  readonly expression: MonoExpression;
  readonly memberPlace: MonoResourcePlace;
  readonly recorded: RecordedProofMirStatement[];
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const split = splitMemberPlace(input.memberPlace);
  if (split === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "sourceLength:missing-projection",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }
  const containerPlace = containerPlaceForMemberPlace({
    program: input.loweringInput.context.program,
    memberPlace: input.memberPlace,
  });
  if (containerPlace === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "sourceLength:missing-container-place",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const layoutBuffer = findLayoutValidatedBufferForPlace({
    program: input.loweringInput.context.program,
    layout: input.loweringInput.context.layout,
    place: containerPlace,
  });
  if (layoutBuffer === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Required validated-buffer layout fact is missing from LayoutFactProgram.",
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        ownerKey: `function:${String(input.loweringInput.context.functionInstanceId)}`,
        rootCauseKey: "validated-buffer",
        stableDetail: "missing-buffer",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const originKey = originForExpression(input.loweringInput.context, input.expression);
  const containerPlaceKey = lowerPlaceFromMono({
    context: input.loweringInput.context,
    monoPlace: containerPlace,
    originKey,
  });
  if (containerPlaceKey.kind !== "ok") {
    return containerPlaceKey;
  }

  const termReference = resolveLayoutTermReference({
    context: input.loweringInput.context,
    root: {
      kind: "validatedBufferSourceLength",
      instanceId: layoutBuffer.instanceId,
    },
    childPath: [],
    expectedUnit: "byteLength",
  });
  if (termReference.kind === "error") {
    return termReference;
  }

  const valueKey = input.loweringInput.context.graph.createValue({
    role: "validatedBufferSourceLength",
    origin: originKey,
    type: input.expression.type,
    resourceKind: input.expression.resourceKind,
  });
  const bindingKey = input.loweringInput.context.graph.allocateRequirementFactKey(
    `bindLayoutTerm:sourceLength:${String(layoutBuffer.instanceId)}:${String(valueKey)}`,
  );
  const binding: DraftProofMirLayoutTermBinding = {
    key: bindingKey,
    term: termReference.value,
    valueKey,
    sourcePlaceKey: containerPlaceKey.value,
    originKey,
  };
  recordValidatedBufferReadStatement({
    recorded: input.recorded,
    context: input.loweringInput.context,
    blockKey: input.loweringInput.blockKey,
    originKey,
    kind: { kind: "bindLayoutTerm", binding },
  });

  return loweringOk({ kind: "value", value: valueKey });
}

export function lowerValidatedBufferMemberRead(input: {
  readonly loweringInput: ProofMirValidatedBufferReadLoweringInput;
  readonly expression: MonoExpression;
  readonly memberPlace: MonoResourcePlace;
  readonly recorded: RecordedProofMirStatement[];
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const split = splitMemberPlace(input.memberPlace);
  if (split === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:shape",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }
  const containerPlace = containerPlaceForMemberPlace({
    program: input.loweringInput.context.program,
    memberPlace: input.memberPlace,
  });
  if (containerPlace === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:missing-container-place",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const layoutBuffer = findLayoutValidatedBufferForPlace({
    program: input.loweringInput.context.program,
    layout: input.loweringInput.context.layout,
    place: containerPlace,
  });
  if (layoutBuffer === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Required validated-buffer layout fact is missing from LayoutFactProgram.",
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        ownerKey: `function:${String(input.loweringInput.context.functionInstanceId)}`,
        rootCauseKey: "validated-buffer",
        stableDetail: "missing-buffer",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  const readKind = classifyValidatedBufferMemberRead({
    layoutBuffer,
    fieldId: split.fieldProjection.fieldId,
  });
  if (readKind === undefined) {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:unknown-field",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }

  switch (readKind.kind) {
    case "sourceLength":
      return lowerSourceLengthRead(input);
    case "layoutField":
      return lowerLayoutFieldRead(input);
    case "derivedField":
      return loweringError([
        unlowerableExpressionDiagnostic({
          functionInstanceId: input.loweringInput.context.functionInstanceId,
          stableDetail: `derived-field:${String(readKind.fieldId)}`,
          sourceOrigin: input.expression.sourceOrigin,
        }),
      ]);
    default: {
      const unreachable: never = readKind;
      return unreachable;
    }
  }
}

export function unlowerableValidatedBufferReadDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly stableDetail: string;
  readonly sourceOrigin?: string;
}): ProofMirDiagnostic {
  return unlowerableExpressionDiagnostic(input);
}
