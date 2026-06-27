import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirPlaceId, ProofMirValueId } from "../ids";
import type { ProofMirOperand } from "../model/operands";

export type ProofMirDraftValueOperand = {
  readonly kind: "value";
  readonly value: ProofMirCanonicalKey;
};

export type ProofMirDraftPlaceOperand = {
  readonly kind: "place";
  readonly place: ProofMirCanonicalKey;
};

export type ProofMirDraftValueAndPlaceOperand = {
  readonly kind: "valueAndPlace";
  readonly value: ProofMirCanonicalKey;
  readonly place: ProofMirCanonicalKey;
};

export type ProofMirDraftOperand =
  | ProofMirDraftValueOperand
  | ProofMirDraftPlaceOperand
  | ProofMirDraftValueAndPlaceOperand;

export function operandValueKey(operand: ProofMirDraftOperand): ProofMirCanonicalKey | undefined {
  switch (operand.kind) {
    case "value":
      return operand.value;
    case "valueAndPlace":
      return operand.value;
    default:
      return undefined;
  }
}

export function operandPlaceKey(operand: ProofMirDraftOperand): ProofMirCanonicalKey | undefined {
  switch (operand.kind) {
    case "place":
      return operand.place;
    case "valueAndPlace":
      return operand.place;
    default:
      return undefined;
  }
}

export function draftOperandToFrozen(input: {
  readonly operand: ProofMirDraftOperand;
  readonly valueIdForKey: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
}): ProofMirOperand {
  switch (input.operand.kind) {
    case "value":
      return { kind: "value", value: input.valueIdForKey(input.operand.value) };
    case "place":
      return { kind: "place", place: input.placeIdForKey(input.operand.place) };
    case "valueAndPlace":
      return {
        kind: "valueAndPlace",
        value: input.valueIdForKey(input.operand.value),
        place: input.placeIdForKey(input.operand.place),
      };
    default: {
      const unreachable: never = input.operand;
      return unreachable;
    }
  }
}

export function isConsumedDraftOperand(
  operand: ProofMirDraftOperand,
): operand is ProofMirDraftPlaceOperand | ProofMirDraftValueAndPlaceOperand {
  return operand.kind === "place" || operand.kind === "valueAndPlace";
}
