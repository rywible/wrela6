import type { MonoInstanceId } from "../../../mono/ids";
import type { OptIrCallTarget } from "../../calls";
import type { OptIrConstantId, OptIrFactId, OptIrValueId } from "../../ids";

export type OptIrCloneStaticBinding =
  | {
      readonly kind: "constant";
      readonly constantId: OptIrConstantId;
      readonly factsCited: readonly OptIrFactId[];
    }
  | {
      readonly kind: "layoutFact";
      readonly layoutFactKey: string;
      readonly factsCited: readonly OptIrFactId[];
    }
  | {
      readonly kind: "calleeIdentity";
      readonly calleeIdentity: MonoInstanceId;
      readonly factsCited: readonly OptIrFactId[];
    }
  | {
      readonly kind: "factKey";
      readonly factKey: string;
      readonly factsCited: readonly OptIrFactId[];
    };

export interface OptIrCloneStaticOperand {
  readonly parameterIndex: number;
  readonly valueId: OptIrValueId;
  readonly binding: OptIrCloneStaticBinding;
}

export interface OptIrCloneSignatureInput {
  readonly callee: OptIrCallTarget;
  readonly staticOperands: readonly OptIrCloneStaticOperand[];
}

export function cloneSignatureKey(input: OptIrCloneSignatureInput): string {
  return [
    `callee:${callTargetKey(input.callee)}`,
    ...[...input.staticOperands]
      .sort((left, right) => left.parameterIndex - right.parameterIndex)
      .map((operand) => `p${operand.parameterIndex}=${bindingKey(operand.binding)}`),
  ].join("|");
}

export function cloneSignaturesEquivalent(
  left: OptIrCloneSignatureInput,
  right: OptIrCloneSignatureInput,
): boolean {
  return cloneSignatureKey(left) === cloneSignatureKey(right);
}

function callTargetKey(target: OptIrCallTarget): string {
  switch (target.kind) {
    case "source":
      return `source:${target.functionInstanceId}`;
    case "runtime":
      return `runtime:${target.runtimeKey}`;
    case "platform":
      return `platform:${target.platformKey}`;
    case "intrinsic":
      return `intrinsic:${target.intrinsicKey}`;
    case "externalUnknown":
      return `external:${target.symbol}`;
  }
}

function bindingKey(binding: OptIrCloneStaticBinding): string {
  switch (binding.kind) {
    case "constant":
      return `const:${Number(binding.constantId)}:${factsKey(binding.factsCited)}`;
    case "layoutFact":
      return `layout:${binding.layoutFactKey}:${factsKey(binding.factsCited)}`;
    case "calleeIdentity":
      return `callee:${binding.calleeIdentity}:${factsKey(binding.factsCited)}`;
    case "factKey":
      return `fact:${binding.factKey}:${factsKey(binding.factsCited)}`;
  }
}

function factsKey(facts: readonly OptIrFactId[]): string {
  return `facts[${[...facts]
    .map((factId) => Number(factId))
    .sort((left, right) => left - right)
    .join(",")}]`;
}
