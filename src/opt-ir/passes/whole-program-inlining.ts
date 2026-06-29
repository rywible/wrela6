import { computeOptIrCallGraph } from "../analyses/call-graph";
import { computeOptIrCallGraphSccs } from "../analyses/scc";
import { optIrCfgEdgeTable, type OptIrBlock } from "../cfg";
import type { MonoInstanceId } from "../../mono/ids";
import type { OptIrCallTarget } from "../calls";
import type { OptIrCodeSizeBudget, OptIrExpansionBudgetInput } from "../policy/expansion-budget";
import {
  createOptIrExpansionBudgetLedger,
  optIrCodeSizeDelta,
  reserveInlineExpansionBudget,
} from "../policy/expansion-budget";
import type { OptIrFunctionId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import { optIrFunctionTable, type OptIrFunction, type OptIrProgram } from "../program";
import {
  appendOptIrDecisionLogEntry,
  optIrDecisionLogEntry,
  type OptIrDecisionLog,
  type OptIrPolicyResult,
  type OptIrPolicyUncertainty,
} from "../policy/decision-log";

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

  for (const candidate of inlineCandidates(input.program, input.operations, functionByInstance)) {
    const candidateKey = candidateKeyFor(candidate);
    const callee = candidate.callee;
    const caller = currentProgram.functions.get(candidate.caller.functionId) ?? candidate.caller;
    const decision = preReservationDecision(candidate, blockedByScc, escapedCallableFunctionIds);
    if (decision !== undefined) {
      decisionLog = appendDecision(decisionLog, candidateKey, "denied", decision, "conservative");
      continue;
    }

    const growth = estimatedGrowth(candidate.callee, operationById);
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

    const rewrite = inlineSourceCall(caller, callee, candidate.callOperation, currentOperations);
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
    decisionLog = appendDecision(decisionLog, candidateKey, "accepted", "inline:accepted", "none");
    worklist.push(...workItemsFor(caller.functionId, candidateKey));
  }

  return {
    program: currentProgram,
    operations: Object.freeze([...currentOperations].sort(compareOperations)),
    decisionLog: decisionLog ?? { entries: () => [] },
    worklist: Object.freeze(worklist.sort(compareWorkItems)),
    remainingImageBudget: ledger.remaining({ kind: "image" }),
  };
}

type SourceCallOperation = OptIrOperation & {
  readonly kind: "sourceCall";
  readonly target: Extract<OptIrCallTarget, { readonly kind: "source" }>;
  readonly argumentIds: readonly OptIrValueId[];
};

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

function inlineSourceCall(
  caller: OptIrFunction,
  callee: OptIrFunction,
  callOperation: SourceCallOperation,
  operations: readonly OptIrOperation[],
): InlineRewriteResult {
  if (callee.blocks.length !== 1) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  const entryBlock = callee.blocks[0];
  if (entryBlock === undefined || entryBlock.terminator?.kind !== "return") {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  if (entryBlock.parameters.length !== callOperation.argumentIds.length) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }
  if (entryBlock.terminator.values.length !== callOperation.resultIds.length) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }

  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const calleeOperations = entryBlock.operations.map((operationId) =>
    operationById.get(operationId),
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
  const callerOperationIds = new Set(caller.blocks.flatMap((block) => block.operations));
  if (completeCalleeOperations.some((operation) => callerOperationIds.has(operation.operationId))) {
    return { kind: "denied", reason: "inline:denied:rewrite-legality" };
  }

  const substitution = buildValueSubstitution(
    callOperation,
    entryBlock,
    entryBlock.terminator.values,
  );
  const clonedOperations = completeCalleeOperations.map((operation) =>
    rewriteOperationValues(operation, substitution),
  );
  const nextOperationById = new Map(
    operations.map((operation) => [operation.operationId, operation]),
  );
  nextOperationById.delete(callOperation.operationId);
  for (const operation of clonedOperations) {
    nextOperationById.set(operation.operationId, operation);
  }

  return {
    kind: "ok",
    functionOutput: inlineIntoCaller(caller, callOperation.operationId, clonedOperations),
    operations: Object.freeze([...nextOperationById.values()].sort(compareOperations)),
  };
}

function inlineIntoCaller(
  caller: OptIrFunction,
  callOperationId: OptIrOperationId,
  clonedOperations: readonly OptIrOperation[],
): OptIrFunction {
  return Object.freeze({
    ...caller,
    blocks: Object.freeze(
      caller.blocks.map((block) =>
        Object.freeze({
          ...block,
          operations: Object.freeze(
            block.operations.flatMap((operationId) =>
              operationId === callOperationId
                ? clonedOperations.map((operation) => operation.operationId)
                : [operationId],
            ),
          ),
        }),
      ),
    ),
    edges: optIrCfgEdgeTable(caller.edges.entries()),
  });
}

function buildValueSubstitution(
  callOperation: SourceCallOperation,
  entryBlock: OptIrBlock,
  returnValues: readonly OptIrValueId[],
): ReadonlyMap<OptIrValueId, OptIrValueId> {
  const substitution = new Map<OptIrValueId, OptIrValueId>();
  entryBlock.parameters.forEach((parameter, index) => {
    const argumentId = callOperation.argumentIds[index];
    if (argumentId !== undefined) {
      substitution.set(parameter.valueId, argumentId);
    }
  });
  returnValues.forEach((returnValue, index) => {
    const resultId = callOperation.resultIds[index];
    if (resultId !== undefined) {
      substitution.set(returnValue, resultId);
    }
  });
  return substitution;
}

function rewriteOperationValues(
  operation: OptIrOperation,
  substitution: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrOperation {
  const operandIds = operation.operandIds.map((valueId) => substituteValue(substitution, valueId));
  const resultIds = operation.resultIds.map((valueId) => substituteValue(substitution, valueId));
  const base = {
    ...operation,
    operandIds: Object.freeze(operandIds),
    resultIds: Object.freeze(resultIds),
  };
  switch (operation.kind) {
    case "constant":
    case "memoryLoad":
    case "proofErasedMarker":
      return Object.freeze(base);
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      return Object.freeze({
        ...base,
        left: substituteValue(substitution, operation.left),
        right: substituteValue(substitution, operation.right),
      });
    case "integerUnary":
    case "booleanNot":
      return Object.freeze({
        ...base,
        operand: substituteValue(substitution, operation.operand),
      });
    case "aggregateConstruct":
      return Object.freeze({
        ...base,
        fieldIds: Object.freeze(
          operation.fieldIds.map((valueId) => substituteValue(substitution, valueId)),
        ),
      });
    case "aggregateExtract":
      return Object.freeze({
        ...base,
        aggregate: substituteValue(substitution, operation.aggregate),
      });
    case "aggregateInsert":
      return Object.freeze({
        ...base,
        aggregate: substituteValue(substitution, operation.aggregate),
        field: substituteValue(substitution, operation.field),
      });
    case "layoutOffset":
    case "layoutByteRange":
      return Object.freeze({
        ...base,
        base: substituteValue(substitution, operation.base),
      });
    case "layoutEndianDecode":
      return Object.freeze({
        ...base,
        bytes: substituteValue(substitution, operation.bytes),
      });
    case "memoryStore":
      return Object.freeze({
        ...base,
        storeValue: substituteValue(substitution, operation.storeValue),
      });
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      return Object.freeze({
        ...base,
        argumentIds: Object.freeze(
          operation.argumentIds.map((valueId) => substituteValue(substitution, valueId)),
        ),
      });
    case "vectorLoad":
    case "vectorMaskedLoad":
      return Object.freeze({
        ...base,
        ...(operation.mask === undefined
          ? {}
          : { mask: substituteValue(substitution, operation.mask) }),
      });
    case "vectorStore":
    case "vectorMaskedStore":
      return Object.freeze({
        ...base,
        vector: substituteValue(substitution, operation.vector),
        storeValue: substituteValue(substitution, operation.storeValue),
        ...(operation.mask === undefined
          ? {}
          : { mask: substituteValue(substitution, operation.mask) }),
      });
    case "vectorShuffle":
    case "vectorCompare":
      return Object.freeze({
        ...base,
        sourceValueIds: Object.freeze(
          operation.sourceValueIds.map((valueId) => substituteValue(substitution, valueId)),
        ),
      });
    case "vectorSelect":
      return Object.freeze({
        ...base,
        mask: substituteValue(substitution, operation.mask),
        sourceValueIds: Object.freeze(
          operation.sourceValueIds.map((valueId) => substituteValue(substitution, valueId)),
        ),
      });
    case "vectorByteSwap":
      return Object.freeze({
        ...base,
        vector: substituteValue(substitution, operation.vector),
      });
    default:
      return Object.freeze(base);
  }
}

function substituteValue(
  substitution: ReadonlyMap<OptIrValueId, OptIrValueId>,
  valueId: OptIrValueId,
): OptIrValueId {
  return substitution.get(valueId) ?? valueId;
}

function operationIsInlineSafe(operation: OptIrOperation): boolean {
  return (
    operation.kind !== "sourceCall" &&
    operation.kind !== "runtimeCall" &&
    operation.kind !== "platformCall" &&
    operation.kind !== "intrinsicCall" &&
    operation.effects.isRuntimePure &&
    !operation.effects.hasTerminalEffects
  );
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
