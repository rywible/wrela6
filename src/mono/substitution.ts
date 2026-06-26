import { type HirOriginId } from "../hir/ids";
import type { CoreTypeId } from "../semantic/ids";
import type { TypeParameterOwner } from "../semantic/item-index/item-records";
import {
  type CheckedResourceKind,
  concreteKind,
  type ConcreteResourceKind,
  derivedKind,
  errorKind,
  type TypeParameterKey,
} from "../semantic/surface/resource-kind";
import { appliedType, type CheckedType, errorCheckedType } from "../semantic/surface/type-model";
import { type MonoDiagnostic, monoDiagnostic } from "./diagnostics";
import type { MonoCheckedType, MonoProofExpression, MonoRequirementExpression } from "./mono-hir";

export interface MonoSubstitution {
  readonly map: ReadonlyMap<string, MonoCheckedType>;
  readonly sourceOrigin: HirOriginId;
}

export interface BuildMonoSubstitutionInput {
  readonly ownerParameters: readonly TypeParameterKey[];
  readonly ownerArguments: readonly MonoCheckedType[];
  readonly functionParameters: readonly TypeParameterKey[];
  readonly functionArguments: readonly MonoCheckedType[];
  readonly sourceOrigin: HirOriginId;
}

export type BuildMonoSubstitutionResult =
  | { readonly kind: "ok"; readonly substitution: MonoSubstitution }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function buildMonoSubstitution(
  input: BuildMonoSubstitutionInput,
): BuildMonoSubstitutionResult {
  if (input.ownerParameters.length !== input.ownerArguments.length) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_OWNER_TYPE_ARGUMENT_ARITY_MISMATCH",
          message: "Owner type parameter arity mismatch",
          ownerKey: ownerParametersOwnerKey(input.ownerParameters),
          rootCauseKey: "owner-arity",
          stableDetail: `owner:${input.ownerParameters.length}:${input.ownerArguments.length}`,
          sourceOrigin: String(input.sourceOrigin),
        }),
      ],
    };
  }
  if (input.functionParameters.length !== input.functionArguments.length) {
    return {
      kind: "error",
      diagnostics: [
        monoDiagnostic({
          severity: "error",
          code: "MONO_GENERIC_ARITY_MISMATCH",
          message: "Function type parameter arity mismatch",
          ownerKey: functionParametersOwnerKey(input.functionParameters),
          rootCauseKey: "generic-arity",
          stableDetail: `function:${input.functionParameters.length}:${input.functionArguments.length}`,
          sourceOrigin: String(input.sourceOrigin),
        }),
      ],
    };
  }

  for (let index = 1; index < input.ownerParameters.length; index++) {
    if (input.ownerParameters[index]!.index < input.ownerParameters[index - 1]!.index) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID",
            message: "Owner type parameters are not in non-decreasing index order",
            ownerKey: parameterKeyString(input.ownerParameters[index]!),
            rootCauseKey: "generic-parameter-order",
            stableDetail: `owner-order:${input.ownerParameters[index - 1]!.index}->${input.ownerParameters[index]!.index}`,
            sourceOrigin: String(input.sourceOrigin),
          }),
        ],
      };
    }
  }
  for (let index = 1; index < input.functionParameters.length; index++) {
    if (input.functionParameters[index]!.index < input.functionParameters[index - 1]!.index) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID",
            message: "Function type parameters are not in non-decreasing index order",
            ownerKey: parameterKeyString(input.functionParameters[index]!),
            rootCauseKey: "generic-parameter-order",
            stableDetail: `function-order:${input.functionParameters[index - 1]!.index}->${input.functionParameters[index]!.index}`,
            sourceOrigin: String(input.sourceOrigin),
          }),
        ],
      };
    }
  }

  const map = new Map<string, MonoCheckedType>();
  for (let index = 0; index < input.ownerParameters.length; index++) {
    const key = parameterKeyString(input.ownerParameters[index]!);
    if (map.has(key)) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_DUPLICATE_CANONICAL_INSTANCE_KEY",
            message: "Duplicate type parameter key in substitution",
            ownerKey: key,
            rootCauseKey: "canonical-key",
            stableDetail: `owner-dup:${key}`,
            sourceOrigin: String(input.sourceOrigin),
          }),
        ],
      };
    }
    map.set(key, input.ownerArguments[index]!);
  }
  for (let index = 0; index < input.functionParameters.length; index++) {
    const key = parameterKeyString(input.functionParameters[index]!);
    if (map.has(key)) {
      return {
        kind: "error",
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_DUPLICATE_CANONICAL_INSTANCE_KEY",
            message: "Duplicate type parameter key in substitution",
            ownerKey: key,
            rootCauseKey: "canonical-key",
            stableDetail: `function-dup:${key}`,
            sourceOrigin: String(input.sourceOrigin),
          }),
        ],
      };
    }
    map.set(key, input.functionArguments[index]!);
  }

  return { kind: "ok", substitution: { map, sourceOrigin: input.sourceOrigin } };
}

function ownerParametersOwnerKey(parameters: readonly TypeParameterKey[]): string {
  if (parameters.length === 0) return "owner:none";
  return parameterKeyString(parameters[0]!);
}

function functionParametersOwnerKey(parameters: readonly TypeParameterKey[]): string {
  if (parameters.length === 0) return "function:none";
  return parameterKeyString(parameters[0]!);
}

export function parameterKeyString(parameter: TypeParameterKey): string {
  return `${ownerKeyString(parameter.owner)}:${parameter.index}`;
}

export function ownerKeyString(owner: TypeParameterOwner): string {
  if (owner.kind === "item") return `item:${String(owner.itemId)}`;
  return `function:${String(owner.itemId)}:${String(owner.functionId)}`;
}

export interface SubstituteCheckedTypeResult {
  readonly type: CheckedType;
  readonly diagnostics: readonly MonoDiagnostic[];
}

export function substituteCheckedType(
  type: CheckedType,
  substitution: MonoSubstitution,
): SubstituteCheckedTypeResult {
  switch (type.kind) {
    case "core":
    case "source":
    case "target":
      return { type, diagnostics: [] };
    case "genericParameter": {
      const key = parameterKeyString(type.parameter);
      const replaced = substitution.map.get(key);
      if (replaced !== undefined) {
        return { type: replaced, diagnostics: [] };
      }
      return {
        type: errorCheckedType(),
        diagnostics: [
          monoDiagnostic({
            severity: "error",
            code: "MONO_UNRESOLVED_TYPE_PARAMETER",
            message: "Unresolved type parameter during substitution",
            ownerKey: key,
            rootCauseKey: "substitution",
            stableDetail: `unresolved:${key}`,
            sourceOrigin: String(substitution.sourceOrigin),
          }),
        ],
      };
    }
    case "applied": {
      const argumentDiagnostics: MonoDiagnostic[] = [];
      const newArguments: CheckedType[] = [];
      for (const argument of type.arguments) {
        const argumentResult = substituteCheckedType(argument, substitution);
        newArguments.push(argumentResult.type);
        argumentDiagnostics.push(...argumentResult.diagnostics);
      }
      return {
        type: appliedType({
          constructor: type.constructor,
          arguments: newArguments,
          resourceKind: substituteResourceKind(type.resourceKind, substitution),
        }),
        diagnostics: argumentDiagnostics,
      };
    }
    case "error":
      return { type, diagnostics: [] };
  }
}

export function substituteResourceKind(
  kind: CheckedResourceKind,
  substitution: MonoSubstitution,
): CheckedResourceKind {
  switch (kind.kind) {
    case "concrete":
      return kind;
    case "parametric": {
      const substituted = substitution.map.get(parameterKeyString(kind.parameter));
      const substitutedKind =
        substituted !== undefined ? resourceKindForSubstitutedType(substituted) : undefined;
      return substitutedKind ?? kind;
    }
    case "derived":
      return derivedKind(
        kind.rule,
        kind.arguments.map((argument) => substituteResourceKind(argument, substitution)),
      );
    case "error":
      return kind;
  }
}

function resourceKindForSubstitutedType(type: MonoCheckedType): CheckedResourceKind | undefined {
  switch (type.kind) {
    case "applied":
      return type.resourceKind;
    case "core":
      return concreteKind(coreTypeResourceKind(type.coreTypeId));
    case "source":
    case "target":
      return undefined;
    case "genericParameter":
    case "error":
      return errorKind();
  }
}

function coreTypeResourceKind(coreTypeId: CoreTypeId): ConcreteResourceKind {
  return coreTypeId === "Never" ? "Never" : "Copy";
}

export interface SubstituteProofExpressionResult {
  readonly expression: MonoProofExpression;
  readonly diagnostics: readonly MonoDiagnostic[];
}

export function substituteProofExpression(
  expression: MonoProofExpression,
  substitution: MonoSubstitution,
): SubstituteProofExpressionResult {
  void substitution;
  switch (expression.kind) {
    case "literal":
      return { expression, diagnostics: [] };
    case "reference": {
      if (expression.functionId === undefined && expression.fieldId === undefined) {
        return {
          expression,
          diagnostics: [
            monoDiagnostic({
              severity: "error",
              code: "MONO_UNRESOLVED_TYPE_PARAMETER",
              message: "Unresolved proof expression reference",
              ownerKey: expression.name,
              rootCauseKey: "substitution",
              stableDetail: `unresolved-reference:${expression.name}`,
              sourceOrigin: expression.sourceOrigin,
            }),
          ],
        };
      }
      return { expression, diagnostics: [] };
    }
    case "call": {
      const diagnostics: MonoDiagnostic[] = [];
      const newArguments: MonoProofExpression[] = [];
      for (const argument of expression.arguments) {
        const result = substituteProofExpression(argument, substitution);
        newArguments.push(result.expression);
        diagnostics.push(...result.diagnostics);
      }
      const newExpression: MonoProofExpression = {
        proofExpressionId: expression.proofExpressionId,
        kind: "call",
        sourceOrigin: expression.sourceOrigin,
        ...(expression.calleeFunctionId !== undefined
          ? { calleeFunctionId: expression.calleeFunctionId }
          : {}),
        arguments: newArguments,
      };
      return { expression: newExpression, diagnostics };
    }
    case "binary": {
      const leftResult = substituteProofExpression(expression.left, substitution);
      const rightResult = substituteProofExpression(expression.right, substitution);
      const newExpression: MonoProofExpression = {
        proofExpressionId: expression.proofExpressionId,
        kind: "binary",
        sourceOrigin: expression.sourceOrigin,
        operator: expression.operator,
        left: leftResult.expression,
        right: rightResult.expression,
      };
      return {
        expression: newExpression,
        diagnostics: [...leftResult.diagnostics, ...rightResult.diagnostics],
      };
    }
    case "error":
      return { expression, diagnostics: [] };
  }
}

export interface SubstituteRequirementExpressionResult {
  readonly expression: MonoRequirementExpression;
  readonly diagnostics: readonly MonoDiagnostic[];
}

export function substituteRequirementExpression(
  expression: MonoRequirementExpression,
  substitution: MonoSubstitution,
): SubstituteRequirementExpressionResult {
  switch (expression.kind) {
    case "structured": {
      const inner = substituteProofExpression(expression.expression, substitution);
      const newExpression: MonoRequirementExpression = {
        kind: "structured",
        expression: inner.expression,
      };
      return { expression: newExpression, diagnostics: inner.diagnostics };
    }
    case "opaque":
      return { expression, diagnostics: [] };
    case "error":
      return { expression, diagnostics: [] };
  }
}
