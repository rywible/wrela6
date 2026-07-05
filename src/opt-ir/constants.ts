import type { OptIrConstantId } from "./ids";
import { stableDigestHex } from "../shared/stable-json";
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

export interface OptIrDataConstant {
  readonly kind: "data";
  readonly constantId: OptIrConstantId;
  readonly type: OptIrType;
  readonly normalizedValue: bigint;
  readonly bytes: readonly number[];
  readonly alignment: number;
  readonly section: string;
  readonly stableKey: string;
  readonly fingerprint: string;
}

export type OptIrConstant = OptIrIntegerConstant | OptIrDataConstant;

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
    case "data":
      return constant.stableKey;
  }
}

function dataModelKey(dataModel: OptIrTargetDataModelInterpretation | undefined): string {
  if (dataModel === undefined) {
    return "target:default";
  }
  return `target:pointer${dataModel.pointerWidth}:${dataModel.endian}`;
}

export function optIrConstantInternKey(constant: OptIrConstant): string {
  if (constant.kind === "data") {
    return `data:${constant.fingerprint}`;
  }
  return `${optIrConstantStableKey(constant)}/${dataModelKey(constant.dataModel)}`;
}

export function optIrDataConstantFingerprint(input: {
  readonly bytes: readonly number[];
  readonly alignment: number;
  readonly section: string;
  readonly stableKey: string;
}): string {
  return stableDigestHex({
    kind: "opt-ir-data-constant",
    stableKey: input.stableKey,
    section: input.section,
    alignment: input.alignment,
    bytes: input.bytes,
  });
}

export interface OptIrConstantPool {
  readonly internInteger: (input: {
    readonly constantId: OptIrConstantId;
    readonly type: OptIrType;
    readonly normalizedValue: bigint;
    readonly dataModel?: OptIrTargetDataModelInterpretation;
  }) => OptIrIntegerConstant;
  readonly internData: (input: {
    readonly constantId: OptIrConstantId;
    readonly bytes: readonly number[];
    readonly alignment: number;
    readonly section: string;
    readonly stableKey: string;
    readonly fingerprint: string;
  }) => OptIrDataConstant;
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
    internData(input) {
      const constant = Object.freeze({
        kind: "data" as const,
        constantId: input.constantId,
        type: Object.freeze({ kind: "address" as const }),
        normalizedValue: 0n,
        bytes: Object.freeze([...input.bytes]),
        alignment: input.alignment,
        section: input.section,
        stableKey: input.stableKey,
        fingerprint: input.fingerprint,
      });
      const key = optIrConstantInternKey(constant);
      const existing = constantsByKey.get(key);
      if (existing !== undefined) {
        return existing as OptIrDataConstant;
      }
      constantsByKey.set(key, constant);
      return constant;
    },
    constants() {
      return [...constantsByKey.values()];
    },
  };
}
