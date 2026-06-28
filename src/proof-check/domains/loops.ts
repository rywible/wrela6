import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId, ProofMirControlEdgeId } from "../../proof-mir/ids";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofSemanticsCompanion } from "../authority/semantics-companion";
import {
  proofCheckStateDigest,
  semanticsJudgmentSubjectKey,
  validateProofSemanticsJudgmentResult,
  type ProofLoopConvergenceJudgmentInput,
  type ProofLoopConvergenceJudgmentResult,
  type ProofSemanticsJudgmentRequest,
  type ProofStateJoinJudgmentInput,
} from "../authority/semantics-companion";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { ProofSemanticsCertificateId } from "../ids";
import type { ProofCheckTransitionId } from "../ids";
import {
  computeProofCheckCoreMeet,
  type ProofCheckJoinPolicyHooks,
} from "../kernel/graph-worklist";
import { proofCheckStateKey } from "../kernel/state-key";
import {
  proofCheckStatePatchWithTransitionId,
  type ProofCheckStatePatch,
  type ProofCheckPatchKind,
} from "../kernel/state-patch";
import { reduceProofCheckState } from "../kernel/state-reducer";
import type { ProofCheckState } from "../kernel/state";

export const DEFAULT_LOOP_VARIANT_KEY = "";

export type ProofLoopGenerationRoleKind = "entry" | "currentIteration" | "nextIteration" | "closed";

export interface ProofLoopGenerationRole {
  readonly placeKey: string;
  readonly role: ProofLoopGenerationRoleKind;
}

export interface ProofLoopVariantCertificate {
  readonly variantKey: string;
  readonly stateKey: string;
  readonly visitBound: number;
}

export interface ProofLoopReplayCertificate {
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly replayWitnessKey: string;
  readonly variantKey: string;
  readonly stateKey: string;
}

export interface ProofLoopConvergenceCertificate {
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly variantKeys: readonly string[];
  readonly loopCarriedResourceKeys: readonly string[];
  readonly generationRoles: readonly ProofLoopGenerationRole[];
  readonly invariantFactKeys: readonly string[];
  readonly allowedDroppedRefinementKeys: readonly string[];
  readonly visitBound: number;
  readonly finalReplayWitnessKey: string;
  readonly variants: readonly ProofLoopVariantCertificate[];
  readonly finalReplay: ProofLoopReplayCertificate;
  readonly certificateId: ProofSemanticsCertificateId;
}

export interface LoopConvergenceInput {
  readonly companion: ProofSemanticsCompanion;
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
  readonly incomingStates: readonly ProofCheckState[];
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly transitionId: ProofCheckTransitionId;
  readonly backedgeStates?: ReadonlyMap<string, ProofCheckState>;
  readonly variantKey?: string;
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly acceptedVariantStates?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly visitCounts?: ReadonlyMap<string, number>;
  readonly ownerKey?: string;
}

export type LoopConvergenceResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly meetKind: "exact" | "coreMeet" | "companion";
      readonly certificate?: ProofLoopConvergenceCertificate;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface StateJoinWithCompanionInput {
  readonly companion: ProofSemanticsCompanion;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly incomingStates: readonly ProofCheckState[];
  readonly coreMeetState: ProofCheckState;
  readonly transitionId: ProofCheckTransitionId;
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly ownerKey?: string;
}

export type StateJoinWithCompanionResult =
  | { readonly kind: "ok"; readonly state: ProofCheckState }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ProofCheckLoopJoinPolicyHooksInput {
  readonly companion: ProofSemanticsCompanion;
  readonly mir: ProofMirProgram;
  readonly dependencyKeys?: ReadonlySet<string>;
}

interface LoopJoinPolicyRuntimeState {
  readonly acceptedVariantStates: Map<string, Set<string>>;
  readonly visitCounts: Map<string, number>;
}

const LOOP_DEPENDENCY_PREFIX = "loop:";
const LOOP_EXACT_STATE_EQUALITY_KEY = "loop:exact-state-equality";

function defaultOwnerKey(ownerKey: string | undefined, suffix: string): string {
  return ownerKey ?? `proof-check:loops:${suffix}`;
}

function loopHeaderOwnerKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
  readonly ownerKey?: string;
}): string {
  return defaultOwnerKey(
    input.ownerKey,
    `loop:${String(input.functionInstanceId)}:${String(input.headerBlockId)}`,
  );
}

function joinOwnerKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly ownerKey?: string;
}): string {
  return defaultOwnerKey(
    input.ownerKey,
    `join:${String(input.functionInstanceId)}:${String(input.blockId)}`,
  );
}

function missingCompanionJudgmentDiagnostic(
  judgmentKind: string,
  ownerKey: string,
): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
    messageTemplateId: "proof-check.semantics-companion.missing-judgment",
    messageArguments: [{ kind: "text", value: judgmentKind }],
    message: `Missing companion judgment: ${judgmentKind}.`,
    ownerKey,
    rootCauseKey: "proof-check:semantics-companion",
    stableDetail: `missing-judgment:${judgmentKind}`,
  });
}

function loopConvergenceFailedDiagnostic(input: {
  readonly ownerKey: string;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_LOOP_CONVERGENCE_FAILED",
    messageTemplateId: "proof-check.loop-convergence.failed",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

function divergentJoinDiagnostic(input: {
  readonly ownerKey: string;
  readonly failedComponentKeys: readonly string[];
}): ProofCheckDiagnostic {
  const stableDetail = `divergent-components:${input.failedComponentKeys.join(",")}`;
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_DIVERGENT_JOIN",
    messageTemplateId: "proof-check.join.divergent",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail,
  });
}

function invalidStatePatchDiagnostics(
  diagnostics: readonly ProofCheckDiagnostic[],
  ownerKey: string,
): readonly ProofCheckDiagnostic[] {
  return sortProofCheckDiagnostics(
    diagnostics.map((diagnostic) =>
      proofCheckDiagnostic({
        ...diagnostic,
        ownerKey,
        rootCauseKey: ownerKey,
      }),
    ),
  );
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnitStrings);
}

function collectAllowedDropFactKeys(states: readonly ProofCheckState[]): readonly string[] {
  if (states.length === 0) {
    return [];
  }
  const [first, ...rest] = states;
  const keys = new Set(first!.facts.keys());
  for (const state of rest) {
    for (const factKey of keys) {
      const left = first!.facts.get(factKey);
      const right = state.facts.get(factKey);
      if (left === undefined || right === undefined || left.termKey !== right.termKey) {
        keys.delete(factKey);
      }
    }
  }
  const droppable: string[] = [];
  for (const state of states) {
    for (const factKey of state.facts.keys()) {
      if (!keys.has(factKey)) {
        droppable.push(factKey);
      }
    }
  }
  return sortedUnique(droppable);
}

function collectAllowedPacketSourceKeys(states: readonly ProofCheckState[]): readonly string[] {
  if (states.length === 0) {
    return [];
  }
  const [first, ...rest] = states;
  const keys = new Set(first!.packetSources.keys());
  for (const state of rest) {
    for (const key of keys) {
      const left = first!.packetSources.get(key)!;
      const right = state.packetSources.get(key);
      if (
        right === undefined ||
        left.packetKey !== right.packetKey ||
        left.sourceKey !== right.sourceKey
      ) {
        keys.delete(key);
      }
    }
  }
  const droppable: string[] = [];
  for (const state of states) {
    for (const key of state.packetSources.keys()) {
      const entry = state.packetSources.get(key)!;
      const packetSourceKey = `${entry.packetKey}->${entry.sourceKey}`;
      if (!keys.has(key)) {
        droppable.push(packetSourceKey);
      }
    }
  }
  return sortedUnique(droppable);
}

function loopHeaderBlock(
  mir: ProofMirProgram,
  functionInstanceId: MonoInstanceId,
  blockId: ProofMirBlockId,
) {
  const functionGraph = mir.functions.get(functionInstanceId);
  return functionGraph?.blocks.get(blockId);
}

function isLoopHeaderBlock(
  mir: ProofMirProgram,
  functionInstanceId: MonoInstanceId,
  blockId: ProofMirBlockId,
): boolean {
  return loopHeaderBlock(mir, functionInstanceId, blockId)?.stateMerge?.kind === "loopHeader";
}

function parseLoopGenerationRole(value: string): ProofLoopGenerationRoleKind | undefined {
  switch (value) {
    case "entry":
    case "currentIteration":
    case "nextIteration":
    case "closed":
      return value;
    default:
      return undefined;
  }
}

export function parseLoopConvergenceCertificate(input: {
  readonly judgmentInput: ProofLoopConvergenceJudgmentInput;
  readonly judgmentResult: ProofLoopConvergenceJudgmentResult;
  readonly incomingStateKeys: readonly string[];
  readonly variantKey: string;
}): ProofLoopConvergenceCertificate | undefined {
  const dependencyKeys = [...input.judgmentResult.dependencyKeys].sort(compareCodeUnitStrings);
  const backedgeIds = [...input.judgmentInput.backedgeIds].sort((left, right) =>
    compareCodeUnitStrings(String(left), String(right)),
  );
  const parsedVariantKeys = sortedUnique([
    ...input.judgmentInput.variantKeys,
    ...dependencyKeys
      .filter((key) => key.startsWith(`${LOOP_DEPENDENCY_PREFIX}variant:`))
      .map((key) => key.slice(`${LOOP_DEPENDENCY_PREFIX}variant:`.length)),
  ]);
  const variantKeys = parsedVariantKeys.length === 0 ? [input.variantKey] : parsedVariantKeys;

  let visitBound = 0;
  for (const key of dependencyKeys) {
    if (key.startsWith(`${LOOP_DEPENDENCY_PREFIX}visit-bound:`)) {
      const parsed = Number.parseInt(key.slice(`${LOOP_DEPENDENCY_PREFIX}visit-bound:`.length), 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        visitBound = parsed;
      }
    }
  }
  if (visitBound === 0) {
    visitBound = Math.max(1, variantKeys.length);
  }

  const loopCarriedResourceKeys = sortedUnique([
    ...dependencyKeys
      .filter((key) => key.startsWith(`${LOOP_DEPENDENCY_PREFIX}carried:`))
      .map((key) => key.slice(`${LOOP_DEPENDENCY_PREFIX}carried:`.length)),
    ...input.judgmentInput.loopCarriedPrivateStateKeys,
  ]);

  const generationRoles: ProofLoopGenerationRole[] = [];
  for (const key of dependencyKeys) {
    if (!key.startsWith(`${LOOP_DEPENDENCY_PREFIX}generation-role:`)) {
      continue;
    }
    const payload = key.slice(`${LOOP_DEPENDENCY_PREFIX}generation-role:`.length);
    const separator = payload.lastIndexOf(":");
    if (separator <= 0) {
      continue;
    }
    const placeKey = payload.slice(0, separator);
    const role = parseLoopGenerationRole(payload.slice(separator + 1));
    if (role !== undefined) {
      generationRoles.push({ placeKey, role });
    }
  }
  generationRoles.sort((left, right) =>
    compareCodeUnitStrings(`${left.placeKey}:${left.role}`, `${right.placeKey}:${right.role}`),
  );

  const invariantFactKeys = sortedUnique(
    dependencyKeys
      .filter((key) => key.startsWith(`${LOOP_DEPENDENCY_PREFIX}invariant:`))
      .map((key) => key.slice(`${LOOP_DEPENDENCY_PREFIX}invariant:`.length)),
  );

  const allowedDroppedRefinementKeys = sortedUnique(
    dependencyKeys
      .filter((key) => key.startsWith(`${LOOP_DEPENDENCY_PREFIX}dropped:`))
      .map((key) => key.slice(`${LOOP_DEPENDENCY_PREFIX}dropped:`.length)),
  );

  const replayWitnessKey = input.judgmentResult.replayWitnessKey;
  const headerStateKey = input.incomingStateKeys[0] ?? "";
  const variants: ProofLoopVariantCertificate[] = variantKeys.map((variantKey) => ({
    variantKey,
    stateKey: headerStateKey,
    visitBound,
  }));

  return {
    backedgeIds,
    variantKeys,
    loopCarriedResourceKeys,
    generationRoles,
    invariantFactKeys,
    allowedDroppedRefinementKeys,
    visitBound,
    finalReplayWitnessKey: replayWitnessKey,
    variants,
    finalReplay: {
      backedgeIds,
      replayWitnessKey,
      variantKey: input.variantKey,
      stateKey: headerStateKey,
    },
    certificateId: input.judgmentResult.certificateId,
  };
}

function companionDeclaresExactLoopStateEquality(dependencyKeys: ReadonlySet<string>): boolean {
  return dependencyKeys.has(LOOP_EXACT_STATE_EQUALITY_KEY);
}

function buildLoopConvergenceRequest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
  readonly incomingStates: readonly ProofCheckState[];
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly variantKey: string;
}): ProofSemanticsJudgmentRequest {
  const requestKey = `request:loop:${String(input.functionInstanceId)}:${String(input.headerBlockId)}`;
  const loopInput: ProofLoopConvergenceJudgmentInput = {
    requestKey,
    functionInstanceId: input.functionInstanceId,
    headerBlockId: input.headerBlockId,
    backedgeIds: [...input.backedgeIds],
    incomingStateDigests: input.incomingStates.map((state) =>
      proofCheckStateDigest(proofCheckStateKey(state)),
    ),
    variantKeys: [input.variantKey],
    loopCarriedPrivateStateKeys: sortedUnique(
      [...(input.incomingStates[0]?.privateState.keys() ?? [])].map((key) => {
        const entry = input.incomingStates[0]!.privateState.get(key)!;
        return entry.placeKey;
      }),
    ),
  };
  return { kind: "loopConvergence", input: loopInput };
}

function buildStateJoinRequest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly incomingStates: readonly ProofCheckState[];
}): ProofSemanticsJudgmentRequest {
  const requestKey = `request:state-join:${String(input.functionInstanceId)}:${String(input.blockId)}`;
  const joinInput: ProofStateJoinJudgmentInput = {
    requestKey,
    functionInstanceId: input.functionInstanceId,
    blockId: input.blockId,
    incomingStateDigests: input.incomingStates.map((state) =>
      proofCheckStateDigest(proofCheckStateKey(state)),
    ),
    allowedDropFactKeys: collectAllowedDropFactKeys(input.incomingStates),
    allowedPacketSourceKeys: collectAllowedPacketSourceKeys(input.incomingStates),
  };
  return { kind: "stateJoin", input: joinInput };
}

function applyCompanionPatch(input: {
  readonly state: ProofCheckState;
  readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
  readonly transitionId: ProofCheckTransitionId;
  readonly ownerKey: string;
}):
  | { readonly kind: "ok"; readonly state: ProofCheckState }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  const reduction = reduceProofCheckState(
    input.state,
    proofCheckStatePatchWithTransitionId(input.patch, input.transitionId),
  );
  if (reduction.kind === "error") {
    return {
      kind: "error",
      diagnostics: invalidStatePatchDiagnostics(reduction.diagnostics, input.ownerKey),
    };
  }
  return { kind: "ok", state: reduction.state };
}

function visitCountKey(input: {
  readonly headerBlockId: ProofMirBlockId;
  readonly variantKey: string;
  readonly stateKey: string;
}): string {
  return `${String(input.headerBlockId)}:${input.variantKey}:${input.stateKey}`;
}

function verifyReplayWitness(input: {
  readonly certificate: ProofLoopConvergenceCertificate;
  readonly variantKey: string;
  readonly stateKey: string;
  readonly acceptedVariantStates: ReadonlyMap<string, ReadonlySet<string>>;
  readonly backedgeStates?: ReadonlyMap<string, ProofCheckState>;
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  const accepted = input.acceptedVariantStates.get(input.variantKey);
  if (accepted === undefined || !accepted.has(input.stateKey)) {
    return [
      loopConvergenceFailedDiagnostic({
        ownerKey: input.ownerKey,
        stableDetail: `replay-not-accepted:${input.variantKey}:${input.stateKey}`,
      }),
    ];
  }

  if (input.backedgeStates === undefined) {
    return [];
  }

  for (const backedgeId of input.certificate.backedgeIds) {
    const backedgeState = input.backedgeStates.get(String(backedgeId));
    if (backedgeState === undefined) {
      continue;
    }
    const backedgeStateKey = proofCheckStateKey(backedgeState);
    if (!accepted.has(backedgeStateKey)) {
      return [
        loopConvergenceFailedDiagnostic({
          ownerKey: input.ownerKey,
          stableDetail: `backedge-replay-miss:${String(backedgeId)}:${backedgeStateKey}`,
        }),
      ];
    }
  }

  if (input.certificate.finalReplayWitnessKey.length === 0) {
    return [
      loopConvergenceFailedDiagnostic({
        ownerKey: input.ownerKey,
        stableDetail: "missing-final-replay-witness",
      }),
    ];
  }

  return [];
}

function recordAcceptedVariantState(
  runtime: LoopJoinPolicyRuntimeState,
  variantKey: string,
  stateKey: string,
): void {
  const bucket = runtime.acceptedVariantStates.get(variantKey) ?? new Set<string>();
  bucket.add(stateKey);
  runtime.acceptedVariantStates.set(variantKey, bucket);
}

function incrementVisitCount(
  runtime: LoopJoinPolicyRuntimeState,
  headerBlockId: ProofMirBlockId,
  variantKey: string,
  stateKey: string,
): number {
  const key = visitCountKey({ headerBlockId, variantKey, stateKey });
  const next = (runtime.visitCounts.get(key) ?? 0) + 1;
  runtime.visitCounts.set(key, next);
  return next;
}

export function checkStateJoinWithCompanion(
  input: StateJoinWithCompanionInput,
): StateJoinWithCompanionResult {
  const ownerKey = joinOwnerKey(input);
  const dependencyKeys = input.dependencyKeys ?? new Set<string>();
  const request = buildStateJoinRequest({
    functionInstanceId: input.functionInstanceId,
    blockId: input.blockId,
    incomingStates: input.incomingStates,
  });

  const validation = validateProofSemanticsJudgmentResult({
    companion: input.companion,
    request,
    dependencyKeys,
  });
  if (validation.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(
        validation.diagnostics.map((diagnostic) =>
          proofCheckDiagnostic({
            ...diagnostic,
            ownerKey,
            rootCauseKey: ownerKey,
          }),
        ),
      ),
    };
  }
  if (validation.result.kind !== "stateJoin") {
    return {
      kind: "error",
      diagnostics: [missingCompanionJudgmentDiagnostic("stateJoin", ownerKey)],
    };
  }

  const applied = applyCompanionPatch({
    state: input.coreMeetState,
    patch: validation.result.patch as ProofCheckStatePatch<ProofCheckPatchKind>,
    transitionId: input.transitionId,
    ownerKey,
  });
  if (applied.kind === "error") {
    return applied;
  }

  return { kind: "ok", state: applied.state };
}

export function checkLoopConvergence(input: LoopConvergenceInput): LoopConvergenceResult {
  const ownerKey = loopHeaderOwnerKey(input);
  const dependencyKeys = input.dependencyKeys ?? new Set<string>();
  const variantKey = input.variantKey ?? "";
  const incomingStates = input.incomingStates;

  if (incomingStates.length === 0) {
    return {
      kind: "error",
      diagnostics: [
        loopConvergenceFailedDiagnostic({
          ownerKey,
          stableDetail: "missing-incoming-states",
        }),
      ],
    };
  }

  const meet = computeProofCheckCoreMeet(incomingStates);
  if (meet === undefined) {
    return {
      kind: "error",
      diagnostics: [
        loopConvergenceFailedDiagnostic({
          ownerKey,
          stableDetail: "missing-core-meet",
        }),
      ],
    };
  }

  if (meet.kind === "exact") {
    return {
      kind: "ok",
      state: meet.state,
      meetKind: "exact",
    };
  }

  if (meet.kind === "failed") {
    return {
      kind: "error",
      diagnostics: [
        divergentJoinDiagnostic({
          ownerKey,
          failedComponentKeys: meet.failedComponentKeys,
        }),
      ],
    };
  }

  if (dependencyKeys.has(LOOP_EXACT_STATE_EQUALITY_KEY)) {
    return {
      kind: "ok",
      state: meet.state,
      meetKind: "companion",
    };
  }

  const request = buildLoopConvergenceRequest({
    functionInstanceId: input.functionInstanceId,
    headerBlockId: input.headerBlockId,
    incomingStates,
    backedgeIds: input.backedgeIds,
    variantKey,
  });

  const validation = validateProofSemanticsJudgmentResult({
    companion: input.companion,
    request,
    dependencyKeys,
  });
  if (validation.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(
        validation.diagnostics.map((diagnostic) =>
          proofCheckDiagnostic({
            ...diagnostic,
            ownerKey,
            rootCauseKey: ownerKey,
          }),
        ),
      ),
    };
  }
  if (validation.result.kind !== "loopConvergence") {
    return {
      kind: "error",
      diagnostics: [missingCompanionJudgmentDiagnostic("loopConvergence", ownerKey)],
    };
  }

  const loopRequest =
    request.kind === "loopConvergence"
      ? request
      : (() => {
          throw new RangeError("checkLoopConvergence requires a loopConvergence request.");
        })();
  const certificate = parseLoopConvergenceCertificate({
    judgmentInput: loopRequest.input,
    judgmentResult: validation.result,
    incomingStateKeys: incomingStates.map((state) => proofCheckStateKey(state)),
    variantKey,
  });
  if (certificate === undefined) {
    return {
      kind: "error",
      diagnostics: [
        loopConvergenceFailedDiagnostic({
          ownerKey,
          stableDetail: "invalid-loop-certificate",
        }),
      ],
    };
  }

  const applied = applyCompanionPatch({
    state: meet.state,
    patch: validation.result.patch as ProofCheckStatePatch<ProofCheckPatchKind>,
    transitionId: input.transitionId,
    ownerKey,
  });
  if (applied.kind === "error") {
    return applied;
  }

  const resultStateKey = proofCheckStateKey(applied.state);
  const acceptedVariantStates = input.acceptedVariantStates ?? new Map<string, Set<string>>();
  const visitCounts = input.visitCounts ?? new Map<string, number>();
  const visitKey = visitCountKey({
    headerBlockId: input.headerBlockId,
    variantKey,
    stateKey: resultStateKey,
  });
  const nextVisitCount = (visitCounts.get(visitKey) ?? 0) + 1;

  if (nextVisitCount <= certificate.visitBound) {
    // Visit accounting is owned by proofCheckLoopJoinPolicyHooks runtime state.
  } else if (nextVisitCount === certificate.visitBound + 1) {
    const replayDiagnostics = verifyReplayWitness({
      certificate,
      variantKey,
      stateKey: resultStateKey,
      acceptedVariantStates,
      ...(input.backedgeStates !== undefined ? { backedgeStates: input.backedgeStates } : {}),
      ownerKey,
    });
    if (replayDiagnostics.length > 0) {
      return { kind: "error", diagnostics: replayDiagnostics };
    }
  } else {
    return {
      kind: "error",
      diagnostics: [
        loopConvergenceFailedDiagnostic({
          ownerKey,
          stableDetail: `visit-bound-exceeded:${variantKey}:${resultStateKey}:${nextVisitCount}`,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    state: applied.state,
    meetKind: "companion",
    certificate,
  };
}

export function proofCheckLoopJoinPolicyHooks(
  input: ProofCheckLoopJoinPolicyHooksInput,
): ProofCheckJoinPolicyHooks {
  const dependencyKeys = input.dependencyKeys ?? new Set<string>();
  const runtime: LoopJoinPolicyRuntimeState = {
    acceptedVariantStates: new Map<string, Set<string>>(),
    visitCounts: new Map<string, number>(),
  };

  const resolveLoopHeaderJoin = (hookInput: {
    readonly functionInstanceId: MonoInstanceId;
    readonly blockId: ProofMirBlockId;
    readonly incomingStates: readonly ProofCheckState[];
    readonly transitionId: ProofCheckTransitionId;
  }) => {
    const block = loopHeaderBlock(input.mir, hookInput.functionInstanceId, hookInput.blockId);
    const backedgeIds = [...(block?.incomingEdges ?? [])].sort((left, right) =>
      compareCodeUnitStrings(String(left), String(right)),
    );
    const variantKey = DEFAULT_LOOP_VARIANT_KEY;

    const meet = computeProofCheckCoreMeet(hookInput.incomingStates);
    if (meet?.kind === "exact") {
      const stateKey = proofCheckStateKey(meet.state);
      recordAcceptedVariantState(runtime, variantKey, stateKey);
      return { kind: "accept" as const, state: meet.state };
    }

    if (meet?.kind === "coreMeet" && companionDeclaresExactLoopStateEquality(dependencyKeys)) {
      const stateKey = proofCheckStateKey(meet.state);
      recordAcceptedVariantState(runtime, variantKey, stateKey);
      return { kind: "accept" as const, state: meet.state };
    }

    const result = checkLoopConvergence({
      companion: input.companion,
      functionInstanceId: hookInput.functionInstanceId,
      headerBlockId: hookInput.blockId,
      incomingStates: hookInput.incomingStates,
      backedgeIds,
      transitionId: hookInput.transitionId,
      variantKey,
      dependencyKeys,
      acceptedVariantStates: runtime.acceptedVariantStates,
      visitCounts: runtime.visitCounts,
    });

    if (result.kind === "error") {
      return { kind: "reject" as const, diagnostics: result.diagnostics };
    }

    const stateKey = proofCheckStateKey(result.state);
    recordAcceptedVariantState(runtime, variantKey, stateKey);
    incrementVisitCount(runtime, hookInput.blockId, variantKey, stateKey);

    return { kind: "accept" as const, state: result.state };
  };

  return {
    resolveNonExactJoin: (hookInput) => {
      if (isLoopHeaderBlock(input.mir, hookInput.functionInstanceId, hookInput.blockId)) {
        return resolveLoopHeaderJoin(hookInput);
      }

      const result = checkStateJoinWithCompanion({
        companion: input.companion,
        functionInstanceId: hookInput.functionInstanceId,
        blockId: hookInput.blockId,
        incomingStates: hookInput.incomingStates,
        coreMeetState: hookInput.coreMeetState,
        transitionId: hookInput.transitionId,
        dependencyKeys,
      });
      if (result.kind === "error") {
        return { kind: "reject", diagnostics: result.diagnostics };
      }
      return { kind: "accept", state: result.state };
    },
    resolveLoopHeaderJoin,
  };
}

export function loopConvergenceSubjectKey(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
}): string {
  return semanticsJudgmentSubjectKey({
    kind: "loopConvergence",
    input: {
      requestKey: "request:loop",
      functionInstanceId: input.functionInstanceId,
      headerBlockId: input.headerBlockId,
      backedgeIds: [],
      incomingStateDigests: [],
      variantKeys: [],
      loopCarriedPrivateStateKeys: [],
    } satisfies ProofLoopConvergenceJudgmentInput,
  });
}
