import { computeOptIrCallGraph } from "../analyses/call-graph";
import { computeOptIrCallGraphSccs } from "../analyses/scc";
import {
  analyzeBindingTime,
  type BindingTimeFactSource,
  type StaticBindingTimeClassification,
} from "../analyses/binding-time-analysis";
import type { MonoInstanceId } from "../../mono/ids";
import type { OptIrConstant, OptIrIntegerConstant } from "../constants";
import { optIrIntegerConstant } from "../constants";
import type { OptIrCodeSizeBudget, OptIrExpansionBudgetInput } from "../policy/expansion-budget";
import { createOptIrExpansionBudgetLedger, optIrCodeSizeDelta } from "../policy/expansion-budget";
import { reserveSpecializationExpansionBudget } from "../policy/specialization-policy";
import {
  appendOptIrDecisionLogEntry,
  optIrDecisionLogEntry,
  type OptIrDecisionLog,
  type OptIrPolicyResult,
  type OptIrPolicyUncertainty,
} from "../policy/decision-log";
import type { OptIrBlock } from "../cfg";
import type { OptIrFunctionId, OptIrOperationId, OptIrValueId } from "../ids";
import { optIrConstantId } from "../ids";
import {
  optIrConstantOperation,
  type OptIrIntegerBinaryOperator,
  type OptIrOperation,
} from "../operations";
import { optIrFunctionTable, type OptIrFunction, type OptIrProgram } from "../program";
import {
  createSpecializationCloneMaterializationState,
  materializeSpecializationClone,
  retargetSpecializedCallOperation,
  type OptIrMaterializedSpecializationClone,
  type OptIrSpecializationCloneCandidate,
  type OptIrSpecializationSourceCallOperation,
} from "./specialization/clone-materialization";
import {
  driveStaticControlFlow,
  type OptIrStaticDrivingCfgEdit,
} from "./specialization/static-driving";
import { specializationResidualEquivalence } from "./specialization/residual-invariant";
import { cloneSignatureKey, type OptIrCloneStaticOperand } from "./specialization/clone-signature";
import { removeUnreferencedSpecializedOriginals } from "./specialization/unreferenced-original-pruning";
import {
  compareSpecializationWorkItems,
  specializationWorkItem as workItem,
} from "./specialization/work-items";

export type OptIrWholeProgramSpecializationWorkItemKind = "cleanup" | "sccp" | "inlining";

export interface OptIrWholeProgramSpecializationWorkItem {
  readonly kind: OptIrWholeProgramSpecializationWorkItemKind;
  readonly functionId: OptIrFunctionId;
  readonly reason: string;
}

export interface OptIrSpecializationRewriteObligation {
  readonly ruleId: string;
  readonly operationId?: OptIrOperationId;
  readonly invariant: ReturnType<typeof specializationResidualEquivalence>;
  readonly cfgEdits: readonly OptIrStaticDrivingCfgEdit[];
}

export interface RunWholeProgramSpecializationInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly budget: OptIrExpansionBudgetInput;
  readonly constantValues?: ReadonlyMap<OptIrValueId, OptIrConstant>;
  readonly factSources?: readonly BindingTimeFactSource[];
  readonly maxVariantsPerFunction?: number;
}

export interface RunWholeProgramSpecializationResult {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly decisionLog: OptIrDecisionLog;
  readonly worklist: readonly OptIrWholeProgramSpecializationWorkItem[];
  readonly rewriteObligations: readonly OptIrSpecializationRewriteObligation[];
  readonly remainingImageBudget: OptIrCodeSizeBudget;
}

export function runWholeProgramSpecializationForTest(
  input: RunWholeProgramSpecializationInput,
): RunWholeProgramSpecializationResult {
  return runWholeProgramSpecialization(input);
}

export function runWholeProgramSpecialization(
  input: RunWholeProgramSpecializationInput,
): RunWholeProgramSpecializationResult {
  const originalOperationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  let operationById = originalOperationById;
  const functionByInstance = new Map(
    input.program.functions.entries().map((func) => [func.monoInstanceId, func]),
  );
  const staticValues = staticValueMap(input.operations, input.constantValues);
  const bindingTime = analyzeBindingTime({
    program: input.program,
    operations: operationById,
    constantValues: staticValues,
    factSources: input.factSources,
  });
  let currentProgram = input.program;
  let currentOperations = evaluateStaticOperations(input.operations, staticValues, bindingTime);
  operationById = new Map(currentOperations.map((operation) => [operation.operationId, operation]));
  const worklist: OptIrWholeProgramSpecializationWorkItem[] = [];
  const rewriteObligations: OptIrSpecializationRewriteObligation[] = [];
  let decisionLog: OptIrDecisionLog | undefined;

  for (const operation of currentOperations) {
    if (
      operation.kind === "constant" &&
      originalOperationById.get(operation.operationId)?.kind !== "constant"
    ) {
      const reason = `specialize:static-eval:${Number(operation.operationId)}`;
      const owner = owningFunction(input.program, operation.operationId);
      if (owner !== undefined) {
        worklist.push(workItem("cleanup", owner.functionId, reason));
      }
      rewriteObligations.push(
        Object.freeze({
          ruleId: "specialization-static-evaluation",
          operationId: operation.operationId,
          invariant: specializationResidualEquivalence({ includeStaticEvaluation: true }),
          cfgEdits: Object.freeze([]),
        }),
      );
    }
  }

  currentProgram = driveProgramStaticControl(
    currentProgram,
    staticValues,
    rewriteObligations,
    worklist,
  );

  const graph = computeOptIrCallGraph({
    program: currentProgram,
    operationForId(operationId) {
      return operationById.get(operationId);
    },
  });
  const sccs = computeOptIrCallGraphSccs({
    functions: currentProgram.functions.entries().map((func) => func.functionId),
    edges: graph.edges(),
  });
  const blockedByScc = new Set(sccs.entries().flatMap((scc) => scc.functions));
  const sccKeyByFunction = sccKeys(currentProgram, sccs.entries());
  const ledger = createOptIrExpansionBudgetLedger({
    ...input.budget,
    sccMembership: currentProgram.functions.entries().map((func) => ({
      sccKey: sccKeyByFunction.get(func.functionId) ?? String(Number(func.functionId)),
      functionIds: [func.functionId],
      allowExpansion: !blockedByScc.has(func.functionId),
    })),
  });
  const variantCountByFunction = new Map<OptIrFunctionId, number>();
  const cloneState = createSpecializationCloneMaterializationState(
    currentProgram,
    currentOperations,
  );
  const cloneBySignature = new Map<string, OptIrMaterializedSpecializationClone>();
  const specializedCalleeKeys = new Set<string>();

  for (const candidate of cloneCandidates(currentProgram, currentOperations, functionByInstance)) {
    const staticOperands = staticOperandsForCall(candidate, staticValues, bindingTime);
    const candidateKey = cloneCandidateKey(candidate);
    const denial = cloneDenial(
      candidate,
      blockedByScc,
      variantCountByFunction,
      input.maxVariantsPerFunction ?? 4,
      staticOperands,
    );
    if (denial !== undefined) {
      decisionLog = appendDecision(decisionLog, candidateKey, "denied", denial, "conservative");
      continue;
    }
    const signatureKey = cloneSignatureKey({
      callee: candidate.callOperation.target,
      staticOperands,
    });
    const existingClone = cloneBySignature.get(signatureKey);
    if (existingClone !== undefined) {
      currentOperations = retargetSpecializedCallOperation(
        currentOperations,
        candidate.callOperation.operationId,
        existingClone.function.monoInstanceId,
        existingClone.bakedParameterIndices,
      );
      specializedCalleeKeys.add(String(candidate.callee.monoInstanceId));
      decisionLog = appendDecision(
        decisionLog,
        candidateKey,
        "accepted",
        "specialize:clone:deduplicated",
        "none",
      );
      worklist.push(workItem("cleanup", candidate.caller.functionId, candidateKey));
      continue;
    }
    const reservation = reserveSpecializationExpansionBudget(ledger, {
      sourceFunctionId: candidate.callee.functionId,
      variantKey: signatureKey,
      estimatedGrowth: optIrCodeSizeDelta(
        "normalizedOperation",
        estimatedGrowth(candidate.callee, operationById),
      ),
      sccKey: sccKeyByFunction.get(candidate.callee.functionId),
    });
    if (reservation.kind === "denied") {
      decisionLog = appendDecision(
        decisionLog,
        candidateKey,
        "denied",
        "specialize:denied:budget",
        "conservative",
      );
      continue;
    }
    const clone = materializeSpecializationClone(
      candidate,
      staticOperands,
      staticValues,
      operationById,
      cloneState,
    );
    ledger.commit(reservation.reservation);
    cloneBySignature.set(signatureKey, clone);
    currentProgram = Object.freeze({
      ...currentProgram,
      functions: optIrFunctionTable([...currentProgram.functions.entries(), clone.function]),
    });
    currentOperations = retargetSpecializedCallOperation(
      [...currentOperations, ...clone.operations],
      candidate.callOperation.operationId,
      clone.function.monoInstanceId,
      clone.bakedParameterIndices,
    );
    specializedCalleeKeys.add(String(candidate.callee.monoInstanceId));
    operationById = new Map(
      currentOperations.map((operation) => [operation.operationId, operation]),
    );
    variantCountByFunction.set(
      candidate.callee.functionId,
      (variantCountByFunction.get(candidate.callee.functionId) ?? 0) + 1,
    );
    decisionLog = appendDecision(
      decisionLog,
      candidateKey,
      "accepted",
      "specialize:clone:materialized",
      "none",
    );
    worklist.push(workItem("cleanup", candidate.caller.functionId, candidateKey));
    worklist.push(workItem("sccp", clone.function.functionId, candidateKey));
    rewriteObligations.push(
      Object.freeze({
        ruleId: "specialization-clone-materialization",
        operationId: candidate.callOperation.operationId,
        invariant: specializationResidualEquivalence({
          includeCloneRehoming: true,
          touchedEffectBoundary: clone.touchedEffectBoundary,
          touchedCapabilityFacts: clone.touchedCapabilityFacts,
          touchedPrivateStateFacts: clone.touchedPrivateStateFacts,
        }),
        cfgEdits: Object.freeze([]),
      }),
    );
  }
  const pruned = removeUnreferencedSpecializedOriginals({
    program: currentProgram,
    operations: currentOperations,
    specializedCalleeKeys,
  });

  return Object.freeze({
    program: pruned.program,
    operations: Object.freeze([...pruned.operations].sort(compareOperations)),
    decisionLog: decisionLog ?? { entries: () => [] },
    worklist: Object.freeze(worklist.sort(compareSpecializationWorkItems)),
    rewriteObligations: Object.freeze(rewriteObligations),
    remainingImageBudget: ledger.remaining({ kind: "image" }),
  });
}

type CloneCandidate = OptIrSpecializationCloneCandidate;
type SourceCallOperation = OptIrSpecializationSourceCallOperation;

function staticValueMap(
  operations: readonly OptIrOperation[],
  provided: ReadonlyMap<OptIrValueId, OptIrConstant> | undefined,
): Map<OptIrValueId, OptIrConstant> {
  const values = new Map(provided ?? []);
  for (const operation of [...operations].sort(compareOperations)) {
    if (operation.kind === "constant") {
      values.set(operation.resultIds[0] as OptIrValueId, operation.constant);
    }
  }
  return values;
}

function staticOperandsForCall(
  candidate: CloneCandidate,
  staticValues: ReadonlyMap<OptIrValueId, OptIrConstant>,
  bindingTime: ReturnType<typeof analyzeBindingTime>,
): readonly OptIrCloneStaticOperand[] {
  const staticOperands: OptIrCloneStaticOperand[] = [];
  candidate.callOperation.argumentIds.forEach((valueId, parameterIndex) => {
    const classification = bindingTime.classificationOf(valueId);
    if (classification.kind !== "static") {
      return;
    }
    const constant = staticValues.get(valueId);
    if (constant !== undefined) {
      staticOperands.push(
        Object.freeze({
          parameterIndex,
          valueId,
          binding: Object.freeze({
            kind: "constant" as const,
            constantId: constant.constantId,
            factsCited: Object.freeze([...classification.factsUsed]),
          }),
        }),
      );
      return;
    }
    staticOperands.push(
      Object.freeze({
        parameterIndex,
        valueId,
        binding: Object.freeze({
          kind: "factKey" as const,
          factKey: staticFactKey(classification),
          factsCited: Object.freeze([...classification.factsUsed]),
        }),
      }),
    );
  });
  return Object.freeze(staticOperands);
}

function staticFactKey(classification: StaticBindingTimeClassification): string {
  const triggerKey = classification.invalidationTriggers.join(",");
  return `${classification.source}:${triggerKey}`;
}

function evaluateStaticOperations(
  operations: readonly OptIrOperation[],
  staticValues: Map<OptIrValueId, OptIrConstant>,
  bindingTime: ReturnType<typeof analyzeBindingTime>,
): readonly OptIrOperation[] {
  return Object.freeze(
    operations.map((operation) => {
      const folded = foldStaticOperation(operation, staticValues, bindingTime);
      if (folded === undefined) {
        return operation;
      }
      staticValues.set(operation.resultIds[0] as OptIrValueId, folded);
      return optIrConstantOperation({
        operationId: operation.operationId,
        resultId: operation.resultIds[0] as OptIrValueId,
        constant: folded,
        originId: operation.originId,
        displayName: operation.displayName,
      });
    }),
  );
}

function foldStaticOperation(
  operation: OptIrOperation,
  staticValues: ReadonlyMap<OptIrValueId, OptIrConstant>,
  bindingTime: ReturnType<typeof analyzeBindingTime>,
): OptIrIntegerConstant | undefined {
  if (
    operation.kind !== "integerBinary" ||
    bindingTime.classificationOf(operation.resultIds[0] as OptIrValueId).kind !== "static"
  ) {
    return undefined;
  }
  const left = staticValues.get(operation.left);
  const right = staticValues.get(operation.right);
  if (left?.kind !== "integer" || right?.kind !== "integer") {
    return undefined;
  }
  const normalizedValue = foldIntegerBinary(
    operation.operator,
    left.normalizedValue,
    right.normalizedValue,
  );
  if (normalizedValue === undefined) {
    return undefined;
  }
  return optIrIntegerConstant({
    constantId: optIrConstantId(Number(operation.operationId)),
    type: operation.resultTypes[0] ?? left.type,
    normalizedValue,
    dataModel: left.dataModel,
  });
}

function foldIntegerBinary(
  operator: OptIrIntegerBinaryOperator,
  left: bigint,
  right: bigint,
): bigint | undefined {
  switch (operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "and":
      return left & right;
    case "or":
      return left | right;
    case "xor":
      return left ^ right;
    default:
      return undefined;
  }
}

function driveProgramStaticControl(
  program: OptIrProgram,
  staticValues: ReadonlyMap<OptIrValueId, OptIrConstant>,
  rewriteObligations: OptIrSpecializationRewriteObligation[],
  worklist: OptIrWholeProgramSpecializationWorkItem[],
): OptIrProgram {
  return Object.freeze({
    ...program,
    functions: optIrFunctionTable(
      program.functions.entries().map((func) => {
        const driven = driveStaticControlFlow({
          blocks: func.blocks,
          edges: func.edges,
          staticValues,
        });
        if (!driven.changed) {
          return func;
        }
        const reason = `specialize:static-driving:${Number(func.functionId)}`;
        worklist.push(workItem("cleanup", func.functionId, reason));
        rewriteObligations.push(
          Object.freeze({
            ruleId: "specialization-static-driving",
            invariant: specializationResidualEquivalence({ includeStaticDriving: true }),
            cfgEdits: driven.cfgEdits,
          }),
        );
        return Object.freeze({ ...func, blocks: driven.blocks, edges: driven.edges });
      }),
    ),
  });
}

function cloneCandidates(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
  functionByInstance: ReadonlyMap<MonoInstanceId, OptIrFunction>,
): readonly CloneCandidate[] {
  const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const candidates: CloneCandidate[] = [];
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
        Number(left.callOperation.operationId) - Number(right.callOperation.operationId),
    ),
  );
}

function cloneDenial(
  candidate: CloneCandidate,
  blockedByScc: ReadonlySet<OptIrFunctionId>,
  variantCountByFunction: ReadonlyMap<OptIrFunctionId, number>,
  maxVariantsPerFunction: number,
  staticOperands: readonly OptIrCloneStaticOperand[],
): string | undefined {
  if (
    candidate.callOperation.kind !== "sourceCall" ||
    candidate.callOperation.target.kind !== "source"
  ) {
    return "specialize:denied:effect-boundary";
  }
  if (candidate.callee.externalRoot !== undefined) {
    return "specialize:denied:external-root";
  }
  if (
    blockedByScc.has(candidate.callee.functionId) ||
    blockedByScc.has(candidate.caller.functionId)
  ) {
    return "specialize:denied:recursive-scc";
  }
  if (isColdFunction(candidate.callee)) {
    return "specialize:denied:cold-path";
  }
  if ((variantCountByFunction.get(candidate.callee.functionId) ?? 0) >= maxVariantsPerFunction) {
    return "specialize:denied:variant-cap";
  }
  if (staticOperands.length === 0) {
    return "specialize:denied:no-static-operands";
  }
  return undefined;
}

function isColdFunction(func: OptIrFunction): boolean {
  return (
    typeof func.summary === "object" &&
    func.summary !== null &&
    "isCold" in func.summary &&
    func.summary.isCold === true
  );
}

function owningFunction(
  program: OptIrProgram,
  operationId: OptIrOperationId,
): OptIrFunction | undefined {
  return program.functions
    .entries()
    .find((func) =>
      func.blocks.some((block: OptIrBlock) => block.operations.includes(operationId)),
    );
}

function estimatedGrowth(
  callee: OptIrFunction,
  operationById: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): number {
  return callee.blocks
    .flatMap((block) => block.operations)
    .filter((operationId) => operationById.has(operationId)).length;
}

function sccKeys(
  program: OptIrProgram,
  sccEntries: readonly { readonly functions: readonly OptIrFunctionId[] }[],
): Map<OptIrFunctionId, string> {
  const keys = new Map(
    program.functions
      .entries()
      .map((func) => [func.functionId, String(Number(func.functionId))] as const),
  );
  for (const scc of sccEntries) {
    const key = scc.functions
      .map((functionId) => Number(functionId))
      .sort((left, right) => left - right)
      .join(".");
    for (const functionId of scc.functions) {
      keys.set(functionId, key);
    }
  }
  return keys;
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

function cloneCandidateKey(candidate: CloneCandidate): string {
  return `specialize:caller=${Number(candidate.caller.functionId)}:callee=${Number(
    candidate.callee.functionId,
  )}:site=${Number(candidate.callOperation.operationId)}`;
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
