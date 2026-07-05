import type { CheckedFunctionSignature } from "../semantic/surface/checked-program";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import { concreteKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkedTypeFingerprint, checkedTypesEqual } from "../semantic/surface/type-model";
import { transformCheckedResourceKind, transformCheckedType } from "./checked-type-transform";

export { checkedTypeFingerprint, checkedTypesEqual };

function genericKey(type: CheckedType): string | undefined {
  if (type.kind !== "genericParameter") return undefined;
  const owner =
    type.parameter.owner.kind === "item"
      ? `item:${type.parameter.owner.itemId}`
      : `function:${type.parameter.owner.functionId}`;
  return `${owner}:${type.parameter.index}`;
}

function substituteType(
  type: CheckedType,
  substitutions: ReadonlyMap<string, CheckedType>,
): CheckedType {
  return transformCheckedType(type, {
    checkedType: (source) => {
      const key = genericKey(source);
      return key !== undefined ? (substitutions.get(key) ?? source) : source;
    },
    resourceKind: (source) => substituteKind(source, substitutions),
  });
}

function substituteKind(
  kind: CheckedResourceKind,
  substitutions: ReadonlyMap<string, CheckedType>,
): CheckedResourceKind {
  return transformCheckedResourceKind(kind, {
    resourceKind: (source) => {
      if (source.kind !== "parametric") return source;
      const substitution = substitutions.get(genericParameterKey(source.parameter));
      if (substitution === undefined) return source;
      return substitution.kind === "applied" ? substitution.resourceKind : concreteKind("Copy");
    },
  });
}

export function substituteCheckedSignature(input: {
  readonly signature: CheckedFunctionSignature;
  readonly typeArguments: readonly CheckedType[];
}): CheckedFunctionSignature {
  const parameters = input.signature.genericSignature?.parameters ?? [];
  if (parameters.length === 0) return input.signature;

  const substitutions = new Map<string, CheckedType>();
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!;
    const argument = input.typeArguments[index];
    if (argument !== undefined) {
      const owner =
        parameter.key.owner.kind === "item"
          ? `item:${parameter.key.owner.itemId}`
          : `function:${parameter.key.owner.functionId}`;
      substitutions.set(`${owner}:${parameter.key.index}`, argument);
    }
  }

  const receiver =
    input.signature.receiver !== undefined
      ? {
          ...input.signature.receiver,
          type: substituteType(input.signature.receiver.type, substitutions),
          resourceKind: substituteKind(input.signature.receiver.resourceKind, substitutions),
        }
      : undefined;
  const parametersResult = input.signature.parameters.map((parameter) => ({
    ...parameter,
    type: substituteType(parameter.type, substitutions),
    resourceKind: substituteKind(parameter.resourceKind, substitutions),
  }));
  const returnType = substituteType(input.signature.returnType, substitutions);
  const returnKind = substituteKind(input.signature.returnKind, substitutions);
  const receiverChanged =
    receiver !== input.signature.receiver &&
    (receiver?.type !== input.signature.receiver?.type ||
      receiver?.resourceKind !== input.signature.receiver?.resourceKind);
  const parametersChanged = parametersResult.some(
    (parameter, index) =>
      parameter.type !== input.signature.parameters[index]?.type ||
      parameter.resourceKind !== input.signature.parameters[index]?.resourceKind,
  );
  return receiverChanged ||
    parametersChanged ||
    returnType !== input.signature.returnType ||
    returnKind !== input.signature.returnKind
    ? {
        ...input.signature,
        receiver,
        parameters: parametersResult,
        returnType,
        returnKind,
      }
    : input.signature;
}

function genericParameterKey(parameter: {
  readonly owner:
    | { readonly kind: "item"; readonly itemId: unknown }
    | { readonly kind: "function"; readonly functionId: unknown };
  readonly index: number;
}): string {
  const owner =
    parameter.owner.kind === "item"
      ? `item:${parameter.owner.itemId}`
      : `function:${parameter.owner.functionId}`;
  return `${owner}:${parameter.index}`;
}
