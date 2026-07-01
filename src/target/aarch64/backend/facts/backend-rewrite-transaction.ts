import type { FactTransferBehavior } from "../../../../shared/facts/fact-transfer";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "../api/diagnostics";
import { verifierRun, type AArch64BackendVerifierRun } from "../api/verification-summary";

export type AArch64BackendRewriteKind =
  | "instruction-replacement"
  | "block-local-rewrite"
  | "edge-split"
  | "spill-insertion"
  | "rematerialization"
  | "move-resolution"
  | "frame-layout-rewrite"
  | "section-layout-rewrite"
  | "whole-function-rewrite"
  | "closed-image-metadata-rewrite";

export interface AArch64BackendInstructionSnapshot {
  readonly stableKey: string;
  readonly opcode: string;
  readonly operands: readonly string[];
  readonly provenance: readonly string[];
}

export interface AArch64BackendRewriteSnapshot {
  readonly instructions: readonly AArch64BackendInstructionSnapshot[];
  readonly factTransfers: readonly AArch64CommittedFactTransfer[];
  readonly provenance: readonly AArch64RewriteProvenanceRecord[];
}

export type AArch64FactTransferPlan =
  | {
      readonly behavior: Exclude<FactTransferBehavior, "reject">;
      readonly sourceKey: string;
      readonly destinationKeys: readonly string[];
      readonly extensionKey?: string;
      readonly reason?: string;
      readonly strength?: string;
      readonly catalogKey?: string;
    }
  | {
      readonly behavior: Extract<FactTransferBehavior, "reject">;
      readonly extensionKey: string;
      readonly subjectKey: string;
      readonly reason: string;
    };

export interface AArch64CommittedFactTransfer {
  readonly behavior: Exclude<FactTransferBehavior, "reject">;
  readonly sourceKey: string;
  readonly destinationKeys: readonly string[];
  readonly extensionKey: string;
  readonly reason?: string;
  readonly strength?: string;
  readonly catalogKey?: string;
}

export interface AArch64RewriteProvenanceRecord {
  readonly stableKey: string;
  readonly sourceKey: string;
  readonly destinationKeys: readonly string[];
  readonly rewriteKind: AArch64BackendRewriteKind;
}

export interface AArch64ReplaceInstructionEdit {
  readonly oldInstructionKey: string;
  readonly replacements: readonly AArch64BackendInstructionSnapshot[];
  readonly transfer?: AArch64FactTransferPlan | readonly AArch64FactTransferPlan[];
}

export type AArch64BackendRewriteCommitResult =
  | {
      readonly kind: "ok";
      readonly snapshot: AArch64BackendRewriteSnapshot;
      readonly verifierPlan: readonly AArch64BackendVerifierRun[];
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly snapshot: AArch64BackendRewriteSnapshot;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    };

export interface AArch64BackendRewriteTransaction {
  readonly replaceInstruction: (
    edit: AArch64ReplaceInstructionEdit,
  ) => AArch64BackendRewriteTransaction;
  readonly commit: () => AArch64BackendRewriteCommitResult;
}

export function beginAArch64BackendRewriteTransaction(input: {
  readonly kind: AArch64BackendRewriteKind;
  readonly snapshot: AArch64BackendRewriteSnapshot;
}): AArch64BackendRewriteTransaction {
  const edits: AArch64ReplaceInstructionEdit[] = [];

  function transaction(): AArch64BackendRewriteTransaction {
    return Object.freeze({
      replaceInstruction(edit: AArch64ReplaceInstructionEdit) {
        edits.push(freezeReplaceInstructionEdit(edit));
        return transaction();
      },
      commit() {
        return commitRewrite(input.kind, input.snapshot, edits);
      },
    });
  }

  return transaction();
}

function freezeInstructionSnapshot(input: {
  readonly stableKey: string;
  readonly opcode: string;
  readonly operands?: readonly string[];
  readonly provenance?: readonly string[];
}): AArch64BackendInstructionSnapshot {
  return Object.freeze({
    stableKey: input.stableKey,
    opcode: input.opcode,
    operands: Object.freeze([...(input.operands ?? [])]),
    provenance: Object.freeze([...(input.provenance ?? [])]),
  });
}

function freezeRewriteSnapshot(
  input: {
    readonly instructions?: readonly AArch64BackendInstructionSnapshot[];
    readonly factTransfers?: readonly AArch64CommittedFactTransfer[];
    readonly provenance?: readonly AArch64RewriteProvenanceRecord[];
  } = {},
): AArch64BackendRewriteSnapshot {
  return Object.freeze({
    instructions: Object.freeze([...(input.instructions ?? [])]),
    factTransfers: Object.freeze([...(input.factTransfers ?? [])]),
    provenance: Object.freeze([...(input.provenance ?? [])]),
  });
}

export function moveFactTransferPlan(input: {
  readonly sourceKey: string;
  readonly destinationKey: string;
  readonly extensionKey?: string;
}): AArch64FactTransferPlan {
  return Object.freeze({
    behavior: "move",
    sourceKey: input.sourceKey,
    destinationKeys: Object.freeze([input.destinationKey]),
    extensionKey: input.extensionKey,
  });
}

export function rejectFactTransferPlan(input: {
  readonly extensionKey: string;
  readonly subjectKey: string;
  readonly reason: string;
}): AArch64FactTransferPlan {
  return Object.freeze({
    behavior: "reject",
    extensionKey: input.extensionKey,
    subjectKey: input.subjectKey,
    reason: input.reason,
  });
}

function commitRewrite(
  rewriteKind: AArch64BackendRewriteKind,
  snapshot: AArch64BackendRewriteSnapshot,
  edits: readonly AArch64ReplaceInstructionEdit[],
): AArch64BackendRewriteCommitResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  for (const edit of edits) {
    for (const transfer of transferPlansForEdit(edit)) {
      if (transfer.behavior === "reject") {
        diagnostics.push(
          aarch64BackendDiagnostic({
            code: "AARCH64_BACKEND_REWRITE_TRANSFER_INVALID",
            ownerKey: transfer.extensionKey,
            rootCauseKey: rewriteKind,
            stableDetail: `rewrite-transfer:rejected:${transfer.extensionKey}:${transfer.reason}:${transfer.subjectKey}`,
          }),
        );
      }
    }
  }
  if (diagnostics.length > 0) {
    return Object.freeze({
      kind: "error",
      snapshot,
      diagnostics: sortAArch64BackendDiagnostics(diagnostics),
    });
  }

  const replacements = new Map(edits.map((edit) => [edit.oldInstructionKey, edit]));
  const instructions: AArch64BackendInstructionSnapshot[] = [];
  const factTransfers: AArch64CommittedFactTransfer[] = [...snapshot.factTransfers];
  const provenance: AArch64RewriteProvenanceRecord[] = [...snapshot.provenance];
  for (const instruction of snapshot.instructions) {
    const edit = replacements.get(instruction.stableKey);
    if (edit === undefined) {
      instructions.push(instruction);
      continue;
    }
    instructions.push(...edit.replacements.map(freezeInstruction));
    for (const transfer of transferPlansForEdit(edit)) {
      if (transfer.behavior === "reject") continue;
      factTransfers.push({
        behavior: transfer.behavior,
        sourceKey: transfer.sourceKey,
        destinationKeys: Object.freeze([...transfer.destinationKeys]),
        extensionKey: transfer.extensionKey ?? "all",
        ...(transfer.reason === undefined ? {} : { reason: transfer.reason }),
        ...(transfer.strength === undefined ? {} : { strength: transfer.strength }),
        ...(transfer.catalogKey === undefined ? {} : { catalogKey: transfer.catalogKey }),
      });
    }
    provenance.push({
      stableKey: `rewrite:${rewriteKind}:${edit.oldInstructionKey}`,
      sourceKey: edit.oldInstructionKey,
      destinationKeys: Object.freeze(edit.replacements.map((replacement) => replacement.stableKey)),
      rewriteKind,
    });
  }

  return Object.freeze({
    kind: "ok",
    snapshot: freezeRewriteSnapshot({ instructions, factTransfers, provenance }),
    verifierPlan: Object.freeze([
      verifierRun({ verifierKey: "fact-transfer" }),
      verifierRun({ verifierKey: "provenance" }),
      verifierRun({ verifierKey: "security" }),
    ]),
    diagnostics: [],
  });
}

function freezeReplaceInstructionEdit(
  edit: AArch64ReplaceInstructionEdit,
): AArch64ReplaceInstructionEdit {
  return Object.freeze({
    oldInstructionKey: edit.oldInstructionKey,
    replacements: Object.freeze(edit.replacements.map(freezeInstruction)),
    ...(edit.transfer === undefined
      ? {}
      : {
          transfer: Array.isArray(edit.transfer)
            ? Object.freeze([...edit.transfer])
            : edit.transfer,
        }),
  });
}

function transferPlansForEdit(
  edit: AArch64ReplaceInstructionEdit,
): readonly AArch64FactTransferPlan[] {
  if (edit.transfer === undefined) return Object.freeze([]);
  return Object.freeze(Array.isArray(edit.transfer) ? [...edit.transfer] : [edit.transfer]);
}

function freezeInstruction(
  instruction: AArch64BackendInstructionSnapshot,
): AArch64BackendInstructionSnapshot {
  return freezeInstructionSnapshot(instruction);
}
