import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirEdgeEffect } from "../domains/effects-resources";
import type { DraftProofMirExitClosurePolicy } from "../draft/draft-program";
import type {
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirStatementKind,
} from "../draft/draft-statement";

export interface DraftRecordedProofMirTakeStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

export interface DraftRecordedProofMirTakeExit {
  readonly exitKey: ProofMirCanonicalKey;
  readonly crossedScopes: readonly ProofMirCanonicalKey[];
  readonly closure: DraftProofMirExitClosurePolicy;
  readonly allowedTransfers: readonly DraftProofMirEdgeEffect[];
}

export interface ProofMirTakeBodyRecorder {
  readonly statements: readonly DraftRecordedProofMirTakeStatement[];
  readonly exits: readonly DraftRecordedProofMirTakeExit[];
  recordStatement(
    blockKey: ProofMirCanonicalKey,
    originKey: ProofMirCanonicalKey,
    kind: DraftProofMirStatementKind,
  ): void;
  recordExit(entry: DraftRecordedProofMirTakeExit): void;
}

export function createTakeBodyRecorder(graph: {
  addStatement(
    blockKey: ProofMirCanonicalKey,
    input: {
      readonly origin: ProofMirCanonicalKey;
    },
  ): ProofMirCanonicalKey;
  recordLoweredStatement(
    blockKey: ProofMirCanonicalKey,
    statement: DraftProofMirGraphStatementSnapshot,
  ): void;
}): ProofMirTakeBodyRecorder {
  const statements: DraftRecordedProofMirTakeStatement[] = [];
  const exits: DraftRecordedProofMirTakeExit[] = [];
  return {
    get statements() {
      return statements.slice();
    },
    get exits() {
      return exits.slice();
    },
    recordStatement(blockKey, originKey, kind) {
      const statementKey = graph.addStatement(blockKey, {
        origin: originKey,
      });
      const snapshot: DraftProofMirGraphStatementSnapshot = {
        statementKey,
        originKey,
        kind,
      };
      statements.push(snapshot);
      graph.recordLoweredStatement(blockKey, snapshot);
    },
    recordExit(entry) {
      exits.push(entry);
    },
  };
}
