import type { CheckedFunctionSignature } from "../semantic/surface/checked-program";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkedTypeFingerprint, checkedTypesEqual } from "../semantic/surface/type-model";

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
  const key = genericKey(type);
  if (key !== undefined) return substitutions.get(key) ?? type;
  if (type.kind !== "applied") return type;
  return {
    ...type,
    arguments: type.arguments.map((argument) => substituteType(argument, substitutions)),
  };
}

function substituteKind(
  kind: CheckedResourceKind,
  substitutions: ReadonlyMap<string, CheckedType>,
): CheckedResourceKind {
  void substitutions;
  if (kind.kind !== "derived") return kind;
  return {
    ...kind,
    arguments: kind.arguments.map((argument) => substituteKind(argument, substitutions)),
  };
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

  return {
    ...input.signature,
    receiver:
      input.signature.receiver !== undefined
        ? {
            ...input.signature.receiver,
            type: substituteType(input.signature.receiver.type, substitutions),
            resourceKind: substituteKind(input.signature.receiver.resourceKind, substitutions),
          }
        : undefined,
    parameters: input.signature.parameters.map((parameter) => ({
      ...parameter,
      type: substituteType(parameter.type, substitutions),
      resourceKind: substituteKind(parameter.resourceKind, substitutions),
    })),
    returnType: substituteType(input.signature.returnType, substitutions),
    returnKind: substituteKind(input.signature.returnKind, substitutions),
  };
}
