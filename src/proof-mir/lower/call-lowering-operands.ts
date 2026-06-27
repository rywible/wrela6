import type { MonoExpression } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirCallArgument,
  DraftProofMirCallReceiver,
} from "../draft/draft-call-operands";
import type {
  ProofMirCallArgument,
  ProofMirObservedOperand,
  ProofMirOperand,
} from "../model/operands";
import type { ProofMirPlaceId, ProofMirValueId } from "../ids";
import {
  draftOperandToFrozen,
  isConsumedDraftOperand,
  type ProofMirDraftOperand,
} from "./lowering-operands";
import {
  type CallLoweringIdAllocator,
  invalidConsumeOperandDiagnostic,
  loweringError,
  loweringOk,
  originForCall,
  valueIdForGraphKey,
} from "./call-lowering-shared";
import type {
  ProofMirExpressionLowerer,
  ProofMirLoweringContext,
  ProofMirLoweringResult,
} from "./lowering-context";

export function frozenOperandFromDraft(input: {
  readonly operand: ProofMirDraftOperand;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
  readonly idAllocator: CallLoweringIdAllocator;
}): ProofMirOperand {
  return draftOperandToFrozen({
    operand: input.operand,
    valueIdForKey: (key) =>
      valueIdForGraphKey({
        valueKey: key,
        valueIdForKey: input.valueIdForKey,
        idAllocator: input.idAllocator,
      }),
    placeIdForKey: (key) =>
      input.placeIdForKey?.(key) ??
      (() => {
        void key;
        return input.idAllocator.placeId();
      })(),
  });
}

function observedOperandForRuntime(frozenOperand: ProofMirOperand): ProofMirObservedOperand {
  switch (frozenOperand.kind) {
    case "value":
    case "place":
      return frozenOperand;
    case "valueAndPlace":
      return { kind: "place", place: frozenOperand.place };
    default: {
      const unreachable: never = frozenOperand;
      return unreachable;
    }
  }
}

export function freezeDraftCallArgumentsForRuntime(input: {
  readonly arguments: readonly DraftProofMirCallArgument[];
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
}): ProofMirCallArgument[] {
  const frozenArguments: ProofMirCallArgument[] = [];
  for (const argument of input.arguments) {
    const frozenOperand = frozenOperandFromDraft({
      operand: argument.operand,
      valueIdForKey: input.valueIdForKey,
      placeIdForKey: input.placeIdForKey,
      idAllocator: input.idAllocator,
    });
    if (argument.mode === "observe") {
      frozenArguments.push({
        ...(argument.parameterId === undefined ? {} : { parameterId: argument.parameterId }),
        mode: "observe",
        operand: observedOperandForRuntime(frozenOperand),
        origin: input.idAllocator.originId(),
      });
      continue;
    }
    frozenArguments.push({
      ...(argument.parameterId === undefined ? {} : { parameterId: argument.parameterId }),
      mode: "consume",
      operand:
        frozenOperand.kind === "place" || frozenOperand.kind === "valueAndPlace"
          ? frozenOperand
          : { kind: "place", place: input.idAllocator.placeId() },
      origin: input.idAllocator.originId(),
    });
  }
  return frozenArguments;
}

export function lowerCallOperand(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly operandExpression: MonoExpression;
  readonly blockKey: ProofMirCanonicalKey;
  readonly mode: "observe" | "consume";
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
}): ProofMirLoweringResult<{
  readonly operand: ProofMirDraftOperand;
  readonly originKey: ProofMirCanonicalKey;
}> {
  const lowered = input.expression.lowerExpression({
    context: input.context,
    expression: input.operandExpression,
    blockKey: input.blockKey,
  });
  if (lowered.kind === "error") {
    return lowered;
  }
  if (input.mode === "consume" && !isConsumedDraftOperand(lowered.value)) {
    return loweringError([
      invalidConsumeOperandDiagnostic({
        functionInstanceId: input.context.functionInstanceId,
        stableDetail: `consume:${input.operandExpression.sourceOrigin}`,
        sourceOrigin: input.operandExpression.sourceOrigin,
      }),
    ]);
  }
  return loweringOk({
    operand: lowered.value,
    originKey: input.originKey,
  });
}

export function lowerMonoCallReceiver(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly receiver: MonoExpression;
  readonly blockKey: ProofMirCanonicalKey;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
}): ProofMirLoweringResult<DraftProofMirCallReceiver> {
  const loweredReceiver = lowerCallOperand({
    context: input.context,
    expression: input.expression,
    operandExpression: input.receiver,
    blockKey: input.blockKey,
    mode: "observe",
    originKey: originForCall(
      input.context,
      input.receiver.expressionId,
      input.receiver.sourceOrigin,
    ),
    idAllocator: input.idAllocator,
    valueIdForKey: input.valueIdForKey,
    placeIdForKey: input.placeIdForKey,
  });
  if (loweredReceiver.kind === "error") {
    return loweredReceiver;
  }
  return loweringOk({
    mode: "observe",
    operand: loweredReceiver.value.operand,
    originKey: loweredReceiver.value.originKey,
  });
}

export function lowerMonoCallArguments(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly arguments: readonly import("../../mono/mono-hir").MonoCallArgument[];
  readonly blockKey: ProofMirCanonicalKey;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
}): ProofMirLoweringResult<readonly DraftProofMirCallArgument[]> {
  const loweredArguments: DraftProofMirCallArgument[] = [];
  for (const argument of input.arguments) {
    const mode = argument.mode ?? "observe";
    const loweredArgument = lowerCallOperand({
      context: input.context,
      expression: input.expression,
      operandExpression: argument.expression,
      blockKey: input.blockKey,
      mode,
      originKey: originForCall(
        input.context,
        argument.expression.expressionId,
        argument.expression.sourceOrigin,
      ),
      idAllocator: input.idAllocator,
      valueIdForKey: input.valueIdForKey,
      placeIdForKey: input.placeIdForKey,
    });
    if (loweredArgument.kind === "error") {
      return loweredArgument;
    }
    if (mode === "consume") {
      if (!isConsumedDraftOperand(loweredArgument.value.operand)) {
        return loweringError([
          invalidConsumeOperandDiagnostic({
            functionInstanceId: input.context.functionInstanceId,
            stableDetail: `consume:${argument.expression.sourceOrigin}`,
            sourceOrigin: argument.expression.sourceOrigin,
          }),
        ]);
      }
      loweredArguments.push({
        ...(argument.parameterId === undefined ? {} : { parameterId: argument.parameterId }),
        mode: "consume",
        operand: loweredArgument.value.operand,
        originKey: loweredArgument.value.originKey,
      });
      continue;
    }
    loweredArguments.push({
      ...(argument.parameterId === undefined ? {} : { parameterId: argument.parameterId }),
      mode: "observe",
      operand: loweredArgument.value.operand,
      originKey: loweredArgument.value.originKey,
    });
  }
  return loweringOk(loweredArguments);
}
