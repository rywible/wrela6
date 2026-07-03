import type {
  HirCallArgument,
  HirCallExpression,
  HirExpression,
  TypedHirProgram,
} from "../hir/hir";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { cloneExpression, type CloneExpressionResult } from "./function-expression-cloner";
import { type MonoOutgoingEdge, type MutableMonoFunctionRemap } from "./function-instantiator-body";
import { ownerParametersForFunction } from "./function-instantiator-shell";
import {
  cloneResourcePlace,
  concretizeResourceKindForClone,
  normalizeMonoCheckedTypeForClone,
} from "./function-place-cloner";
import { canonicalFunctionInstanceId } from "./instantiation-key";
import {
  type MonoCallArgument,
  type MonoCallExpression,
  type MonoCheckedType,
  type MonoExpression,
  type MonoExpressionId,
  type MonoFunctionInstance,
  type MonoResourcePlace,
} from "./mono-hir";
import { type MonoResourceKindConcretizationContext } from "./resource-kind-concretizer";
import { buildMonoSubstitution, type MonoSubstitution } from "./substitution";
export function cloneCallExpression(input: {
  readonly inner: Extract<HirExpression["kind"], { readonly kind: "call" }>;
  readonly expressionId: MonoExpressionId;
  readonly source: HirExpression;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneExpressionResult {
  const monoType = normalizeMonoCheckedTypeForClone({
    type: input.source.type,
    substitution: input.substitution,
    program: input.program,
    diagnostics: input.diagnostics,
  });
  if (monoType.kind === "error") return { kind: "error" };
  const call = cloneCall({
    call: input.inner.call,
    callExpressionId: input.expressionId,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (call.kind === "error") return { kind: "error" };
  const resourceKindSubstitution = callResourceKindSubstitution({
    call: input.inner.call,
    clonedCall: call.call,
    program: input.program,
    baseSubstitution: input.substitution,
    diagnostics: input.diagnostics,
  });
  if (resourceKindSubstitution.kind === "error") return { kind: "error" };
  const monoKind = concretizeResourceKindForClone({
    kind: input.source.resourceKind,
    type: monoType.type,
    context: {
      ...input.context,
      substitution: resourceKindSubstitution.substitution,
    },
    substitution: resourceKindSubstitution.substitution,
    diagnostics: input.diagnostics,
  });
  if (monoKind.kind === "error") return { kind: "error" };
  return {
    kind: "ok",
    expression: {
      expressionId: input.expressionId,
      kind: { kind: "call", call: call.call },
      type: monoType.type,
      resourceKind: monoKind.value,
      sourceOrigin: input.sourceOrigin,
    },
  };
}

function callResourceKindSubstitution(input: {
  readonly call: HirCallExpression;
  readonly clonedCall: MonoCallExpression;
  readonly program: TypedHirProgram;
  readonly baseSubstitution: MonoSubstitution;
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly substitution: MonoSubstitution } | { readonly kind: "error" } {
  if (input.call.calleeFunctionId === undefined) {
    return { kind: "ok", substitution: input.baseSubstitution };
  }
  const sourceFunction = input.program.functions.get(input.call.calleeFunctionId);
  if (sourceFunction === undefined) {
    input.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_MISSING_REACHABLE_FUNCTION",
        message: "Call target function is missing from the program during body cloning.",
        ownerKey: `function:${input.call.calleeFunctionId}`,
        rootCauseKey: "source-function",
        stableDetail: `missing-call-target:${input.call.calleeFunctionId}`,
        sourceOrigin:
          input.call.sourceOrigin !== undefined
            ? String(input.call.sourceOrigin)
            : String(input.baseSubstitution.sourceOrigin),
      }),
    );
    return { kind: "error" };
  }
  const callSubstitution = buildMonoSubstitution({
    ownerParameters: ownerParametersForFunction(input.program, sourceFunction),
    ownerArguments: input.clonedCall.ownerTypeArguments,
    functionParameters: sourceFunction.declaredTypeParameters,
    functionArguments: input.clonedCall.typeArguments,
    sourceOrigin: input.call.sourceOrigin ?? sourceFunction.sourceOrigin,
  });
  if (callSubstitution.kind === "error") {
    input.diagnostics.push(...callSubstitution.diagnostics);
    return { kind: "error" };
  }
  const map = new Map(input.baseSubstitution.map);
  for (const [key, value] of callSubstitution.substitution.map) {
    map.set(key, value);
  }
  return {
    kind: "ok",
    substitution: {
      map,
      sourceOrigin: callSubstitution.substitution.sourceOrigin,
    },
  };
}

export function cloneCall(input: {
  readonly call: HirCallExpression;
  readonly callExpressionId: MonoExpressionId | undefined;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly call: MonoCallExpression } | { readonly kind: "error" } {
  const callee = cloneExpression({
    source: input.call.callee,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (callee.kind === "error") return { kind: "error" };
  let receiver: MonoExpression | undefined;
  if (input.call.receiver !== undefined) {
    const clonedReceiver = cloneExpression({
      source: input.call.receiver,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedReceiver.kind === "error") return { kind: "error" };
    receiver = clonedReceiver.expression;
  }
  const clonedArguments: MonoCallArgument[] = [];
  for (const callArgument of input.call.arguments) {
    const clonedArgument = cloneCallArgument({
      argument: callArgument,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.remap,
      program: input.program,
      context: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    });
    if (clonedArgument.kind === "error") return { kind: "error" };
    clonedArguments.push(clonedArgument.argument);
  }
  const ownerTypeArguments: MonoCheckedType[] = [];
  for (const ownerArg of input.call.ownerTypeArguments) {
    const normalized = normalizeMonoCheckedTypeForClone({
      type: ownerArg,
      substitution: input.substitution,
      program: input.program,
      diagnostics: input.diagnostics,
    });
    if (normalized.kind === "error") return { kind: "error" };
    ownerTypeArguments.push(normalized.type);
  }
  const typeArguments: MonoCheckedType[] = [];
  for (const typeArg of input.call.typeArguments) {
    const normalized = normalizeMonoCheckedTypeForClone({
      type: typeArg,
      substitution: input.substitution,
      program: input.program,
      diagnostics: input.diagnostics,
    });
    if (normalized.kind === "error") return { kind: "error" };
    typeArguments.push(normalized.type);
  }
  const platformBinding =
    input.call.calleeFunctionId !== undefined
      ? input.program.monoClosure.certifiedPlatformBindings.get(input.call.calleeFunctionId)
      : undefined;
  const resolvedTarget =
    input.call.calleeFunctionId !== undefined &&
    input.call.recovered !== true &&
    platformBinding === undefined
      ? {
          kind: "sourceFunction" as const,
          targetFunctionInstanceId: canonicalFunctionInstanceId({
            functionId: input.call.calleeFunctionId,
            ...(input.call.ownerTypeId !== undefined
              ? { ownerTypeId: input.call.ownerTypeId }
              : {}),
            ownerTypeArguments,
            functionTypeArguments: typeArguments,
          }),
        }
      : undefined;
  const call: MonoCallExpression = {
    callee: callee.expression,
    ...(resolvedTarget !== undefined ? { resolvedTarget } : {}),
    ...(input.call.calleeFunctionId !== undefined
      ? { calleeFunctionId: input.call.calleeFunctionId }
      : {}),
    ...(input.call.compilerIntrinsic !== undefined
      ? { compilerIntrinsic: input.call.compilerIntrinsic }
      : {}),
    ...(input.call.ownerTypeId !== undefined ? { ownerTypeId: input.call.ownerTypeId } : {}),
    ownerTypeArguments,
    ownerTypeArgumentSource: input.call.ownerTypeArgumentSource,
    arguments: clonedArguments,
    typeArguments,
    ...(receiver !== undefined ? { receiver } : {}),
    ...(input.call.sourceOrigin !== undefined
      ? { sourceOrigin: String(input.call.sourceOrigin) }
      : {}),
    ...(input.call.recovered === true ? { recovered: true } : {}),
  };
  if (input.call.calleeFunctionId !== undefined && input.call.recovered !== true) {
    const targetKey = String(
      canonicalFunctionInstanceId({
        functionId: input.call.calleeFunctionId,
        ...(input.call.ownerTypeId !== undefined ? { ownerTypeId: input.call.ownerTypeId } : {}),
        ownerTypeArguments,
        functionTypeArguments: typeArguments,
      }),
    );
    input.outgoingEdges.push({
      source: { kind: "function", functionId: input.instance.instanceId },
      targetKind: "function",
      targetKey,
      ...(input.call.sourceOrigin !== undefined
        ? { sourceOrigin: String(input.call.sourceOrigin) }
        : { sourceOrigin: String(input.instance.sourceOrigin) }),
      ...(input.callExpressionId !== undefined ? { callExpressionId: input.callExpressionId } : {}),
      targetFunctionId: input.call.calleeFunctionId,
      ...(input.call.ownerTypeId !== undefined
        ? { targetOwnerTypeId: input.call.ownerTypeId }
        : {}),
      targetOwnerTypeArguments: ownerTypeArguments,
      targetFunctionTypeArguments: typeArguments,
    });
  } else if (
    (input.call.calleeFunctionId === undefined || input.call.recovered === true) &&
    (input.call.compilerIntrinsic === undefined || input.call.recovered === true)
  ) {
    input.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_UNRESOLVED_CALL_TARGET",
        message:
          "Call expression has unresolved or recovered callee; no outgoing function edge emitted.",
        ownerKey: `function:${input.instance.sourceFunctionId}`,
        rootCauseKey: "call-target",
        stableDetail:
          input.call.calleeFunctionId === undefined
            ? `unresolved:${String(callee.expression.expressionId)}`
            : `recovered:${input.call.calleeFunctionId}`,
        sourceOrigin:
          input.call.sourceOrigin !== undefined
            ? String(input.call.sourceOrigin)
            : String(input.instance.sourceOrigin),
      }),
    );
  }
  return { kind: "ok", call };
}

function cloneCallArgument(input: {
  readonly argument: HirCallArgument;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly argument: MonoCallArgument } | { readonly kind: "error" } {
  const expression = cloneExpression({
    source: input.argument.expression,
    instance: input.instance,
    substitution: input.substitution,
    remap: input.remap,
    program: input.program,
    context: input.context,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  });
  if (expression.kind === "error") return { kind: "error" };
  let place: MonoResourcePlace | undefined;
  if (input.argument.place !== undefined) {
    const placeResult = cloneResourcePlace({
      place: input.argument.place,
      instance: input.instance,
      substitution: input.substitution,
      context: input.context,
      program: input.program,
      remap: input.remap,
      diagnostics: input.diagnostics,
    });
    if (placeResult.kind === "error") return { kind: "error" };
    place = placeResult.place;
  }
  return {
    kind: "ok",
    argument: {
      ...(input.argument.name !== undefined ? { name: input.argument.name } : {}),
      ...(input.argument.parameterId !== undefined
        ? { parameterId: input.argument.parameterId }
        : {}),
      expression: expression.expression,
      ...(input.argument.mode !== undefined ? { mode: input.argument.mode } : {}),
      ...(place !== undefined ? { place } : {}),
    },
  };
}
