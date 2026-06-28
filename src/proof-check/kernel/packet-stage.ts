import type { ProofMirBlockId } from "../../proof-mir/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckCertificateId } from "../model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedOriginFact,
} from "../model/fact-packet";
import { checkedFactSubjectKey } from "../validation/packet-validator";

export interface ProofCheckStagedPacketEntry {
  readonly entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
  readonly anchorStateKey: string;
  readonly transitionCertificate: ProofCheckCertificateId;
  readonly commitBlockId: ProofMirBlockId;
}

export interface ProofCheckPacketStage {
  entries(): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  stagedEntries(): readonly ProofCheckStagedPacketEntry[];
  explicitOrigins(): readonly CheckedOriginFact[];
  stage(input: ProofCheckStagedPacketEntry): void;
  stageOrigin(origin: CheckedOriginFact): void;
  commit(blockId: ProofMirBlockId): void;
  discard(stateKey: string): void;
}

function sortStagedPacketEntries(
  entries: readonly ProofCheckStagedPacketEntry[],
): readonly ProofCheckStagedPacketEntry[] {
  return [...entries].sort((left, right) => {
    const kindOrder = compareCodeUnitStrings(left.entry.kind, right.entry.kind);
    if (kindOrder !== 0) {
      return kindOrder;
    }
    const subjectOrder = compareCodeUnitStrings(
      checkedFactSubjectKey(left.entry.subject),
      checkedFactSubjectKey(right.entry.subject),
    );
    if (subjectOrder !== 0) {
      return subjectOrder;
    }
    return compareCodeUnitStrings(left.entry.origin.originKey, right.entry.origin.originKey);
  });
}

class MutableProofCheckPacketStage implements ProofCheckPacketStage {
  private readonly committedEntries: ProofCheckStagedPacketEntry[] = [];
  private readonly stagedEntriesList: ProofCheckStagedPacketEntry[] = [];
  private readonly explicitOriginsList: CheckedOriginFact[] = [];

  entries(): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
    return this.committedEntries.map((entry) => entry.entry);
  }

  stagedEntries(): readonly ProofCheckStagedPacketEntry[] {
    return this.stagedEntriesList;
  }

  explicitOrigins(): readonly CheckedOriginFact[] {
    return this.explicitOriginsList;
  }

  stage(input: ProofCheckStagedPacketEntry): void {
    this.stagedEntriesList.push(input);
  }

  stageOrigin(origin: CheckedOriginFact): void {
    this.explicitOriginsList.push(origin);
  }

  commit(blockId: ProofMirBlockId): void {
    const toCommit = this.stagedEntriesList.filter((entry) => entry.commitBlockId === blockId);
    const remaining = this.stagedEntriesList.filter((entry) => entry.commitBlockId !== blockId);
    this.stagedEntriesList.length = 0;
    this.stagedEntriesList.push(...remaining);
    this.committedEntries.push(...sortStagedPacketEntries(toCommit));
    this.committedEntries.sort((left, right) => {
      const leftKey = `${left.entry.kind}:${checkedFactSubjectKey(left.entry.subject)}:${left.entry.origin.originKey}`;
      const rightKey = `${right.entry.kind}:${checkedFactSubjectKey(right.entry.subject)}:${right.entry.origin.originKey}`;
      return compareCodeUnitStrings(leftKey, rightKey);
    });
  }

  discard(stateKey: string): void {
    const remainingStaged = this.stagedEntriesList.filter(
      (entry) => entry.anchorStateKey !== stateKey,
    );
    this.stagedEntriesList.length = 0;
    this.stagedEntriesList.push(...remainingStaged);
    const remainingCommitted = this.committedEntries.filter(
      (entry) => entry.anchorStateKey !== stateKey,
    );
    this.committedEntries.length = 0;
    this.committedEntries.push(...remainingCommitted);
  }
}

export function createProofCheckPacketStage(): ProofCheckPacketStage {
  return new MutableProofCheckPacketStage();
}
