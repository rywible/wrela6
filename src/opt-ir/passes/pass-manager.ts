import { sortOptIrDiagnostics, OptIrDiagnosticSink, type OptIrDiagnostic } from "../diagnostics";
import { createOptIrFreshIdAllocator } from "../id-allocation";
import {
  type OptIrProductionPassScheduleEntry,
  type OptIrFixpointPolicy,
} from "../policy/pass-order-policy";
import { optIrOptimizationWarning } from "../optimization-diagnostics";
import { appendPipelineDecision, verifyPipelineState } from "./pipeline-state";
import type {
  OptIrPassContext,
  OptIrPassDefinition,
  OptIrPassName,
  OptIrPassRunResult,
} from "./pass-execution";
import type { OptimizeOptIrInput, PipelineState, PipelineStepResult } from "./pipeline-types";
import { isPipelineError } from "./pipeline-types";

export type OptIrPipelinePassDefinition = OptIrPassDefinition<PipelineState>;

type OptIrPipelinePassExecutionResult =
  | { readonly kind: "ok"; readonly state: PipelineState; readonly changed: boolean }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface RunOptIrPassPipelineInput {
  readonly state: PipelineState;
  readonly input?: OptimizeOptIrInput;
  readonly schedule: readonly OptIrProductionPassScheduleEntry[];
  readonly definitions: ReadonlyMap<string, OptIrPipelinePassDefinition>;
}

export function runOptIrPassPipeline(input: RunOptIrPassPipelineInput): PipelineStepResult {
  const freshIds = createOptIrFreshIdAllocator({
    program: input.state.program,
    operations: input.state.operations,
  });
  const diagnostics = new OptIrDiagnosticSink();
  let state = input.state;

  for (let entryIndex = 0; entryIndex < input.schedule.length; ) {
    const entry = input.schedule[entryIndex];
    if (entry === undefined) break;
    if (entry.fixpoint === undefined) {
      const result = runSingleEntry({ state, entry, definitions: input.definitions, freshIds });
      if (result.kind === "error") return result;
      state = result.state;
      entryIndex += 1;
      continue;
    }

    const groupEnd = consecutiveFixpointGroupEnd(input.schedule, entryIndex, entry.fixpoint);
    const group = input.schedule.slice(entryIndex, groupEnd);
    const result = runFixpointGroup({
      state,
      group,
      fixpoint: entry.fixpoint,
      definitions: input.definitions,
      freshIds,
    });
    if (isPipelineError(result)) return result;
    state = result;
    entryIndex = groupEnd;
  }

  for (const diagnostic of state.diagnostics) diagnostics.report(diagnostic);
  return { ...state, diagnostics: sortOptIrDiagnostics(diagnostics.entries()) };
}

function runFixpointGroup(input: {
  readonly state: PipelineState;
  readonly group: readonly OptIrProductionPassScheduleEntry[];
  readonly fixpoint: OptIrFixpointPolicy;
  readonly definitions: ReadonlyMap<string, OptIrPipelinePassDefinition>;
  readonly freshIds: ReturnType<typeof createOptIrFreshIdAllocator>;
}): PipelineStepResult {
  const fuel = fixpointFuelLimit(input.fixpoint.fuel);
  let state = input.state;
  let lastChangingPassId: string | undefined;
  let exhausted = true;

  for (let round = 0; round < fuel; round += 1) {
    let roundChanged = false;
    for (const entry of input.group) {
      const result = runSingleEntry({
        state,
        entry,
        definitions: input.definitions,
        freshIds: input.freshIds,
      });
      if (result.kind === "error") return result;
      state = result.state;
      if (result.changed) {
        roundChanged = true;
        lastChangingPassId = String(entry.passId);
      }
    }
    if (!roundChanged) {
      exhausted = false;
      break;
    }
  }

  if (!exhausted) {
    return state;
  }

  const passIds = input.group.map((entry) => String(entry.passId)).join(",");
  return {
    ...state,
    diagnostics: [
      ...state.diagnostics,
      optIrOptimizationWarning({
        passName: String(input.fixpoint.fixpointId),
        optimizationCode: "OPT_IR_FIXPOINT_FUEL_EXHAUSTED",
        stableDetail: `fixpoint-fuel-exhausted:${String(
          input.fixpoint.fixpointId,
        )}:passes=${passIds}:rounds=${fuel}:last=${lastChangingPassId ?? "none"}`,
      }),
    ],
  };
}

function runSingleEntry(input: {
  readonly state: PipelineState;
  readonly entry: OptIrProductionPassScheduleEntry;
  readonly definitions: ReadonlyMap<string, OptIrPipelinePassDefinition>;
  readonly freshIds: ReturnType<typeof createOptIrFreshIdAllocator>;
}): OptIrPipelinePassExecutionResult {
  const passId = String(input.entry.passId);
  const definition = input.definitions.get(passId);
  if (definition === undefined) {
    return {
      kind: "error",
      diagnostics: [
        optIrOptimizationWarning({
          passName: passId,
          optimizationCode: "OPT_IR_PASS_DEFINITION_MISSING",
          stableDetail: `pass-definition-missing:${passId}`,
        }),
      ],
    };
  }
  const context: OptIrPassContext = {
    passName: passId as OptIrPassName,
    freshIds: input.freshIds,
    verifierMode: "strict",
    diagnostics: new OptIrDiagnosticSink(),
  };
  const decided = appendPipelineDecision(
    input.state,
    input.entry,
    "accepted",
    "pipeline:ran",
    "none",
  );
  const normalized = normalizePassRunResult({
    raw: definition.run({ state: decided, context }),
  });
  if (normalized.kind === "error" || !input.entry.contract.requiresVerifierAfterRun) {
    return normalized;
  }
  const verified = verifyPipelineState(normalized.state, { kind: "after-pass", passId });
  if (isPipelineError(verified)) {
    return verified;
  }
  return { kind: "ok", state: verified, changed: normalized.changed };
}

function normalizePassRunResult(input: {
  readonly raw: OptIrPassRunResult<PipelineState>;
}): OptIrPipelinePassExecutionResult {
  if (input.raw.kind === "error") {
    return input.raw;
  }
  return {
    kind: "ok",
    state: {
      ...input.raw.state,
      diagnostics: [...input.raw.state.diagnostics, ...input.raw.diagnostics],
    },
    changed: input.raw.changed,
  };
}

function consecutiveFixpointGroupEnd(
  schedule: readonly OptIrProductionPassScheduleEntry[],
  start: number,
  fixpoint: OptIrFixpointPolicy,
): number {
  let end = start + 1;
  while (end < schedule.length && schedule[end]?.fixpoint?.fixpointId === fixpoint.fixpointId) {
    end += 1;
  }
  return end;
}

function fixpointFuelLimit(fuel: OptIrFixpointPolicy["fuel"]): number {
  switch (fuel.kind) {
    case "fixedRounds":
      return fuel.rounds;
    case "worklist":
      return fuel.maxItems;
  }
}
