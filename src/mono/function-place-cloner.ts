import type {
  HirForIteration,
  HirResourcePlace,
  HirTakeKind,
  HirTakeOperand,
  TypedHirProgram,
} from "../hir/hir";
import { type HirOwnedId } from "../hir/ids";
import type { ConcreteResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { cloneCall } from "./function-call-cloner";
import { cloneExpression, type CloneExpressionResult } from "./function-expression-cloner";
import { type MonoOutgoingEdge, type MutableMonoFunctionRemap } from "./function-instantiator-body";
import { createNormalizationContext, monoLocalIdFor } from "./function-instantiator-shell";
import { type CloneStatementResult } from "./function-statement-cloner";
import { type MonoInstanceId } from "./ids";
import { normalizeMonoCheckedType } from "./instantiation-key";
import {
  type MonoCheckedType,
  type MonoExpression,
  type MonoForIteration,
  type MonoFunctionInstance,
  type MonoInstantiatedProofId,
  type MonoLocalId,
  type MonoPlaceProjection,
  type MonoPlaceRoot,
  type MonoResourcePlace,
  type MonoTakeKind,
  type MonoTakeOperand,
} from "./mono-hir";
import {
  concretizeResourceKind,
  type MonoResourceKindConcretizationContext,
} from "./resource-kind-concretizer";
import { substituteCheckedType, type MonoSubstitution } from "./substitution";
export function cloneForIteration(input: {
  readonly iteration: HirForIteration;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
  readonly program: TypedHirProgram;
  readonly diagnostics: MonoDiagnostic[];
  readonly sourceOrigin: string;
}): { readonly kind: "ok"; readonly iteration: MonoForIteration } | { readonly kind: "error" } {
  switch (input.iteration.kind) {
    case "ordinary":
      return { kind: "ok", iteration: { kind: "ordinary" } };
    case "stream": {
      const itemType = normalizeMonoCheckedTypeForClone({
        type: input.iteration.itemType,
        substitution: input.substitution,
        program: input.program,
        diagnostics: input.diagnostics,
      });
      if (itemType.kind === "error") return { kind: "error" };
      const itemKind = concretizeResourceKindForClone({
        kind: input.iteration.itemResourceKind,
        type: itemType.type,
        context: input.context,
        substitution: input.substitution,
        diagnostics: input.diagnostics,
      });
      if (itemKind.kind === "error") return { kind: "error" };
      return {
        kind: "ok",
        iteration: {
          kind: "stream",
          sessionId: remapOwnedProofId(input.instance.instanceId, input.iteration.sessionId),
          itemBrandId: remapOwnedProofId(input.instance.instanceId, input.iteration.itemBrandId),
          closureObligationId: remapOwnedProofId(
            input.instance.instanceId,
            input.iteration.closureObligationId,
          ),
          itemType: itemType.type,
          itemResourceKind: itemKind.value,
        },
      };
    }
    case "error":
      return { kind: "ok", iteration: { kind: "error" } };
  }
}

export function cloneTakeOperand(input: {
  readonly operand: HirTakeOperand;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly operand: MonoTakeOperand } | { readonly kind: "error" } {
  switch (input.operand.kind) {
    case "place": {
      const place = cloneResourcePlace({
        place: input.operand.place,
        instance: input.instance,
        substitution: input.substitution,
        context: input.context,
        program: input.program,
        remap: input.remap,
        diagnostics: input.diagnostics,
      });
      if (place.kind === "error") return { kind: "error" };
      const expression = cloneExpression({
        source: input.operand.expression,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
      if (expression.kind === "error") return { kind: "error" };
      return {
        kind: "ok",
        operand: { kind: "place", place: place.place, expression: expression.expression },
      };
    }
    case "takeOnlyCall": {
      const call = cloneCall({
        call: input.operand.call,
        callExpressionId: undefined,
        instance: input.instance,
        substitution: input.substitution,
        remap: input.remap,
        program: input.program,
        context: input.context,
        outgoingEdges: input.outgoingEdges,
        diagnostics: input.diagnostics,
      });
      if (call.kind === "error") return { kind: "error" };
      const resultPlace = cloneResourcePlace({
        place: input.operand.resultPlace,
        instance: input.instance,
        substitution: input.substitution,
        context: input.context,
        program: input.program,
        remap: input.remap,
        diagnostics: input.diagnostics,
      });
      if (resultPlace.kind === "error") return { kind: "error" };
      return {
        kind: "ok",
        operand: { kind: "takeOnlyCall", call: call.call, resultPlace: resultPlace.place },
      };
    }
    case "error": {
      let expression: MonoExpression | undefined;
      if (input.operand.expression !== undefined) {
        const cloned = cloneExpression({
          source: input.operand.expression,
          instance: input.instance,
          substitution: input.substitution,
          remap: input.remap,
          program: input.program,
          context: input.context,
          outgoingEdges: input.outgoingEdges,
          diagnostics: input.diagnostics,
        });
        if (cloned.kind === "error") return { kind: "error" };
        expression = cloned.expression;
      }
      return {
        kind: "ok",
        operand: { kind: "error", ...(expression !== undefined ? { expression } : {}) },
      };
    }
  }
}

export function cloneTakeKind(input: {
  readonly takeKind: HirTakeKind;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
  readonly sourceOrigin: string;
}): { readonly kind: "ok"; readonly takeKind: MonoTakeKind } | { readonly kind: "error" } {
  switch (input.takeKind.kind) {
    case "stream": {
      const itemType = normalizeMonoCheckedTypeForClone({
        type: input.takeKind.itemType,
        substitution: input.substitution,
        program: input.program,
        diagnostics: input.diagnostics,
      });
      if (itemType.kind === "error") return { kind: "error" };
      const itemKind = concretizeResourceKindForClone({
        kind: input.takeKind.itemResourceKind,
        type: itemType.type,
        context: input.context,
        substitution: input.substitution,
        diagnostics: input.diagnostics,
      });
      if (itemKind.kind === "error") return { kind: "error" };
      return {
        kind: "ok",
        takeKind: {
          kind: "stream",
          sessionId: remapOwnedProofId(input.instance.instanceId, input.takeKind.sessionId),
          itemBrandId: remapOwnedProofId(input.instance.instanceId, input.takeKind.itemBrandId),
          closureObligationId: remapOwnedProofId(
            input.instance.instanceId,
            input.takeKind.closureObligationId,
          ),
          itemType: itemType.type,
          itemResourceKind: itemKind.value,
        },
      };
    }
    case "buffer": {
      const bufferPlace = cloneResourcePlace({
        place: input.takeKind.bufferPlace,
        instance: input.instance,
        substitution: input.substitution,
        context: input.context,
        program: input.program,
        remap: input.remap,
        diagnostics: input.diagnostics,
      });
      if (bufferPlace.kind === "error") return { kind: "error" };
      return {
        kind: "ok",
        takeKind: {
          kind: "buffer",
          bufferPlace: bufferPlace.place,
          obligationId: remapOwnedProofId(input.instance.instanceId, input.takeKind.obligationId),
        },
      };
    }
    case "validatedBuffer":
      return {
        kind: "ok",
        takeKind: {
          kind: "validatedBuffer",
          sessionId: remapOwnedProofId(input.instance.instanceId, input.takeKind.sessionId),
          memberBrandId: remapOwnedProofId(input.instance.instanceId, input.takeKind.memberBrandId),
          closureObligationId: remapOwnedProofId(
            input.instance.instanceId,
            input.takeKind.closureObligationId,
          ),
        },
      };
    case "error":
      return { kind: "ok", takeKind: { kind: "error" } };
  }
}

export function cloneResourcePlace(input: {
  readonly place: HirResourcePlace;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly context: MonoResourceKindConcretizationContext;
  readonly program: TypedHirProgram;
  readonly remap: MutableMonoFunctionRemap;
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly place: MonoResourcePlace } | { readonly kind: "error" } {
  const substituted = substituteCheckedType(input.place.type, input.substitution);
  if (substituted.diagnostics.length > 0) {
    input.diagnostics.push(...substituted.diagnostics);
    return { kind: "error" };
  }
  const normalized = normalizeMonoCheckedType(
    substituted.type,
    createNormalizationContext(input.program),
  );
  if (normalized.kind === "error") {
    input.diagnostics.push(...normalized.diagnostics);
    return { kind: "error" };
  }
  const monoType = normalized.type;
  const kindResult = concretizeResourceKind({
    kind: input.place.resourceKind,
    ...(monoType.kind === "applied" ? { appliedType: monoType } : {}),
    ...(monoType.kind === "target" ? { targetTypeId: monoType.targetTypeId } : {}),
    context: { ...input.context, substitution: input.substitution },
  });
  if (kindResult.kind === "error") {
    input.diagnostics.push(kindResult.diagnostic);
    return { kind: "error" };
  }
  const root = clonePlaceRoot(input.place.root, input.remap, input.instance.instanceId);
  const projection = input.place.projection.map(clonePlaceProjection);
  let localId: MonoLocalId | undefined;
  if (input.place.localId !== undefined) {
    const remapped = input.remap.localRemap.get(input.place.localId);
    if (remapped !== undefined) {
      localId = remapped;
    }
  }
  return {
    kind: "ok",
    place: {
      placeId: remapOwnedProofId(input.instance.instanceId, input.place.placeId),
      canonicalKey: input.place.canonicalKey,
      root,
      projection,
      type: monoType,
      resourceKind: kindResult.value,
      sourceOrigin: String(input.place.sourceOrigin),
      kind: input.place.kind,
      ...(input.place.parameterId !== undefined ? { parameterId: input.place.parameterId } : {}),
      ...(localId !== undefined ? { localId } : {}),
      ...(input.place.fieldId !== undefined ? { fieldId: input.place.fieldId } : {}),
    },
  };
}

function clonePlaceRoot(
  root: HirResourcePlace["root"],
  remap: MutableMonoFunctionRemap,
  instanceId: MonoInstanceId,
): MonoPlaceRoot {
  switch (root.kind) {
    case "receiver":
      return { kind: "receiver", parameterId: root.parameterId };
    case "parameter":
      return { kind: "parameter", parameterId: root.parameterId };
    case "local": {
      const remapped = remap.localRemap.get(root.localId);
      return {
        kind: "local",
        localId: remapped ?? monoLocalIdFor(remap.instanceId, root.localId),
      };
    }
    case "temporary":
      return { kind: "temporary", ordinal: root.ordinal };
    case "imageDevice":
      return { kind: "imageDevice", imageId: root.imageId, fieldId: root.fieldId };
    case "validationPayload":
      return {
        kind: "validationPayload",
        validationId: {
          owner: { kind: "function", instanceId },
          hirId: root.validationId.id,
          instanceId,
        },
      };
    case "error":
      return { kind: "error" };
  }
}

function clonePlaceProjection(
  projection: HirResourcePlace["projection"][number],
): MonoPlaceProjection {
  switch (projection.kind) {
    case "field":
      return { kind: "field", fieldId: projection.fieldId };
    case "deref":
      return { kind: "deref" };
    case "variant":
      return { kind: "variant", name: projection.name };
  }
}

export function remapOwnedProofId<IdValue>(
  instanceId: MonoInstanceId,
  id: HirOwnedId<IdValue>,
): MonoInstantiatedProofId<IdValue> {
  return {
    owner: { kind: "function", instanceId },
    hirId: id.id,
    instanceId,
  };
}

export function normalizeMonoCheckedTypeForClone(input: {
  readonly type: CheckedType;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly type: MonoCheckedType } | { readonly kind: "error" } {
  const substituted = substituteCheckedType(input.type, input.substitution);
  if (substituted.diagnostics.length > 0) {
    input.diagnostics.push(...substituted.diagnostics);
    return { kind: "error" };
  }
  const normalized = normalizeMonoCheckedType(
    substituted.type,
    createNormalizationContext(input.program),
  );
  if (normalized.kind === "error") {
    input.diagnostics.push(...normalized.diagnostics);
    return { kind: "error" };
  }
  return { kind: "ok", type: normalized.type };
}

export function concretizeResourceKindForClone(input: {
  readonly kind: import("../semantic/surface/resource-kind").CheckedResourceKind;
  readonly type: MonoCheckedType;
  readonly context: MonoResourceKindConcretizationContext;
  readonly substitution: MonoSubstitution;
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly value: ConcreteResourceKind } | { readonly kind: "error" } {
  const context = { ...input.context, substitution: input.substitution };
  const result = concretizeResourceKind({
    kind: input.kind,
    ...(input.type.kind === "applied" ? { appliedType: input.type } : {}),
    ...(input.type.kind === "target" ? { targetTypeId: input.type.targetTypeId } : {}),
    context,
  });
  if (result.kind === "error") {
    input.diagnostics.push(result.diagnostic);
    return { kind: "error" };
  }
  return { kind: "ok", value: result.value };
}

export function reportRecovery(input: {
  readonly diagnostics: MonoDiagnostic[];
  readonly instance: MonoFunctionInstance;
  readonly sourceOrigin: string;
  readonly reason: string;
}): CloneStatementResult {
  input.diagnostics.push(
    monoDiagnostic({
      severity: "error",
      code: "MONO_REACHABLE_HIR_RECOVERY",
      message: "A reachable HIR recovery node cannot be monomorphized.",
      ownerKey: `function:${input.instance.sourceFunctionId}`,
      rootCauseKey: "hir-recovery",
      stableDetail: `recovery-node:${input.reason}`,
      sourceOrigin: input.sourceOrigin,
    }),
  );
  return { kind: "error" };
}

export function reportRecoveryExpression(input: {
  readonly diagnostics: MonoDiagnostic[];
  readonly instance: MonoFunctionInstance;
  readonly sourceOrigin: string;
  readonly reason: string;
}): CloneExpressionResult {
  input.diagnostics.push(
    monoDiagnostic({
      severity: "error",
      code: "MONO_REACHABLE_HIR_RECOVERY",
      message: "A reachable HIR recovery expression cannot be monomorphized.",
      ownerKey: `function:${input.instance.sourceFunctionId}`,
      rootCauseKey: "hir-recovery",
      stableDetail: `recovery-expression:${input.reason}`,
      sourceOrigin: input.sourceOrigin,
    }),
  );
  return { kind: "error" };
}
