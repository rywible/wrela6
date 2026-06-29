import type { OptIrConstantId } from "./ids";
import { optIrTypeStableKey, type OptIrType } from "./types";

export interface OptIrTargetDataModelInterpretation {
  readonly pointerWidth: number;
  readonly endian: "little" | "big";
}

export interface OptIrIntegerConstant {
  readonly kind: "integer";
  readonly constantId: OptIrConstantId;
  readonly type: OptIrType;
  readonly normalizedValue: bigint;
  readonly dataModel?: OptIrTargetDataModelInterpretation;
}

export type OptIrConstant = OptIrIntegerConstant;

export function optIrIntegerConstant(input: {
  readonly constantId: OptIrConstantId;
  readonly type: OptIrType;
  readonly normalizedValue: bigint;
  readonly dataModel?: OptIrTargetDataModelInterpretation;
}): OptIrIntegerConstant {
  return {
    kind: "integer",
    constantId: input.constantId,
    type: input.type,
    normalizedValue: input.normalizedValue,
    ...(input.dataModel === undefined ? {} : { dataModel: input.dataModel }),
  };
}

export function optIrConstantStableKey(constant: OptIrConstant): string {
  switch (constant.kind) {
    case "integer":
      return `${optIrTypeStableKey(constant.type)}:${constant.normalizedValue}`;
  }
}

function dataModelKey(dataModel: OptIrTargetDataModelInterpretation | undefined): string {
  if (dataModel === undefined) {
    return "target:default";
  }
  return `target:pointer${dataModel.pointerWidth}:${dataModel.endian}`;
}

export function optIrConstantInternKey(constant: OptIrConstant): string {
  return `${optIrConstantStableKey(constant)}/${dataModelKey(constant.dataModel)}`;
}

export interface OptIrConstantPool {
  readonly internInteger: (input: {
    readonly constantId: OptIrConstantId;
    readonly type: OptIrType;
    readonly normalizedValue: bigint;
    readonly dataModel?: OptIrTargetDataModelInterpretation;
  }) => OptIrIntegerConstant;
  readonly constants: () => readonly OptIrConstant[];
}

export function optIrConstantPool(): OptIrConstantPool {
  const constantsByKey = new Map<string, OptIrConstant>();

  return {
    internInteger(input) {
      const constant = optIrIntegerConstant(input);
      const key = optIrConstantInternKey(constant);
      const existing = constantsByKey.get(key);
      if (existing !== undefined) {
        return existing as OptIrIntegerConstant;
      }
      constantsByKey.set(key, constant);
      return constant;
    },
    constants() {
      return [...constantsByKey.values()];
    },
  };
}
