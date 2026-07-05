import { compareProofMirCanonicalKeys } from "../canonicalization/canonical-order";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  DraftProofMirGraphBlockParameterSnapshot,
  DraftProofMirGraphExitSnapshot,
  DraftProofMirGraphSnapshot,
} from "./draft-program";
import type { DraftProofMirGraphStatementSnapshot } from "./draft-statement";
import type { DraftGraphBlockStateMerge } from "./draft-block-state-merge";
import type { DraftGraphEdgeState, DraftGraphTerminator } from "./draft-graph-builder";

export interface DraftGraphSnapshotBlockInput {
  readonly key: ProofMirCanonicalKey;
  readonly role: string;
  readonly terminator?: DraftGraphTerminator;
  readonly parameters: readonly DraftProofMirGraphBlockParameterSnapshot[];
  readonly stateMerge?: DraftGraphBlockStateMerge;
}

export function exportDraftGraphSnapshot(input: {
  readonly blocks: Iterable<DraftGraphSnapshotBlockInput>;
  readonly edges: Iterable<DraftGraphEdgeState>;
  readonly exits: Iterable<DraftProofMirGraphExitSnapshot>;
  readonly loweredStatementsByBlock: ReadonlyMap<
    ProofMirCanonicalKey,
    readonly DraftProofMirGraphStatementSnapshot[]
  >;
}): DraftProofMirGraphSnapshot {
  const blocks = [...input.blocks].map((block) => ({
    key: block.key,
    role: block.role,
    ...(block.terminator === undefined ? {} : { terminator: block.terminator }),
    ...(block.parameters.length === 0 ? {} : { parameters: block.parameters.slice() }),
    ...(block.stateMerge === undefined ? {} : { stateMerge: block.stateMerge }),
    statements: input.loweredStatementsByBlock.get(block.key) ?? [],
  }));
  return {
    blocks: blocks.sort((left, right) => compareProofMirCanonicalKeys(left.key, right.key)),
    edges: [...input.edges].sort((left, right) =>
      compareProofMirCanonicalKeys(left.key, right.key),
    ),
    exits: [...input.exits].sort((left, right) =>
      compareProofMirCanonicalKeys(left.key, right.key),
    ),
  };
}
