import type { MonoInstanceId } from "../../mono/ids";
import type {
  ProofMirBlockId,
  ProofMirControlEdgeId,
  ProofMirExitEdgeId,
  ProofMirOwnedCallId,
  ProofMirStatementId,
  ProofMirTerminatorId,
} from "../../proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../proof-mir/model/calls";
import type {
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirStatement,
  ProofMirTerminator,
} from "../../proof-mir/model/graph";
import { sortProofCheckDiagnostics, type ProofCheckDiagnostic } from "../diagnostics";
import type { ProofCheckTransitionId } from "../ids";
import type { CheckedTerminalClosureKey, ProofCheckCertificateId } from "../model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedOriginFact,
} from "../model/fact-packet";
import type { ProofCheckPacketStage } from "./packet-stage";
import { proofCheckStateKey } from "./state-key";
import type { ProofCheckPatchKind, ProofCheckStatePatch } from "./state-patch";
import { reduceProofCheckState, type ProofCheckStateReductionResult } from "./state-reducer";
import type { ProofCheckState } from "./state";
import type { ProofCheckRegistrySideEffect } from "./registry/registry-effects";

export const PROOF_CHECK_OPERATION_KINDS = [
  "functionEntry",
  "statement",
  "terminator",
  "edge",
  "call",
  "join",
  "loopHeader",
  "exit",
  "terminalClosure",
] as const;

export type ProofCheckOperationKind = (typeof PROOF_CHECK_OPERATION_KINDS)[number];

const PROOF_CHECK_OPERATION_KIND_SET: ReadonlySet<string> = new Set(PROOF_CHECK_OPERATION_KINDS);

export function proofCheckOperationKind(value: string): ProofCheckOperationKind {
  if (!PROOF_CHECK_OPERATION_KIND_SET.has(value)) {
    throw new RangeError(`Unknown proof-check operation kind: ${value}.`);
  }
  return value as ProofCheckOperationKind;
}

export type ProofCheckOperation =
  | { readonly kind: "functionEntry"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "statement"; readonly statement: ProofMirStatement }
  | { readonly kind: "terminator"; readonly terminator: ProofMirTerminator }
  | { readonly kind: "edge"; readonly edge: ProofMirControlEdge }
  | { readonly kind: "call"; readonly call: ProofMirCallGraphEdge }
  | { readonly kind: "join"; readonly blockId: ProofMirBlockId }
  | { readonly kind: "loopHeader"; readonly blockId: ProofMirBlockId }
  | { readonly kind: "exit"; readonly exit: ProofMirExitEdge }
  | { readonly kind: "terminalClosure"; readonly terminalKey: CheckedTerminalClosureKey };

export type ProofCheckProgramPoint =
  | { readonly kind: "functionEntry"; readonly functionInstanceId: MonoInstanceId }
  | {
      readonly kind: "statement";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
      readonly statementId: ProofMirStatementId;
    }
  | {
      readonly kind: "terminator";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
      readonly terminatorId: ProofMirTerminatorId;
    }
  | {
      readonly kind: "edge";
      readonly functionInstanceId: MonoInstanceId;
      readonly edgeId: ProofMirControlEdgeId;
    }
  | {
      readonly kind: "join";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
    }
  | {
      readonly kind: "loopHeader";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
    }
  | {
      readonly kind: "call";
      readonly functionInstanceId: MonoInstanceId;
      readonly callId: ProofMirOwnedCallId;
    }
  | {
      readonly kind: "exit";
      readonly functionInstanceId: MonoInstanceId;
      readonly exitId: ProofMirExitEdgeId;
    }
  | { readonly kind: "terminalClosure"; readonly terminalKey: CheckedTerminalClosureKey };

export interface ProofCheckTransition {
  readonly transitionId: ProofCheckTransitionId;
  readonly functionInstanceId: MonoInstanceId;
  readonly location: ProofCheckProgramPoint;
  readonly inputState: ProofCheckState;
  readonly operation: ProofCheckOperation;
}

export type ProofCheckTransitionResult =
  | {
      readonly kind: "ok";
      readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
      readonly stagedOrigins?: readonly CheckedOriginFact[];
      readonly registryEffects?: readonly ProofCheckRegistrySideEffect[];
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type ProofCheckTransitionApplicationResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly state: ProofCheckState;
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    };

export type { ProofCheckPacketStage, ProofCheckStagedPacketEntry } from "./packet-stage";
export { createProofCheckPacketStage } from "./packet-stage";

export function proofCheckOperationKindOf(operation: ProofCheckOperation): ProofCheckOperationKind {
  return proofCheckOperationKind(operation.kind);
}

export function proofCheckProgramPointKey(location: ProofCheckProgramPoint): string {
  switch (location.kind) {
    case "functionEntry":
      return `functionEntry:function:${String(location.functionInstanceId)}`;
    case "statement":
      return [
        "statement",
        `function:${String(location.functionInstanceId)}`,
        `block:${String(location.blockId)}`,
        `statement:${String(location.statementId)}`,
      ].join("/");
    case "terminator":
      return [
        "terminator",
        `function:${String(location.functionInstanceId)}`,
        `block:${String(location.blockId)}`,
        `terminator:${String(location.terminatorId)}`,
      ].join("/");
    case "edge":
      return `edge:function:${String(location.functionInstanceId)}/edge:${String(location.edgeId)}`;
    case "join":
      return `join:function:${String(location.functionInstanceId)}/block:${String(location.blockId)}`;
    case "loopHeader":
      return `loopHeader:function:${String(location.functionInstanceId)}/block:${String(location.blockId)}`;
    case "call":
      return `call:function:${String(location.functionInstanceId)}/call:${String(location.callId.callId)}`;
    case "exit":
      return `exit:function:${String(location.functionInstanceId)}/exit:${String(location.exitId)}`;
    case "terminalClosure":
      return `terminalClosure:${location.terminalKey}`;
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

function commitBlockIdForTransition(transition: ProofCheckTransition): ProofMirBlockId | undefined {
  switch (transition.location.kind) {
    case "join":
    case "loopHeader":
      return transition.location.blockId;
    case "statement":
    case "terminator":
      return transition.location.blockId;
    case "edge": {
      const operation = transition.operation;
      if (operation.kind === "edge") {
        return operation.edge.toBlockId;
      }
      return undefined;
    }
    case "functionEntry":
      return undefined;
    case "call":
    case "exit":
    case "terminalClosure":
      return undefined;
    default: {
      const unreachable: never = transition.location;
      return unreachable;
    }
  }
}

function transitionCertificateForResult(
  transfer: Extract<ProofCheckTransitionResult, { readonly kind: "ok" }>,
): ProofCheckCertificateId {
  if (transfer.certificates.length > 0) {
    return transfer.certificates[0]!;
  }
  return transfer.patch.certificate;
}

function stageTransferOrigins(input: {
  readonly stage: ProofCheckPacketStage;
  readonly transfer: Extract<ProofCheckTransitionResult, { readonly kind: "ok" }>;
}): void {
  if (input.transfer.stagedOrigins === undefined) {
    return;
  }
  for (const origin of input.transfer.stagedOrigins) {
    input.stage.stageOrigin(origin);
  }
}

function stagePacketEntries(input: {
  readonly stage: ProofCheckPacketStage;
  readonly transition: ProofCheckTransition;
  readonly inputState: ProofCheckState;
  readonly transfer: Extract<ProofCheckTransitionResult, { readonly kind: "ok" }>;
}): void {
  const commitBlockId = commitBlockIdForTransition(input.transition);
  if (commitBlockId === undefined) {
    return;
  }

  const transitionCertificate = transitionCertificateForResult(input.transfer);
  const anchorStateKey = proofCheckStateKey(input.inputState);

  for (const entry of input.transfer.packetEntries) {
    input.stage.stage({
      entry,
      anchorStateKey,
      transitionCertificate,
      commitBlockId,
    });
  }
}

export function stageTransferPacketEntriesForBlock(input: {
  readonly stage: ProofCheckPacketStage;
  readonly transition: ProofCheckTransition;
  readonly inputState: ProofCheckState;
  readonly transfer: Extract<ProofCheckTransitionResult, { readonly kind: "ok" }>;
  readonly commitBlockId: ProofMirBlockId;
}): void {
  const transitionCertificate = transitionCertificateForResult(input.transfer);
  const anchorStateKey = proofCheckStateKey(input.inputState);

  for (const entry of input.transfer.packetEntries) {
    input.stage.stage({
      entry,
      anchorStateKey,
      transitionCertificate,
      commitBlockId: input.commitBlockId,
    });
  }
}

export function applyProofCheckTransitionResult(input: {
  readonly state: ProofCheckState;
  readonly staged: ProofCheckPacketStage;
  readonly transition: ProofCheckTransition;
  readonly transfer: ProofCheckTransitionResult;
}): ProofCheckTransitionApplicationResult {
  if (input.transfer.kind === "error") {
    return {
      kind: "error",
      state: input.state,
      diagnostics: sortProofCheckDiagnostics(input.transfer.diagnostics),
    };
  }

  const patch: ProofCheckStatePatch<ProofCheckPatchKind> = {
    ...input.transfer.patch,
    transitionId: input.transition.transitionId,
  };
  const reduction: ProofCheckStateReductionResult = reduceProofCheckState(input.state, patch);
  if (reduction.kind === "error") {
    return {
      kind: "error",
      state: input.state,
      diagnostics: sortProofCheckDiagnostics(reduction.diagnostics),
    };
  }

  stagePacketEntries({
    stage: input.staged,
    transition: input.transition,
    inputState: input.state,
    transfer: input.transfer,
  });
  stageTransferOrigins({
    stage: input.staged,
    transfer: input.transfer,
  });

  return {
    kind: "ok",
    state: reduction.state,
    diagnostics: sortProofCheckDiagnostics(input.transfer.diagnostics),
  };
}

export function acceptProofCheckBlockEntryState(input: {
  readonly staged: ProofCheckPacketStage;
  readonly blockId: ProofMirBlockId;
}): void {
  input.staged.commit(input.blockId);
}

export function discardStagedPacketEntriesForStateKey(input: {
  readonly staged: ProofCheckPacketStage;
  readonly stateKey: string;
}): void {
  input.staged.discard(input.stateKey);
}
