import type { MonoExpression } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { shouldLowerMemberAsValidatedBufferRead } from "../domains/validated-buffer-read-detection";
import type {
  ProofMirExpressionLoweringInput,
  ProofMirLoweringResult,
  ProofMirValidatedBufferReadLowerer,
} from "./lowering-context";
import type { ProofMirDraftOperand, ProofMirDraftPlaceOperand } from "./lowering-operands";
import {
  invalidValueResourceKindDiagnostic,
  originForExpression,
  loweringError,
} from "./expression-lowerer-helpers";

export function lowerProofMirMemberAsValue(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
  readonly validatedBufferRead?: ProofMirValidatedBufferReadLowerer;
  readonly lowerMemberAsPlace: (
    loweringInput: ProofMirExpressionLoweringInput,
    expression: MonoExpression,
  ) => ProofMirLoweringResult<ProofMirDraftPlaceOperand>;
  readonly emitLoad: (input: {
    readonly loweringInput: ProofMirExpressionLoweringInput;
    readonly expression: MonoExpression;
    readonly placeKey: ProofMirCanonicalKey;
  }) => ProofMirLoweringResult<ProofMirDraftOperand>;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const memberPlace =
    input.expression.kind.kind === "member" ? input.expression.kind.memberPlace : undefined;
  if (
    input.validatedBufferRead !== undefined &&
    memberPlace !== undefined &&
    shouldLowerMemberAsValidatedBufferRead({
      program: input.loweringInput.context.program,
      layout: input.loweringInput.context.layout,
      memberPlace,
    })
  ) {
    return input.validatedBufferRead.lowerValidatedBufferRead({
      context: input.loweringInput.context,
      expression: input.expression,
      blockKey: input.loweringInput.blockKey,
    });
  }

  const placeResult = input.lowerMemberAsPlace(input.loweringInput, input.expression);
  if (placeResult.kind !== "ok") {
    return placeResult;
  }
  if (memberPlace === undefined) {
    return loweringError([
      invalidValueResourceKindDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: "member:missing-place",
        sourceOrigin: input.expression.sourceOrigin,
      }),
    ]);
  }
  const placeKey = input.loweringInput.context.effects.placeFromMono({
    monoPlace: memberPlace,
    originKey: originForExpression(input.loweringInput.context, input.expression),
  });
  return input.emitLoad({
    loweringInput: input.loweringInput,
    expression: input.expression,
    placeKey,
  });
}
