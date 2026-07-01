import { stableJson } from "../../../../shared/stable-json";
import { applyFactTransferRule } from "../../../../shared/facts/fact-transfer";
import { backendError, backendOk, type AArch64BackendResult } from "./diagnostics";
import {
  beginAArch64BackendRewriteTransaction,
  rejectFactTransferPlan,
  type AArch64BackendInstructionSnapshot,
  type AArch64BackendRewriteKind,
  type AArch64CommittedFactTransfer,
  type AArch64FactTransferPlan,
} from "../facts/backend-rewrite-transaction";
import {
  aarch64BackendFactTransferRuleForFamily,
  type AArch64BackendFactTransferSubject,
} from "../facts/backend-fact-import";

export interface AArch64RewriteableInstruction {
  readonly stableKey: string;
  readonly opcode: string;
  readonly operands?: readonly unknown[];
  readonly provenanceSource?: string;
}

export interface AArch64AffectedRewriteFact {
  readonly extensionKey: string;
  readonly subjectKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function commitAArch64InstructionRewrite<
  Instruction extends AArch64RewriteableInstruction,
>(input: {
  readonly kind: AArch64BackendRewriteKind;
  readonly source: AArch64RewriteableInstruction;
  readonly replacements: readonly Instruction[];
  readonly transfer?: AArch64FactTransferPlan;
  readonly affectedFacts?: readonly AArch64AffectedRewriteFact[];
}): AArch64BackendResult<{
  readonly instructions: readonly Instruction[];
  readonly provenance: readonly string[];
  readonly factTransfers: readonly AArch64CommittedFactTransfer[];
}> {
  const transfer = input.transfer ?? transferPlansForRewrite(input);
  const committed = beginAArch64BackendRewriteTransaction({
    kind: input.kind,
    snapshot: {
      instructions: Object.freeze([instructionSnapshot(input.source)]),
      factTransfers: Object.freeze([]),
      provenance: Object.freeze([]),
    },
  })
    .replaceInstruction({
      oldInstructionKey: input.source.stableKey,
      replacements: Object.freeze(input.replacements.map(instructionSnapshot)),
      transfer,
    })
    .commit();
  if (committed.kind === "error") return backendError(committed.diagnostics);
  return backendOk({
    instructions: Object.freeze([...input.replacements]),
    provenance: Object.freeze(committed.snapshot.provenance.map((record) => record.stableKey)),
    factTransfers: committed.snapshot.factTransfers,
  });
}

function transferPlansForRewrite(input: {
  readonly kind: AArch64BackendRewriteKind;
  readonly source: AArch64RewriteableInstruction;
  readonly replacements: readonly AArch64RewriteableInstruction[];
  readonly affectedFacts?: readonly AArch64AffectedRewriteFact[];
}): readonly AArch64FactTransferPlan[] {
  const affectedFacts = input.affectedFacts ?? [];
  if (affectedFacts.length === 0) return Object.freeze([]);
  const destinationKeys = Object.freeze(
    input.replacements.map((replacement) => replacement.stableKey),
  );
  return Object.freeze(
    affectedFacts.map((fact) => transferPlanForAffectedFact(input, fact, destinationKeys)),
  );
}

function transferPlanForAffectedFact(
  input: {
    readonly kind: AArch64BackendRewriteKind;
    readonly source: AArch64RewriteableInstruction;
  },
  fact: AArch64AffectedRewriteFact,
  destinationKeys: readonly string[],
): AArch64FactTransferPlan {
  const rule = aarch64BackendFactTransferRuleForFamily(fact.extensionKey, input.kind);
  if (rule === undefined) {
    return rejectFactTransferPlan({
      extensionKey: fact.extensionKey,
      subjectKey: fact.subjectKey,
      reason: input.kind,
    });
  }
  const rewrittenSubjects = Object.freeze(
    destinationKeys.map(
      (stableKey): AArch64BackendFactTransferSubject =>
        Object.freeze({ kind: "backendFact", stableKey }),
    ),
  );
  const result = applyFactTransferRule(rule, {
    extensionKey: fact.extensionKey,
    rewriteKind: input.kind,
    subject: Object.freeze({ kind: "backendFact", stableKey: fact.subjectKey }),
    rewrittenSubjects,
    payload: fact.payload,
  });
  if (result.kind === "error") {
    return rejectFactTransferPlan({
      extensionKey: fact.extensionKey,
      subjectKey: fact.subjectKey,
      reason: input.kind,
    });
  }
  if (result.transfer.behavior === "reject") {
    return rejectFactTransferPlan({
      extensionKey: fact.extensionKey,
      subjectKey: fact.subjectKey,
      reason: result.transfer.reason ?? input.kind,
    });
  }
  return Object.freeze({
    behavior: result.transfer.behavior,
    sourceKey: input.source.stableKey,
    destinationKeys: Object.freeze(
      result.transfer.rewrittenSubjects.map((subject) => subject.stableKey),
    ),
    extensionKey: fact.extensionKey,
    ...(result.transfer.reason === undefined ? {} : { reason: result.transfer.reason }),
    ...(result.transfer.strength === undefined ? {} : { strength: result.transfer.strength }),
    ...(result.transfer.catalogKey === undefined ? {} : { catalogKey: result.transfer.catalogKey }),
  });
}

function instructionSnapshot(
  instruction: AArch64RewriteableInstruction,
): AArch64BackendInstructionSnapshot {
  return Object.freeze({
    stableKey: instruction.stableKey,
    opcode: instruction.opcode,
    operands: Object.freeze((instruction.operands ?? []).map(stableJson)),
    provenance: Object.freeze(
      instruction.provenanceSource === undefined ? [] : [instruction.provenanceSource],
    ),
  });
}
