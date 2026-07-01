import type { AArch64MachineInstructionId } from "./ids";
import type { AArch64MachineResource } from "./resources";

export type AArch64RematerializationProducerKind =
  | "constant"
  | "symbolPageBase"
  | "symbolPageOffset"
  | "literalPoolAddress"
  | "pureAddress";

export interface AArch64RematerializationRecord {
  readonly producer: AArch64MachineInstructionId;
  readonly kind: AArch64RematerializationProducerKind;
  readonly cost: number;
  readonly requiredFacts: readonly string[];
  readonly requiredSymbols: readonly string[];
  readonly relocationReferences: readonly string[];
  readonly implicitResources: readonly AArch64MachineResource[];
}

export function aarch64RematerializationRecord(
  input: AArch64RematerializationRecord,
): AArch64RematerializationRecord {
  if (!Number.isInteger(input.cost) || input.cost < 0) {
    throw new RangeError("rematerialization cost must be a non-negative integer.");
  }
  return Object.freeze({
    producer: input.producer,
    kind: input.kind,
    cost: input.cost,
    requiredFacts: Object.freeze([...input.requiredFacts]),
    requiredSymbols: Object.freeze([...input.requiredSymbols]),
    relocationReferences: Object.freeze([...input.relocationReferences]),
    implicitResources: Object.freeze(
      input.implicitResources.map((resource) => Object.freeze({ ...resource })),
    ),
  });
}
