import { computeOptIrCallGraph } from "../analyses/call-graph";
import { computeOptIrCallGraphSccs } from "../analyses/scc";
import type { MonoInstanceId } from "../../mono/ids";
import type { OptIrCodeSizeBudget, OptIrExpansionBudgetInput } from "../policy/expansion-budget";
import {
  createOptIrExpansionBudgetLedger,
  optIrCodeSizeDelta,
  reserveInlineExpansionBudget,
} from "../policy/expansion-budget";
import { type OptIrFunctionId, type OptIrOperationId } from "../ids";
import type { OptIrOperation } from "../operations";
import { optIrFunctionTable, type OptIrFunction, type OptIrProgram } from "../program";
import {
  appendOptIrDecisionLogEntry,
  optIrDecisionLogEntry,
  type OptIrDecisionLog,
  type OptIrPolicyResult,
  type OptIrPolicyUncertainty,
} from "../policy/decision-log";
import { type SourceCallOperation } from "./whole-program-inlining-bindings";
import { buildInlineSplice, findCallSite } from "./whole-program-inlining-splice";

export type OptIrWholeProgramInliningWorkItemKind = "cleanup" | "sccp" | "specialization";

export interface OptIrWholeProgramInliningWorkItem {
  readonly kind: OptIrWholeProgramInliningWorkItemKind;
  readonly functionId: OptIrFunctionId;
  readonly reason: string;
}

export interface RunWholeProgramInliningInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly budget: OptIrExpansionBudgetInput;
  readonly escapedCallableFunctionIds?: readonly OptIrFunctionId[];
}

export interface RunWholeProgramInliningResult {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly decisionLog: OptIrDecisionLog;
  readonly worklist: readonly OptIrWholeProgramInliningWorkItem[];
  readonly remainingImageBudget: OptIrCodeSizeBudget;
}

export function runWholeProgramInliningForTest(
  input: RunWholeProgramInliningInput,
): RunWholeProgramInliningResult {
  return runWholeProgramInlining(input);
}

export function runWholeProgramInlining(
  input: RunWholeProgramInliningInput,
): RunWholeProgramInliningResult {
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const functionByInstance = new Map(
    input.program.functions.entries().map((func) => [func.monoInstanceId, func]),
  );
  const graph = computeOptIrCallGraph({
    program: input.program,
    operationForId(operationId) {
      return operationById.get(operationId);
    },
  });
  const sccs = computeOptIrCallGraphSccs({
    functions: input.program.functions.entries().map((func) => func.functionId),
    edges: graph.edges(),
  });
  const blockedByScc = new Set(sccs.entries().flatMap((scc) => scc.functions));
  const sccKeyByFunction = new Map<OptIrFunctionId, string>();
  for (const func of input.program.functions.entries()) {
    sccKeyByFunction.set(func.functionId, sccKeyForFunctions([func.functionId]));
  }
  for (const scc of sccs.entries()) {
    const sccKey = sccKeyForFunctions(scc.functions);
    for (const functionId of scc.functions) {
      sccKeyByFunction.set(functionId, sccKey);
    }
  }
  const ledger = createOptIrExpansionBudgetLedger({
    ...input.budget,
    sccMembership: input.program.functions.entries().map((func) => ({
      sccKey: sccKeyByFunction.get(func.functionId) ?? sccKeyForFunctions([func.functionId]),
      functionIds: [func.functionId],
      allowExpansion: !blockedByScc.has(func.functionId),
    })),
  });
  const escapedCallableFunctionIds = new Set(input.escapedCallableFunctionIds ?? []);
  let decisionLog: OptIrDecisionLog | undefined;
  let currentProgram = input.program;
  let currentOperations = input.operations;
  const worklist: OptIrWholeProgramInliningWorkItem[] = [];
  const inlinedCalleeKeys = new Set<string>();

  for (const candidate of inlineCandidates(input.program, input.operations, functionByInstance)) {
    const candidateKey = candidateKeyFor(candidate);
    const caller = currentProgram.functions.get(candidate.caller.functionId);
    const callee = currentProgram.functions.get(candidate.callee.functionId);
    if (caller === undefined || callee === undefined) {
      continue;
    }
    const currentCandidate = { ...candidate, caller, callee };
    const decision = preReservationDecision(
      currentCandidate,
      blockedByScc,
      escapedCallableFunctionIds,
    );
    if (decision !== undefined) {
      decisionLog = appendDecision(decisionLog, candidateKey, "denied", decision, "conservative");
      continue;
    }

    const growth = estimatedGrowth(callee, operationById);
    const reservation = reserveInlineExpansionBudget(ledger, {
      callerFunctionId: caller.functionId,
      estimatedGrowth: optIrCodeSizeDelta("normalizedOperation", growth),
      sccKey: sccKeyByFunction.get(caller.functionId),
    });
    if (reservation.kind === "denied") {
      decisionLog = appendDecision(
        decisionLog,
        candidateKey,
        "denied",
        "inline:denied:budget",
        "conservative",
      );
      continue;
    }

    const rewrite = inlineSourceCall({
      program: currentProgram,
      caller,
      callee,
      callOperation: candidate.callOperation,
      operations: currentOperations,
    });
    if (rewrite.kind === "denied") {
      ledger.release(reservation.reservation);
      decisionLog = appendDecision(
        decisionLog,
        candidateKey,
        "denied",
        rewrite.reason,
        "conservative",
      );
      continue;
    }

    ledger.commit(reservation.reservation);
    currentOperations = rewrite.operations;
    currentProgram = replaceFunction(currentProgram, rewrite.functionOutput);
    inlinedCalleeKeys.add(String(callee.monoInstanceId));
    decisionLog = appendDecision(decisionLog, candidateKey, "accepted", "inline:accepted", "none");
    worklist.push(...workItemsFor(caller.functionId, candidateKey));
  }
  const pruned = removeUnreferencedInlinedCallees({
    program: currentProgram,
    operations: currentOperations,
    inlinedCalleeKeys,
  });

  return {
    program: pruned.program,
    operations: Object.freeze([...pruned.operations].sort(compareOperations)),
    decisionLog: decisionLog ?? { entries: () => [] },
    worklist: Object.freeze(worklist.sort(compareWorkItems)),
    remainingImageBudget: ledger.remaining({ kind: "image" }),
  };
}

interface InlineCandidate {
  readonly caller: OptIrFunction;
  readonly callee: OptIrFunction;
  readonly callOperation: SourceCallOperation;
}

type InlineRewriteResult =
  | {
      readonly kind: "ok";
      readonly functionOutput: OptIrFunction;
      readonly operations: readonly OptIrOperation[];
    }
  | { readonly kind: "denied"; readonly reason: string };

function inlineCandidates(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
  functionByInstance: ReadonlyMap<MonoInstanceId, OptIrFunction>,
): readonly InlineCandidate[] {
  const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const candidates: InlineCandidate[] = [];
  for (const caller of program.functions.entries()) {
    for (const block of caller.blocks) {
      for (const operationId of block.operations) {
        const operation = operationsById.get(operationId);
        if (operation === undefined) {
          continue;
        }
        if (operation.kind !== "sourceCall" || operation.target.kind !== "source") {
          if (isEffectBoundaryCall(operation)) {
            candidates.push({
              caller,
              callee: caller,
              callOperation: operation as SourceCallOperation,
            });
          }
          continue;
        }
        const callee = functionByInstance.get(operation.target.functionInstanceId);
        if (callee !== undefined) {
          candidates.push({ caller, callee, callOperation: operation as SourceCallOperation });
        }
      }
    }
  }
  return Object.freeze(
    candidates.sort(
      (left, right) =>
        Number(left.caller.functionId) - Number(right.caller.functionId) ||
        Number(left.callOperation.operationId) - Number(right.callOperation.operationId),
    ),
  );
}

function preReservationDecision(
  candidate: InlineCandidate,
  blockedByScc: ReadonlySet<OptIrFunctionId>,
  escapedCallableFunctionIds: ReadonlySet<OptIrFunctionId>,
): string | undefined {
  if (
    candidate.callOperation.kind !== "sourceCall" ||
    candidate.callOperation.target.kind !== "source"
  ) {
    return "inline:denied:effect-boundary";
  }
  if (candidate.callee.externalRoot !== undefined) {
    return "inline:denied:external-root";
  }
  if (
    blockedByScc.has(candidate.callee.functionId) ||
    blockedByScc.has(candidate.caller.functionId)
  ) {
    return "inline:denied:recursive-scc";
  }
  if (escapedCallableFunctionIds.has(candidate.callee.functionId)) {
    return "inline:denied:escaped-callable-identity";
  }
  return undefined;
}

function inlineSourceCall(input: {
  readonly program: OptIrProgram;
  readonly caller: OptIrFunction;
  readonly callee: OptIrFunction;
  readonly callOperation: SourceCallOperation;
  readonly operations: readonly OptIrOperation[];
}): InlineRewriteResult {
  const entryBlock = input.callee.blocks.find((block) => block.blockId === input.callee.entryBlock);
  if (
    entryBlock === undefined ||
    entryBlock.parameters.length !== input.callOperation.argumentIds.length
  ) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  if (entryBlock.parameters.some((parameter) => parameter.incomingRole !== "entry")) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }

  const callSite = findCallSite(input.caller, input.callOperation.operationId);
  if (callSite === undefined) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }

  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const calleeOperations = input.callee.blocks.flatMap((block) =>
    block.operations.map((operationId) => operationById.get(operationId)),
  );
  if (calleeOperations.some((operation) => operation === undefined)) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  const completeCalleeOperations = calleeOperations.filter(
    (operation): operation is OptIrOperation => operation !== undefined,
  );
  if (completeCalleeOperations.some((operation) => !operationIsInlineSafe(operation))) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  const returnBlocks = input.callee.blocks.filter((block) => block.terminator?.kind === "return");
  if (
    returnBlocks.length === 0 &&
    (input.callOperation.resultIds.length !== 0 || input.callOperation.resultTypes.length !== 0)
  ) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  if (
    returnBlocks.some(
      (block) =>
        block.terminator?.kind !== "return" ||
        block.terminator.values.length !== input.callOperation.resultIds.length,
    )
  ) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }

  const splice = buildInlineSplice({
    program: input.program,
    caller: input.caller,
    callee: input.callee,
    entryBlock,
    callSite,
    callOperation: input.callOperation,
    calleeOperations: completeCalleeOperations,
    operations: input.operations,
  });
  if (splice === undefined) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }

  const nextOperationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  nextOperationById.delete(input.callOperation.operationId);
  for (const operation of splice.clonedOperations) {
    nextOperationById.set(operation.operationId, operation);
  }

  return {
    kind: "ok",
    functionOutput: splice.functionOutput,
    operations: Object.freeze([...nextOperationById.values()].sort(compareOperations)),
  };
}

function operationIsInlineSafe(operation: OptIrOperation): boolean {
  if (operation.kind === "runtimeCall") {
    return false;
  }
  if (operation.kind === "sourceCall") {
    return !operation.effects.hasTerminalEffects;
  }
  if (operation.kind === "platformCall" || operation.kind === "intrinsicCall") {
    return !operation.effects.hasTerminalEffects;
  }
  return operation.effects.isRuntimePure && !operation.effects.hasTerminalEffects;
}

function estimatedGrowth(
  callee: OptIrFunction,
  operationById: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): number {
  return Math.max(
    0,
    callee.blocks
      .flatMap((block) => block.operations)
      .filter((operationId) => operationById.has(operationId)).length,
  );
}

function replaceFunction(program: OptIrProgram, functionOutput: OptIrFunction): OptIrProgram {
  return Object.freeze({
    ...program,
    functions: optIrFunctionTable(
      program.functions
        .entries()
        .map((func) => (func.functionId === functionOutput.functionId ? functionOutput : func)),
    ),
  });
}

function removeUnreferencedInlinedCallees(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly inlinedCalleeKeys: ReadonlySet<string>;
}): { readonly program: OptIrProgram; readonly operations: readonly OptIrOperation[] } {
  if (input.inlinedCalleeKeys.size === 0) {
    return { program: input.program, operations: input.operations };
  }
  const referencedCalleeKeys = new Set(
    input.operations
      .filter(isSourceCallOperation)
      .map((operation) => String(operation.target.functionInstanceId)),
  );
  const removedOperationIds = new Set(
    input.program.functions
      .entries()
      .filter(
        (function_) =>
          function_.externalRoot === undefined &&
          input.inlinedCalleeKeys.has(String(function_.monoInstanceId)) &&
          !referencedCalleeKeys.has(String(function_.monoInstanceId)),
      )
      .flatMap((function_) => function_.blocks.flatMap((block) => block.operations)),
  );
  const removedFunctionIds = new Set(
    input.program.functions
      .entries()
      .filter(
        (function_) =>
          function_.externalRoot === undefined &&
          input.inlinedCalleeKeys.has(String(function_.monoInstanceId)) &&
          !referencedCalleeKeys.has(String(function_.monoInstanceId)),
      )
      .map((function_) => function_.functionId),
  );
  if (removedFunctionIds.size === 0 && removedOperationIds.size === 0) {
    return { program: input.program, operations: input.operations };
  }
  return {
    program: Object.freeze({
      ...input.program,
      functions: optIrFunctionTable(
        input.program.functions
          .entries()
          .filter((function_) => !removedFunctionIds.has(function_.functionId)),
      ),
    }),
    operations: Object.freeze(
      input.operations.filter((operation) => !removedOperationIds.has(operation.operationId)),
    ),
  };
}

function isSourceCallOperation(operation: OptIrOperation): operation is SourceCallOperation {
  return operation.kind === "sourceCall" && operation.target.kind === "source";
}

function appendDecision(
  log: OptIrDecisionLog | undefined,
  candidateKey: string,
  policyResult: OptIrPolicyResult,
  stableReason: string,
  uncertainty: OptIrPolicyUncertainty,
): OptIrDecisionLog {
  return appendOptIrDecisionLogEntry(
    log,
    optIrDecisionLogEntry({
      candidateKey,
      policyResult,
      factsUsed: [],
      uncertainty,
      stableReason,
    }),
  );
}

function workItemsFor(
  functionId: OptIrFunctionId,
  reason: string,
): readonly OptIrWholeProgramInliningWorkItem[] {
  return Object.freeze([
    Object.freeze({ kind: "cleanup" as const, functionId, reason }),
    Object.freeze({ kind: "sccp" as const, functionId, reason }),
    Object.freeze({ kind: "specialization" as const, functionId, reason }),
  ]);
}

function candidateKeyFor(candidate: InlineCandidate): string {
  return `inline:caller=${Number(candidate.caller.functionId)}:callee=${Number(
    candidate.callee.functionId,
  )}:site=${Number(candidate.callOperation.operationId)}`;
}

function sccKeyForFunctions(functionIds: readonly OptIrFunctionId[]): string {
  return functionIds
    .map((functionId) => Number(functionId))
    .sort((left, right) => left - right)
    .join(".");
}

function isEffectBoundaryCall(operation: OptIrOperation): boolean {
  return (
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "intrinsicCall"
  );
}

function compareOperations(left: OptIrOperation, right: OptIrOperation): number {
  return Number(left.operationId) - Number(right.operationId);
}

function compareWorkItems(
  left: OptIrWholeProgramInliningWorkItem,
  right: OptIrWholeProgramInliningWorkItem,
): number {
  return (
    Number(left.functionId) - Number(right.functionId) ||
    workItemKindOrder(left.kind) - workItemKindOrder(right.kind) ||
    left.reason.localeCompare(right.reason)
  );
}

function workItemKindOrder(kind: OptIrWholeProgramInliningWorkItemKind): number {
  return ["cleanup", "sccp", "specialization"].indexOf(kind);
}
