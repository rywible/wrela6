import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { CheckedValidationState, ProofCheckState } from "../kernel/state";

export function pendingValidation(
  state: ProofCheckState,
  validationKey: string,
): CheckedValidationState | undefined {
  const validation = state.validations.get(validationKey);
  if (validation === undefined || validation.status !== "pending") {
    return undefined;
  }
  return validation;
}

export function liveValidationSourceKeys(state: ProofCheckState): readonly string[] {
  return [...state.layout.keys()]
    .filter((bufferKey) => state.places.get(bufferKey)?.lifecycle === "owned")
    .sort(compareCodeUnitStrings);
}

export function livePendingValidationKeys(state: ProofCheckState): readonly string[] {
  return [...state.validations.values()]
    .filter((validation) => validation.status === "pending")
    .map((validation) => validation.validationKey)
    .sort(compareCodeUnitStrings);
}

export function livePacketKeys(state: ProofCheckState): readonly string[] {
  return [...state.packetSources.values()]
    .filter((packetSource) => state.places.get(packetSource.packetKey)?.lifecycle === "owned")
    .map((packetSource) => packetSource.packetKey)
    .sort(compareCodeUnitStrings);
}
