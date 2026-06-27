import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirCallArgument,
  DraftProofMirCallReceiver,
} from "../draft/draft-call-operands";
import type { ProofMirOriginId } from "../ids";
import type {
  ProofMirCallArgument,
  ProofMirCallReceiver,
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
  ProofMirOperand,
} from "../model/operands";
import { isConsumedDraftOperand, type ProofMirDraftOperand } from "../lower/lowering-operands";
import type { FreezeDraftStatementLookups } from "./draft-statement-freeze";

function resolveValueId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ReturnType<FreezeDraftStatementLookups["valueLookup"]["resolve"]> {
  return lookups.valueLookup.resolve(key);
}

function resolvePlaceId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ReturnType<FreezeDraftStatementLookups["placeLookup"]["resolve"]> {
  return lookups.placeLookup.resolve(key);
}

function resolveOriginId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ProofMirOriginId | undefined {
  return lookups.resolveOrigin(key);
}

export function freezeDraftCallOperand(
  lookups: FreezeDraftStatementLookups,
  operand: ProofMirDraftOperand,
): ProofMirOperand | undefined {
  switch (operand.kind) {
    case "value": {
      const value = resolveValueId(lookups, operand.value);
      return value === undefined ? undefined : { kind: "value", value };
    }
    case "place": {
      const place = resolvePlaceId(lookups, operand.place);
      return place === undefined ? undefined : { kind: "place", place };
    }
    case "valueAndPlace": {
      const value = resolveValueId(lookups, operand.value);
      const place = resolvePlaceId(lookups, operand.place);
      if (value === undefined || place === undefined) {
        return undefined;
      }
      return { kind: "valueAndPlace", value, place };
    }
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function freezeDraftObservedOperand(
  lookups: FreezeDraftStatementLookups,
  operand: ProofMirDraftOperand,
): ProofMirObservedOperand | undefined {
  const frozen = freezeDraftCallOperand(lookups, operand);
  if (frozen === undefined) {
    return undefined;
  }
  switch (frozen.kind) {
    case "value":
    case "place":
      return frozen;
    default:
      return undefined;
  }
}

function freezeDraftConsumedOperand(
  lookups: FreezeDraftStatementLookups,
  operand: ProofMirDraftOperand,
): ProofMirConsumedOperand | undefined {
  if (!isConsumedDraftOperand(operand)) {
    return undefined;
  }
  const frozen = freezeDraftCallOperand(lookups, operand);
  if (frozen === undefined) {
    return undefined;
  }
  switch (frozen.kind) {
    case "place":
    case "valueAndPlace":
      return frozen;
    default:
      return undefined;
  }
}

export function freezeDraftCallReceiver(
  lookups: FreezeDraftStatementLookups,
  receiver: DraftProofMirCallReceiver,
): ProofMirCallReceiver | undefined {
  const origin = resolveOriginId(lookups, receiver.originKey);
  if (origin === undefined) {
    return undefined;
  }
  if (receiver.mode === "observe") {
    const operand = freezeDraftObservedOperand(lookups, receiver.operand);
    if (operand === undefined) {
      return undefined;
    }
    return { mode: "observe", operand, origin };
  }
  const operand = freezeDraftConsumedOperand(lookups, receiver.operand);
  if (operand === undefined) {
    return undefined;
  }
  return { mode: "consume", operand, origin };
}

export function freezeDraftCallArgument(
  lookups: FreezeDraftStatementLookups,
  argument: DraftProofMirCallArgument,
): ProofMirCallArgument | undefined {
  const origin = resolveOriginId(lookups, argument.originKey);
  if (origin === undefined) {
    return undefined;
  }
  if (argument.mode === "observe") {
    const operand = freezeDraftObservedOperand(lookups, argument.operand);
    if (operand === undefined) {
      return undefined;
    }
    return {
      ...(argument.parameterId === undefined ? {} : { parameterId: argument.parameterId }),
      mode: "observe",
      operand,
      origin,
    };
  }
  const operand = freezeDraftConsumedOperand(lookups, argument.operand);
  if (operand === undefined) {
    return undefined;
  }
  return {
    ...(argument.parameterId === undefined ? {} : { parameterId: argument.parameterId }),
    mode: "consume",
    operand,
    origin,
  };
}

export function freezeDraftCallArguments(
  lookups: FreezeDraftStatementLookups,
  arguments_: readonly DraftProofMirCallArgument[],
): ProofMirCallArgument[] | undefined {
  const frozenArguments: ProofMirCallArgument[] = [];
  for (const argument of arguments_) {
    const frozen = freezeDraftCallArgument(lookups, argument);
    if (frozen === undefined) {
      return undefined;
    }
    frozenArguments.push(frozen);
  }
  return frozenArguments;
}
