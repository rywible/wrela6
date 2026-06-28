import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import { type ProofCheckResourceLimitKey, type ProofCheckResourceLimits } from "../input-contract";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import { proofCheckStateKey } from "./state-key";
import type { ProofCheckState } from "./state";
import { proofCheckProgramPointKey, type ProofCheckProgramPoint } from "./transition-api";

export type ProofCheckResourceLimitHookResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ProofCheckResourceLimitHooks {
  readonly beforeAcceptState?: (input: {
    readonly functionInstanceId: MonoInstanceId;
    readonly blockId: ProofMirBlockId;
    readonly state: ProofCheckState;
    readonly stagedPacketEntryCount?: number;
    readonly counterexampleFrameCount?: number;
  }) => ProofCheckResourceLimitHookResult;
  readonly beforeRecordTransition?: (input: {
    readonly functionInstanceId: MonoInstanceId;
    readonly location: ProofCheckProgramPoint;
    readonly state: ProofCheckState;
  }) => ProofCheckResourceLimitHookResult;
}

export type { ProofCheckResourceLimits };

export interface ProofCheckResourceLimitMetrics {
  readonly reachableFunctionCount?: number;
  readonly blockCount?: number;
  readonly edgeCount?: number;
  readonly acceptedStateVariantCount?: number;
  readonly stagedPacketEntryCount?: number;
  readonly counterexampleFrameCount?: number;
}

export interface EnforceProofCheckResourceLimitsInput {
  readonly limits: ProofCheckResourceLimits;
  readonly location: ProofCheckProgramPoint;
  readonly state: ProofCheckState;
  readonly metrics?: ProofCheckResourceLimitMetrics;
}

export type EnforceProofCheckResourceLimitsResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export function proofCheckResourceLimitsForTest(): ProofCheckResourceLimits {
  return {
    maximumReachableFunctions: 256,
    maximumBlocksPerFunction: 512,
    maximumEdgesPerFunction: 1024,
    maximumAcceptedStateVariantsPerBlock: 64,
    maximumActiveFactsPerState: 512,
    maximumActiveLoansPerState: 128,
    maximumOpenObligationsPerState: 128,
    maximumOpenValidationsPerState: 64,
    maximumOpenAttemptsPerState: 64,
    maximumLiveCapabilitiesPerState: 128,
    maximumCounterexampleFrames: 64,
    maximumStagedPacketEntriesPerFunction: 512,
  };
}

function countOpenObligations(state: ProofCheckState): number {
  let count = 0;
  for (const obligation of state.obligations.values()) {
    if (obligation.status === "open") {
      count += 1;
    }
  }
  return count;
}

function countOpenValidations(state: ProofCheckState): number {
  let count = 0;
  for (const validation of state.validations.values()) {
    if (validation.status === "pending" || validation.status === "live") {
      count += 1;
    }
  }
  return count;
}

function countOpenAttempts(state: ProofCheckState): number {
  let count = 0;
  for (const attempt of state.attempts.values()) {
    if (attempt.status === "pending" || attempt.status === "live") {
      count += 1;
    }
  }
  return count;
}

function functionInstanceIdFromProgramPoint(location: ProofCheckProgramPoint): MonoInstanceId {
  switch (location.kind) {
    case "functionEntry":
      return location.functionInstanceId;
    case "statement":
    case "terminator":
    case "edge":
    case "join":
    case "loopHeader":
    case "call":
    case "exit":
      return location.functionInstanceId;
    case "terminalClosure":
      throw new RangeError("terminalClosure program points do not belong to a function instance.");
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

function blockIdFromProgramPoint(location: ProofCheckProgramPoint): ProofMirBlockId | undefined {
  switch (location.kind) {
    case "statement":
    case "terminator":
    case "join":
    case "loopHeader":
      return location.blockId;
    case "functionEntry":
    case "edge":
    case "call":
    case "exit":
    case "terminalClosure":
      return undefined;
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

function resourceLimitStableDetail(input: {
  readonly limitKey: ProofCheckResourceLimitKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId?: ProofMirBlockId;
  readonly stateKey: string;
  readonly observed: number;
  readonly maximum: number;
}): string {
  const parts = [
    `resource-limit:${input.limitKey}`,
    `function:${String(input.functionInstanceId)}`,
  ];
  if (input.blockId !== undefined) {
    parts.push(`block:${String(input.blockId)}`);
  }
  parts.push(
    `state:${input.stateKey}`,
    `observed:${String(input.observed)}`,
    `maximum:${String(input.maximum)}`,
  );
  return parts.join(":");
}

function resourceLimitExceededDiagnostic(input: {
  readonly limitKey: ProofCheckResourceLimitKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly location: ProofCheckProgramPoint;
  readonly blockId?: ProofMirBlockId;
  readonly stateKey: string;
  readonly observed: number;
  readonly maximum: number;
}): ProofCheckDiagnostic {
  const stableDetail = resourceLimitStableDetail(input);
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED",
    messageTemplateId: "proof-check.resource-limit.exceeded",
    messageArguments: [
      { kind: "text", value: input.limitKey },
      { kind: "text", value: stableDetail },
    ],
    message: `Proof-check resource limit ${input.limitKey} exceeded (${stableDetail}).`,
    ownerKey: proofCheckProgramPointKey(input.location),
    rootCauseKey: `resource-limit:${input.limitKey}`,
    stableDetail,
    functionInstanceId: input.functionInstanceId,
    pathFrameKey: proofCheckProgramPointKey(input.location),
  });
}

function checkResourceLimit(input: {
  readonly limitKey: ProofCheckResourceLimitKey;
  readonly functionInstanceId: MonoInstanceId;
  readonly location: ProofCheckProgramPoint;
  readonly blockId?: ProofMirBlockId;
  readonly stateKey: string;
  readonly observed: number;
  readonly maximum: number;
}): ProofCheckDiagnostic | undefined {
  if (input.observed <= input.maximum) {
    return undefined;
  }
  return resourceLimitExceededDiagnostic(input);
}

export function enforceProofCheckResourceLimits(
  input: EnforceProofCheckResourceLimitsInput,
): EnforceProofCheckResourceLimitsResult {
  const functionInstanceId = functionInstanceIdFromProgramPoint(input.location);
  const blockId = blockIdFromProgramPoint(input.location);
  const metrics = input.metrics;
  const diagnostics: ProofCheckDiagnostic[] = [];
  let stateKey: string | undefined;

  const resolveStateKey = (): string => {
    stateKey ??= proofCheckStateKey(input.state);
    return stateKey;
  };

  const stateChecks: readonly {
    readonly limitKey: ProofCheckResourceLimitKey;
    readonly observed: number;
    readonly maximum: number;
  }[] = [
    {
      limitKey: "maximumActiveFactsPerState",
      observed: input.state.facts.size,
      maximum: input.limits.maximumActiveFactsPerState,
    },
    {
      limitKey: "maximumActiveLoansPerState",
      observed: input.state.loans.size,
      maximum: input.limits.maximumActiveLoansPerState,
    },
    {
      limitKey: "maximumOpenObligationsPerState",
      observed: countOpenObligations(input.state),
      maximum: input.limits.maximumOpenObligationsPerState,
    },
    {
      limitKey: "maximumOpenValidationsPerState",
      observed: countOpenValidations(input.state),
      maximum: input.limits.maximumOpenValidationsPerState,
    },
    {
      limitKey: "maximumOpenAttemptsPerState",
      observed: countOpenAttempts(input.state),
      maximum: input.limits.maximumOpenAttemptsPerState,
    },
    {
      limitKey: "maximumLiveCapabilitiesPerState",
      observed: input.state.capabilities.size,
      maximum: input.limits.maximumLiveCapabilitiesPerState,
    },
  ];

  for (const check of stateChecks) {
    const diagnostic = checkResourceLimit({
      limitKey: check.limitKey,
      functionInstanceId,
      location: input.location,
      blockId,
      stateKey: resolveStateKey(),
      observed: check.observed,
      maximum: check.maximum,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (metrics?.reachableFunctionCount !== undefined) {
    const diagnostic = checkResourceLimit({
      limitKey: "maximumReachableFunctions",
      functionInstanceId,
      location: input.location,
      stateKey: resolveStateKey(),
      observed: metrics.reachableFunctionCount,
      maximum: input.limits.maximumReachableFunctions,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (metrics?.blockCount !== undefined) {
    const diagnostic = checkResourceLimit({
      limitKey: "maximumBlocksPerFunction",
      functionInstanceId,
      location: input.location,
      stateKey: resolveStateKey(),
      observed: metrics.blockCount,
      maximum: input.limits.maximumBlocksPerFunction,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (metrics?.edgeCount !== undefined) {
    const diagnostic = checkResourceLimit({
      limitKey: "maximumEdgesPerFunction",
      functionInstanceId,
      location: input.location,
      stateKey: resolveStateKey(),
      observed: metrics.edgeCount,
      maximum: input.limits.maximumEdgesPerFunction,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (metrics?.acceptedStateVariantCount !== undefined) {
    const diagnostic = checkResourceLimit({
      limitKey: "maximumAcceptedStateVariantsPerBlock",
      functionInstanceId,
      location: input.location,
      blockId,
      stateKey: resolveStateKey(),
      observed: metrics.acceptedStateVariantCount,
      maximum: input.limits.maximumAcceptedStateVariantsPerBlock,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (metrics?.stagedPacketEntryCount !== undefined) {
    const diagnostic = checkResourceLimit({
      limitKey: "maximumStagedPacketEntriesPerFunction",
      functionInstanceId,
      location: input.location,
      stateKey: resolveStateKey(),
      observed: metrics.stagedPacketEntryCount,
      maximum: input.limits.maximumStagedPacketEntriesPerFunction,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (metrics?.counterexampleFrameCount !== undefined) {
    const diagnostic = checkResourceLimit({
      limitKey: "maximumCounterexampleFrames",
      functionInstanceId,
      location: input.location,
      stateKey: resolveStateKey(),
      observed: metrics.counterexampleFrameCount,
      maximum: input.limits.maximumCounterexampleFrames,
    });
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }

  if (diagnostics.length === 0) {
    return { kind: "ok" };
  }

  return { kind: "error", diagnostics };
}

export function proofCheckResourceLimitHooks(
  limits: ProofCheckResourceLimits,
): ProofCheckResourceLimitHooks {
  const seenBlocks = new Set<string>();
  const seenEdges = new Set<string>();
  const acceptedStateVariants = new Map<string, Set<string>>();

  return {
    beforeAcceptState: (hookInput) => {
      const blockKey = `${String(hookInput.functionInstanceId)}:${String(hookInput.blockId)}`;
      const stateVariants = acceptedStateVariants.get(blockKey) ?? new Set<string>();
      stateVariants.add(proofCheckStateKey(hookInput.state));
      acceptedStateVariants.set(blockKey, stateVariants);

      return enforceProofCheckResourceLimits({
        limits,
        location: {
          kind: "join",
          functionInstanceId: hookInput.functionInstanceId,
          blockId: hookInput.blockId,
        },
        state: hookInput.state,
        metrics: {
          acceptedStateVariantCount: stateVariants.size,
          stagedPacketEntryCount: hookInput.stagedPacketEntryCount,
          counterexampleFrameCount: hookInput.counterexampleFrameCount,
        },
      }) as ProofCheckResourceLimitHookResult;
    },
    beforeRecordTransition: (hookInput) => {
      const blockId = blockIdFromProgramPoint(hookInput.location);
      if (blockId !== undefined) {
        seenBlocks.add(`${String(hookInput.functionInstanceId)}:${String(blockId)}`);
      }
      if (hookInput.location.kind === "edge") {
        seenEdges.add(
          `${String(hookInput.functionInstanceId)}:${String(hookInput.location.edgeId)}`,
        );
      }

      return enforceProofCheckResourceLimits({
        limits,
        location: hookInput.location,
        state: hookInput.state,
        metrics: {
          blockCount: seenBlocks.size,
          edgeCount: seenEdges.size,
        },
      }) as ProofCheckResourceLimitHookResult;
    },
  };
}
