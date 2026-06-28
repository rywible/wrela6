import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type {
  ProofCheckDiagnostic,
  ProofCounterexampleFrame,
  ProofCounterexamplePath,
} from "../diagnostics";
import { proofCheckStateSnapshot } from "./state-key";
import type { ProofCheckState } from "./state";
import { proofCheckProgramPointKey, type ProofCheckProgramPoint } from "./transition-api";

export interface ProofCheckTransitionWitness {
  readonly pathFrameKey: string;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId?: ProofMirBlockId;
  readonly blockKey: string;
  readonly location: ProofCheckProgramPoint;
  readonly originKey: string;
  readonly inputState: ProofCheckState;
  readonly outputState: ProofCheckState;
  readonly failedComponentKeys: readonly string[];
  readonly predecessorPathFrameKey?: string;
}

export function proofCheckPathFrameKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly programPointKey: string;
  readonly stateKey: string;
}): string {
  return [
    `function:${String(input.functionInstanceId)}`,
    input.programPointKey,
    `state:${input.stateKey}`,
  ].join("/");
}

export function proofCheckBlockKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly blockLabel?: string;
}): string {
  if (input.blockLabel !== undefined && input.blockLabel.length > 0) {
    return input.blockLabel;
  }
  return String(input.blockId);
}

function counterexampleFrameForWitness(
  witness: ProofCheckTransitionWitness,
): ProofCounterexampleFrame {
  return {
    pathFrameKey: witness.pathFrameKey,
    functionInstanceId: String(witness.functionInstanceId),
    blockKey: witness.blockKey,
    programPointKey: proofCheckProgramPointKey(witness.location),
    originKey: witness.originKey,
    beforeState: proofCheckStateSnapshot(witness.inputState),
    afterState: proofCheckStateSnapshot(witness.outputState),
    failedComponentKeys: [...witness.failedComponentKeys],
  };
}

export function buildProofCounterexamplePath(input: {
  readonly witnesses: ReadonlyMap<string, ProofCheckTransitionWitness>;
  readonly terminalPathFrameKey: string;
}): ProofCounterexamplePath {
  const frames: ProofCounterexampleFrame[] = [];
  const visited = new Set<string>();
  let currentKey: string | undefined = input.terminalPathFrameKey;

  while (currentKey !== undefined && !visited.has(currentKey)) {
    visited.add(currentKey);
    const witness = input.witnesses.get(currentKey);
    if (witness === undefined) {
      break;
    }
    frames.unshift(counterexampleFrameForWitness(witness));
    currentKey = witness.predecessorPathFrameKey;
  }

  const pathKey = frames.map((frame) => frame.pathFrameKey).join(">");
  return {
    pathKey,
    frames,
  };
}

export function attachCounterexampleToDiagnostic(input: {
  readonly diagnostic: ProofCheckDiagnostic;
  readonly witnesses: ReadonlyMap<string, ProofCheckTransitionWitness>;
  readonly terminalPathFrameKey: string;
}): ProofCheckDiagnostic {
  const counterexample = buildProofCounterexamplePath({
    witnesses: input.witnesses,
    terminalPathFrameKey: input.terminalPathFrameKey,
  });
  return {
    ...input.diagnostic,
    counterexample,
    pathFrameKey: input.terminalPathFrameKey,
  };
}

export function sortTransitionWitnesses(
  witnesses: readonly ProofCheckTransitionWitness[],
): ProofCheckTransitionWitness[] {
  return [...witnesses].sort((left, right) =>
    compareCodeUnitStrings(left.pathFrameKey, right.pathFrameKey),
  );
}
