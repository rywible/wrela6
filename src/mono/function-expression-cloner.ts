import type { HirExpression, HirValidation, TypedHirProgram } from "../hir/hir";
import { cloneCallExpression } from "./function-call-cloner";
import {
  cloneResourcePlace,
  concretizeResourceKindForClone,
  normalizeMonoCheckedTypeForClone,
  remapOwnedProofId,
  reportRecoveryExpression,
} from "./function-place-cloner";
import {
  type MonoAttempt,
  type MonoEnumPayloadFieldBinding,
  type MonoExpression,
  type MonoExpressionId,
  type MonoFunctionInstance,
  type MonoLiteralValue,
  type MonoLocalId,
  type MonoObjectField,
  type MonoResourcePlace,
  type MonoValidation,
} from "./mono-hir";
import {
  monoExpressionIdFor,
  monoTransformExpressionId,
  type MonoTransformContext,
} from "./mono-transform-context";
import { type MonoSubstitution } from "./substitution";
import { canonicalTypeInstanceId } from "./instantiation-key";
export type CloneExpressionResult =
  | { readonly kind: "ok"; readonly expression: MonoExpression }
  | { readonly kind: "error" };

interface CloneExpressionInput {
  readonly source: HirExpression;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}

export function cloneExpression(input: CloneExpressionInput): CloneExpressionResult {
  const monoExpressionId = monoTransformExpressionId(
    input.transformContext,
    input.source.expressionId,
  );
  const sourceOrigin = String(input.source.sourceOrigin);
  switch (input.source.kind.kind) {
    case "literal":
      return cloneLiteralExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "name":
      return cloneNameExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "member":
      return cloneMemberExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "object":
      return cloneObjectExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "enumConstructor":
      return cloneEnumConstructorExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "call":
      return cloneCallExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "attempt":
      return cloneAttemptExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "validationCreation":
      return cloneValidationCreationExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "unary":
      return cloneUnaryExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "binary":
    case "comparison":
      return cloneBinaryExpression({
        inner: input.source.kind,
        expressionId: monoExpressionId,
        source: input.source,
        sourceOrigin,
        instance: input.instance,
        substitution: input.substitution,
        program: input.program,
        transformContext: input.transformContext,
      });
    case "error":
      return reportRecoveryExpression({
        transformContext: input.transformContext,
        instance: input.instance,
        sourceOrigin,
        reason: input.source.kind.reason,
      });
  }
}

function enumTypeInstanceIdForConstructor(input: {
  readonly enumTypeId: import("../semantic/ids").TypeId;
  readonly type: MonoExpression["type"];
}) {
  if (
    input.type.kind === "applied" &&
    input.type.constructor.kind === "source" &&
    input.type.constructor.typeId === input.enumTypeId
  ) {
    return canonicalTypeInstanceId({
      typeId: input.enumTypeId,
      typeArguments: input.type.arguments as readonly import("./mono-hir").MonoCheckedType[],
    });
  }
  if (input.type.kind === "source" && input.type.typeId === input.enumTypeId) {
    return canonicalTypeInstanceId({ typeId: input.enumTypeId, typeArguments: [] });
  }
  return undefined;
}

function cloneEnumConstructorExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "enumConstructor" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const payloadFields: MonoEnumPayloadFieldBinding[] = [];
  for (const field of input.inner.constructor.payloadFields) {
    const clonedValue = cloneExpression({
      source: field.value,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (clonedValue.kind === "error") return { kind: "error" };
    payloadFields.push({
      fieldId: field.fieldId,
      name: field.name,
      value: clonedValue.expression,
      sourceOrigin: String(field.sourceOrigin),
    });
  }
  const enumTypeInstanceId = enumTypeInstanceIdForConstructor({
    enumTypeId: input.inner.constructor.enumTypeId,
    type: monoType.type,
  });
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: {
        kind: "enumConstructor",
        constructor: {
          ...(enumTypeInstanceId !== undefined ? { enumTypeInstanceId } : {}),
          enumTypeId: input.inner.constructor.enumTypeId,
          caseItemId: input.inner.constructor.caseItemId,
          caseName: input.inner.constructor.caseName,
          caseOrdinal: input.inner.constructor.caseOrdinal,
          payloadFields,
        },
      },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

function cloneLiteralExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "literal" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const literal: MonoLiteralValue =
    input.inner.literal.kind === "integer"
      ? input.inner.literal.value !== undefined
        ? { kind: "integer", text: input.inner.literal.text, value: input.inner.literal.value }
        : { kind: "integer", text: input.inner.literal.text }
      : input.inner.literal.kind === "string"
        ? { kind: "string", value: input.inner.literal.value }
        : { kind: "bool", value: input.inner.literal.value };
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: { kind: "literal", literal },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

function cloneNameExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "name" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  let monoLocalId: MonoLocalId | undefined;
  if (input.inner.localId !== undefined) {
    const remapped = input.transformContext.remap.localRemap.get(input.inner.localId);
    if (remapped === undefined) {
      return reportRecoveryExpression({
        transformContext: input.transformContext,
        instance: input.instance,
        sourceOrigin: input.sourceOrigin,
        reason: `missing-name-local:${input.inner.localId}`,
      });
    }
    monoLocalId = remapped;
  }
  let place: MonoResourcePlace | undefined;
  if (input.source.place !== undefined) {
    const placeResult = cloneResourcePlace({
      place: input.source.place,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (placeResult.kind === "error") return { kind: "error" };
    place = placeResult.place;
  }
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: {
        kind: "name",
        name: input.inner.name,
        ...(monoLocalId !== undefined ? { localId: monoLocalId } : {}),
        ...(input.inner.functionId !== undefined ? { functionId: input.inner.functionId } : {}),
        ...(input.inner.parameterId !== undefined ? { parameterId: input.inner.parameterId } : {}),
      },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
      ...(place !== undefined ? { place } : {}),
    },
  };
}

function cloneMemberExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "member" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const receiver = cloneExpression({
    source: input.inner.receiver,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (receiver.kind === "error") return { kind: "error" };
  let memberPlace: MonoResourcePlace | undefined;
  if (input.inner.memberPlace !== undefined) {
    const placeResult = cloneResourcePlace({
      place: input.inner.memberPlace,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (placeResult.kind === "error") return { kind: "error" };
    memberPlace = placeResult.place;
  }
  let place: MonoResourcePlace | undefined;
  if (input.source.place !== undefined) {
    const placeResult = cloneResourcePlace({
      place: input.source.place,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (placeResult.kind === "error") return { kind: "error" };
    place = placeResult.place;
  }
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: {
        kind: "member",
        receiver: receiver.expression,
        ...(input.inner.fieldId !== undefined ? { fieldId: input.inner.fieldId } : {}),
        ...(memberPlace !== undefined ? { memberPlace } : {}),
      },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
      ...(place !== undefined ? { place } : {}),
    },
  };
}

function cloneObjectExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "object" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const fields: MonoObjectField[] = [];
  for (const field of input.inner.fields) {
    const clonedValue = cloneExpression({
      source: field.value,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (clonedValue.kind === "error") return { kind: "error" };
    fields.push({
      ...(field.fieldId !== undefined ? { fieldId: field.fieldId } : {}),
      name: field.name,
      value: clonedValue.expression,
      sourceOrigin: String(field.sourceOrigin),
    });
  }
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: {
        kind: "object",
        ...(input.inner.typeId !== undefined ? { typeId: input.inner.typeId } : {}),
        fields,
      },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

function cloneAttemptExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "attempt" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const fallible = cloneExpression({
    source: input.inner.attempt.fallibleExpression,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (fallible.kind === "error") return { kind: "error" };
  let alternative: MonoExpression | undefined;
  if (input.inner.attempt.alternativeExpression !== undefined) {
    const clonedAlternative = cloneExpression({
      source: input.inner.attempt.alternativeExpression,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (clonedAlternative.kind === "error") return { kind: "error" };
    alternative = clonedAlternative.expression;
  }
  const declaredInputPlaces: MonoResourcePlace[] = [];
  for (const declaredPlace of input.inner.attempt.declaredInputPlaces) {
    const placeResult = cloneResourcePlace({
      place: declaredPlace,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (placeResult.kind === "error") return { kind: "error" };
    declaredInputPlaces.push(placeResult.place);
  }
  const attempt: MonoAttempt = {
    attemptId: remapOwnedProofId(input.instance.instanceId, input.inner.attempt.attemptId),
    attemptExpressionId: monoExpressionIdFor(
      input.transformContext.remap.instanceId,
      input.inner.attempt.attemptExpressionId,
    ),
    fallibleExpression: fallible.expression,
    ...(alternative !== undefined ? { alternativeExpression: alternative } : {}),
    declaredInputPlaces,
    sourceOrigin: input.sourceOrigin,
  };
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: { kind: "attempt", attempt },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

function cloneValidationCreationExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "validationCreation" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const validation = cloneValidation({
    validation: input.inner.validation,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (validation.kind === "error") return { kind: "error" };
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: { kind: "validationCreation", validation: validation.validation },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

export function cloneValidation(input: {
  readonly validation: HirValidation;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): { readonly kind: "ok"; readonly validation: MonoValidation } | { readonly kind: "error" } {
  const sourcePlace = cloneResourcePlace({
    place: input.validation.sourcePlace,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (sourcePlace.kind === "error") return { kind: "error" };
  const pendingResultPlace = cloneResourcePlace({
    place: input.validation.pendingResultPlace,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (pendingResultPlace.kind === "error") return { kind: "error" };
  const okType = normalizeMonoCheckedTypeForClone({
    type: input.validation.okPayloadType,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (okType.kind === "error") return { kind: "error" };
  const errType = normalizeMonoCheckedTypeForClone({
    type: input.validation.errPayloadType,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (errType.kind === "error") return { kind: "error" };
  let resultLocalId: MonoLocalId | undefined;
  if (input.validation.resultLocalId !== undefined) {
    const remapped = input.transformContext.remap.localRemap.get(input.validation.resultLocalId);
    if (remapped === undefined) {
      return {
        kind: "error",
      };
    }
    resultLocalId = remapped;
  }
  const validation: MonoValidation = {
    validationId: remapOwnedProofId(input.instance.instanceId, input.validation.validationId),
    validationExpressionId: monoExpressionIdFor(
      input.transformContext.remap.instanceId,
      input.validation.validationExpressionId,
    ),
    sourcePlace: sourcePlace.place,
    pendingResultPlace: pendingResultPlace.place,
    ...(resultLocalId !== undefined ? { resultLocalId } : {}),
    validatedBufferTypeId: input.validation.validatedBufferTypeId,
    okPayloadType: okType.type,
    errPayloadType: errType.type,
    sourceOrigin: String(input.validation.sourceOrigin),
  };
  return { kind: "ok", validation };
}

function cloneUnaryExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "unary" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const operand = cloneExpression({
    source: input.inner.operand,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (operand.kind === "error") return { kind: "error" };
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: { kind: "unary", operator: input.inner.operator, operand: operand.expression },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

function cloneBinaryExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "binary" | "comparison" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    substitution: input.substitution,
    transformContext: input.transformContext,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  const left = cloneExpression({
    source: input.inner.left,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (left.kind === "error") return { kind: "error" };
  const right = cloneExpression({
    source: input.inner.right,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: input.transformContext,
  });
  if (right.kind === "error") return { kind: "error" };
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: {
        kind: input.inner.kind,
        operator: input.inner.operator,
        left: left.expression,
        right: right.expression,
      },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}
