import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirOriginKey } from "../domains/origin-map";
import type {
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirStatementKind,
} from "../draft/draft-statement";
import type { ProofMirValidatedBufferReadLoweringInput } from "./lowering-context";

export interface RecordedProofMirStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

export function recordValidatedBufferReadStatement(input: {
  readonly recorded: RecordedProofMirStatement[];
  readonly context: ProofMirValidatedBufferReadLoweringInput["context"];
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: DraftProofMirOriginKey;
  readonly kind: DraftProofMirStatementKind;
}): void {
  const statementKey = input.context.graph.addStatement(input.blockKey, {
    origin: input.originKey,
  });
  const snapshot: DraftProofMirGraphStatementSnapshot = {
    statementKey,
    originKey: input.originKey,
    kind: input.kind,
  };
  input.recorded.push(snapshot);
  input.context.graph.recordLoweredStatement(input.blockKey, snapshot);
}
