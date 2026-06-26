import type { HirOriginId } from "../hir/ids";
import type { FunctionId, TargetTypeId, TypeId } from "../semantic/ids";
import type {
  CheckedConstructorKindRule,
  CheckedTargetTypeKind,
} from "../semantic/surface/mono-closure";
import type { ResourceKindDerivationRule } from "../semantic/surface/resource-kind";
import type { CheckedType, TypeConstructorId } from "../semantic/surface/type-model";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import { type MonoDiagnostic, monoDiagnostic } from "./diagnostics";
import { type MonoInstanceId, monoInstanceId } from "./ids";
import { type MonoCheckedType } from "./mono-hir";

export interface MonoTypeNormalizationContext {
  readonly targetTypeKinds: {
    get(targetTypeId: TargetTypeId): CheckedTargetTypeKind | object | undefined;
  };
  readonly constructorKindRules: {
    get(
      constructor: TypeConstructorId,
    ): CheckedConstructorKindRule | { readonly rule: ResourceKindDerivationRule } | undefined;
  };
  readonly sourceOrigin: HirOriginId;
}

export type NormalizeResult =
  | { readonly kind: "ok"; readonly type: MonoCheckedType }
  | {
      readonly kind: "error";
      readonly type: MonoCheckedType;
      readonly diagnostics: readonly MonoDiagnostic[];
    };

export function normalizeMonoCheckedType(
  type: CheckedType,
  context: MonoTypeNormalizationContext,
): NormalizeResult {
  switch (type.kind) {
    case "core":
      return { kind: "ok", type: type as MonoCheckedType };
    case "source": {
      const rule = context.constructorKindRules.get({ kind: "source", typeId: type.typeId });
      if (rule === undefined) {
        return {
          kind: "error",
          type: type as MonoCheckedType,
          diagnostics: [
            buildTypeDiagnostic({
              type,
              code: "MONO_MISSING_CONSTRUCTOR_KIND_RULE",
              message: "Cannot monomorphize a source type without a constructor kind rule.",
              rootCauseKey: "constructor-kind-rule",
            }),
          ],
        };
      }
      return { kind: "ok", type: type as MonoCheckedType };
    }
    case "genericParameter":
      return {
        kind: "error",
        type: type as MonoCheckedType,
        diagnostics: [
          buildTypeDiagnostic({
            type,
            code: "MONO_UNRESOLVED_TYPE_PARAMETER",
            message: "Cannot monomorphize a type that still contains a generic parameter.",
            rootCauseKey: "substitution",
          }),
        ],
      };
    case "error":
      return {
        kind: "error",
        type: type as MonoCheckedType,
        diagnostics: [
          buildTypeDiagnostic({
            type,
            code: "MONO_UNRESOLVED_RESOURCE_KIND",
            message: "Cannot monomorphize a type that already errored during type checking.",
            rootCauseKey: "resource-kind",
          }),
        ],
      };
    case "applied": {
      if (type.resourceKind.kind !== "concrete") {
        return {
          kind: "error",
          type: type as MonoCheckedType,
          diagnostics: [
            buildTypeDiagnostic({
              type,
              code: "MONO_UNRESOLVED_RESOURCE_KIND",
              message: "Cannot monomorphize an applied type whose resource kind is not concrete.",
              rootCauseKey: "resource-kind",
            }),
          ],
        };
      }

      const argumentDiagnostics: MonoDiagnostic[] = [];
      for (const argument of type.arguments) {
        const argumentResult = normalizeMonoCheckedType(argument, context);
        if (argumentResult.kind === "error") {
          argumentDiagnostics.push(...argumentResult.diagnostics);
        }
      }
      if (argumentDiagnostics.length > 0) {
        return {
          kind: "error",
          type: type as MonoCheckedType,
          diagnostics: argumentDiagnostics,
        };
      }

      if (type.constructor.kind === "target") {
        const targetKind = context.targetTypeKinds.get(type.constructor.targetTypeId);
        if (targetKind === undefined) {
          return {
            kind: "error",
            type: type as MonoCheckedType,
            diagnostics: [
              buildTypeDiagnostic({
                type,
                code: "MONO_MISSING_TARGET_TYPE_KIND",
                message:
                  "Cannot monomorphize an applied type whose target constructor has no declared kind.",
                rootCauseKey: "target-type-kind",
              }),
            ],
          };
        }
      }

      const rule = context.constructorKindRules.get(type.constructor);
      if (rule === undefined) {
        return {
          kind: "error",
          type: type as MonoCheckedType,
          diagnostics: [
            buildTypeDiagnostic({
              type,
              code: "MONO_MISSING_CONSTRUCTOR_KIND_RULE",
              message: "Cannot monomorphize an applied type without a constructor kind rule.",
              rootCauseKey: "constructor-kind-rule",
            }),
          ],
        };
      }

      return { kind: "ok", type: type as MonoCheckedType };
    }
    case "target": {
      const targetKind = context.targetTypeKinds.get(type.targetTypeId);
      if (targetKind === undefined) {
        return {
          kind: "error",
          type: type as MonoCheckedType,
          diagnostics: [
            buildTypeDiagnostic({
              type,
              code: "MONO_MISSING_TARGET_TYPE_KIND",
              message: "Cannot monomorphize a target type without a declared kind.",
              rootCauseKey: "target-type-kind",
            }),
          ],
        };
      }
      return { kind: "ok", type: type as MonoCheckedType };
    }
  }
}

function buildTypeDiagnostic(input: {
  type: CheckedType;
  code:
    | "MONO_UNRESOLVED_TYPE_PARAMETER"
    | "MONO_UNRESOLVED_RESOURCE_KIND"
    | "MONO_MISSING_CONSTRUCTOR_KIND_RULE"
    | "MONO_MISSING_TARGET_TYPE_KIND";
  message: string;
  rootCauseKey: string;
}): MonoDiagnostic {
  const fingerprint = checkedTypeFingerprint(input.type);
  return monoDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: `mono-type:${fingerprint}`,
    rootCauseKey: input.rootCauseKey,
    stableDetail: fingerprint,
  });
}

export function canonicalFunctionInstanceId(input: {
  functionId: FunctionId;
  ownerTypeId?: TypeId;
  ownerTypeArguments: readonly MonoCheckedType[];
  functionTypeArguments: readonly MonoCheckedType[];
}): MonoInstanceId {
  const ownerTypeSegment = input.ownerTypeId !== undefined ? `${input.ownerTypeId}` : "none";
  return monoInstanceId(
    `fn:${input.functionId}|ownerType:${ownerTypeSegment}|owner:${serializeTypeList(
      input.ownerTypeArguments,
    )}|fn:${serializeTypeList(input.functionTypeArguments)}`,
  );
}

export function canonicalTypeInstanceId(input: {
  typeId: TypeId;
  typeArguments: readonly MonoCheckedType[];
}): MonoInstanceId {
  return monoInstanceId(`type:${input.typeId}|args:${serializeTypeList(input.typeArguments)}`);
}

function serializeTypeList(types: readonly MonoCheckedType[]): string {
  const parts = types.map((type) => {
    const fingerprint = checkedTypeFingerprint(type);
    return `${fingerprint.length}:${fingerprint}`;
  });
  return `<${parts.join(",")}>`;
}

export function monoAppliedArgumentTypes(
  type: MonoCheckedType & { readonly kind: "applied" },
): readonly MonoCheckedType[] {
  return type.arguments.map((argument) => argument as MonoCheckedType);
}
