import type { DraftProofMirGraphStatementSnapshot } from "../draft/draft-statement";
import {
  shouldLowerMemberAsValidatedBufferRead,
  VALIDATED_BUFFER_SOURCE_LENGTH_MEMBER_FIELD_ID,
} from "../domains/validated-buffer-read-detection";
import type {
  ProofMirLoweringResult,
  ProofMirValidatedBufferReadLowerer,
} from "./lowering-context";
import { loweringError } from "./call-lowering-shared";
import type { ProofMirDraftOperand } from "./lowering-operands";
import {
  lowerValidatedBufferMemberRead,
  unlowerableValidatedBufferReadDiagnostic,
} from "./validated-buffer-read-field-lowering";
import { lowerDerivedFieldComparison } from "./validated-buffer-derived-comparison-lowering";
import { type RecordedProofMirStatement } from "./validated-buffer-read-statement-recorder";

export type { ProofMirLoweringResult };
export { shouldLowerMemberAsValidatedBufferRead, VALIDATED_BUFFER_SOURCE_LENGTH_MEMBER_FIELD_ID };

function lowerValidatedBufferReadImpl(input: {
  readonly loweringInput: Parameters<
    ProofMirValidatedBufferReadLowerer["lowerValidatedBufferRead"]
  >[0];
  readonly recorded: RecordedProofMirStatement[];
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const expression = input.loweringInput.expression;
  if (expression.kind.kind !== "member" || expression.kind.memberPlace === undefined) {
    return loweringError([
      unlowerableValidatedBufferReadDiagnostic({
        functionInstanceId: input.loweringInput.context.functionInstanceId,
        stableDetail: expression.kind.kind,
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }

  return lowerValidatedBufferMemberRead({
    loweringInput: input.loweringInput,
    expression,
    memberPlace: expression.kind.memberPlace,
    recorded: input.recorded,
  });
}

export function createProofMirValidatedBufferReadLowerer(): ProofMirValidatedBufferReadLowerer & {
  readonly statements: () => readonly DraftProofMirGraphStatementSnapshot[];
} {
  const recorded: RecordedProofMirStatement[] = [];

  return {
    lowerValidatedBufferRead(loweringInput) {
      return lowerValidatedBufferReadImpl({
        loweringInput,
        recorded,
      });
    },
    lowerDerivedFieldComparison(loweringInput) {
      return lowerDerivedFieldComparison({
        loweringInput,
        recorded,
      });
    },
    statements(): readonly DraftProofMirGraphStatementSnapshot[] {
      return recorded.map((entry) => ({
        statementKey: entry.statementKey,
        originKey: entry.originKey,
        kind: entry.kind,
      }));
    },
  };
}
