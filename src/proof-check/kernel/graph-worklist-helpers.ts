import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId, ProofMirControlEdgeId, ProofMirOriginId } from "../../proof-mir/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import { proofCheckBlockKey } from "./counterexample-builder";
import { proofCheckProgramPointKey, type ProofCheckProgramPoint } from "./transition-api";
import type { ProofCheckTransitionResult } from "./transition-api";
import {
  applyProofCheckRegistrySideEffects,
  applyProofCheckRegistrySideEffectsToArtifacts,
  type ProofCheckFunctionRegistryArtifactsMutable,
  type ProofCheckRegistryAccumulator,
} from "./registry/registry-effects";

export function blockIdForProgramPoint(
  location: ProofCheckProgramPoint,
  functionGraph: ProofMirFunction,
): ProofMirBlockId | undefined {
  switch (location.kind) {
    case "statement":
    case "terminator":
    case "join":
    case "loopHeader":
      return location.blockId;
    case "edge":
      return functionGraph.edges.get(location.edgeId)?.fromBlockId;
    case "functionEntry":
      return functionGraph.entryBlockId;
    case "call":
    case "terminalClosure":
      return undefined;
    case "exit": {
      const exit = functionGraph.exits.find((candidate) => candidate.exitId === location.exitId);
      return exit?.fromBlockId;
    }
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

export function blockLabelFor(
  blockLabels: ReadonlyMap<ProofMirBlockId, string> | undefined,
  blockId: ProofMirBlockId,
): string | undefined {
  return blockLabels?.get(blockId);
}

export function joinRootCauseKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly blockLabels?: ReadonlyMap<ProofMirBlockId, string>;
}): string {
  return `join:block:${proofCheckBlockKey({
    functionInstanceId: input.functionInstanceId,
    blockId: input.blockId,
    blockLabel: blockLabelFor(input.blockLabels, input.blockId),
  })}`;
}

export function joinOwnerKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
}): string {
  return proofCheckProgramPointKey({
    kind: "join",
    functionInstanceId: input.functionInstanceId,
    blockId: input.blockId,
  });
}

export function sortOutgoingEdgeIds(
  edgeIds: readonly ProofMirControlEdgeId[],
): ProofMirControlEdgeId[] {
  return [...edgeIds].sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

export function sortIncomingEdgeIds(
  edgeIds: readonly ProofMirControlEdgeId[],
): ProofMirControlEdgeId[] {
  return [...edgeIds].sort((left, right) => compareCodeUnitStrings(String(left), String(right)));
}

export function originKeyFor(originId: ProofMirOriginId): string {
  return `origin:${String(originId)}`;
}

export function divergentJoinDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly blockLabels?: ReadonlyMap<ProofMirBlockId, string>;
  readonly failedComponentKeys: readonly string[];
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  const rootCauseKey = joinRootCauseKey(input);
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_DIVERGENT_JOIN",
    messageTemplateId: "proof-check.join.divergent",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: joinOwnerKey(input),
    rootCauseKey,
    stableDetail: input.stableDetail,
    functionInstanceId: input.functionInstanceId,
    pathFrameKey: joinOwnerKey(input),
  });
}

export function applyTransitionRegistryEffects(input: {
  readonly registryAccumulator?: ProofCheckRegistryAccumulator;
  readonly registryArtifacts?: ProofCheckFunctionRegistryArtifactsMutable;
  readonly functionInstanceId: MonoInstanceId;
  readonly transfer: ProofCheckTransitionResult;
}): void {
  if (
    input.transfer.kind !== "ok" ||
    input.transfer.registryEffects === undefined ||
    input.transfer.registryEffects.length === 0
  ) {
    return;
  }
  if (input.registryArtifacts !== undefined) {
    applyProofCheckRegistrySideEffectsToArtifacts({
      artifacts: input.registryArtifacts,
      effects: input.transfer.registryEffects,
    });
  }
  if (input.registryAccumulator !== undefined) {
    applyProofCheckRegistrySideEffects({
      accumulator: input.registryAccumulator,
      functionInstanceId: input.functionInstanceId,
      effects: input.transfer.registryEffects,
    });
  }
}
