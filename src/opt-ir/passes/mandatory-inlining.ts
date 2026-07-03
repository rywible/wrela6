import { optIrCfgEdgeTable, type OptIrBlock } from "../cfg";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import {
  preserveOptIrFactsForRewrite,
  type OptIrCheckedFactForPreservation,
  type OptIrDroppedFact,
  type OptIrPreservedFact,
} from "../facts/fact-preservation";
import { createOptIrSubjectRemapTable } from "../facts/subject-remapping";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import { optIrCallId, optIrFunctionId, optIrOperationId } from "../ids";
import type { OptIrOperation } from "../operations";
import {
  mandatoryInlinePolicyForFunction,
  type OptIrInlinePolicySummary,
} from "../policy/inline-policy";
import type { OptIrFunction } from "../program";
import { rewriteOptIrOperationValues } from "./operation-value-rewrite";

type OptIrSourceCallOperation = OptIrOperation & {
  readonly kind: "sourceCall";
  readonly target: {
    readonly kind: "source";
    readonly functionInstanceId: OptIrFunction["monoInstanceId"];
  };
  readonly argumentIds: readonly OptIrValueId[];
};
type InlineShapeResult =
  | {
      readonly kind: "ok";
      readonly entryBlock: OptIrBlock;
      readonly calleeOperations: readonly OptIrOperation[];
      readonly returnValues: readonly OptIrValueId[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export type MandatoryInliningFunctionSummary = OptIrInlinePolicySummary & {
  readonly terminalBehavior?: unknown;
  readonly divergence?: readonly unknown[];
  readonly observedRegions?: readonly unknown[];
  readonly consumedRegions?: readonly unknown[];
  readonly mutatedRegions?: readonly unknown[];
  readonly producedRegions?: readonly unknown[];
  readonly capabilityEffects?: readonly unknown[];
  readonly privateStateEffects?: readonly unknown[];
  readonly invalidations?: readonly unknown[];
};

export interface RunMandatoryInliningInput {
  readonly caller: OptIrFunction;
  readonly callee: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly facts: readonly OptIrCheckedFactForPreservation[];
  readonly nextFactId: Parameters<typeof preserveOptIrFactsForRewrite>[0]["nextFactId"];
}

export type RunMandatoryInliningResult =
  | {
      readonly kind: "ok";
      readonly function: OptIrFunction;
      readonly operations: readonly OptIrOperation[];
      readonly preservedFacts: readonly OptIrPreservedFact[];
      readonly droppedFacts: readonly OptIrDroppedFact[];
      readonly inlinedCallOperationIds: readonly OptIrOperationId[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

interface InlineSite {
  readonly callOperation: OptIrSourceCallOperation;
  readonly block: OptIrBlock;
}

export function runMandatoryInliningForTest(
  input: RunMandatoryInliningInput,
): RunMandatoryInliningResult {
  return runMandatoryInlining(input);
}

export function runMandatoryInlining(input: RunMandatoryInliningInput): RunMandatoryInliningResult {
  const policy = mandatoryInlinePolicyForFunction(input.callee);
  if (policy === undefined) {
    return okResult({
      functionOutput: input.caller,
      operations: input.operations,
      preservedFacts: [],
      droppedFacts: [],
      inlinedCallOperationIds: [],
    });
  }

  const site = findInlineSite(input);
  if (site === undefined) {
    return mandatoryInlineError(input.caller, input.callee, "mandatory-callee-not-called");
  }

  const shape = validateInlineShape(input, site);
  if (shape.kind === "error") {
    return shape;
  }

  const substitution = buildValueSubstitution(
    site.callOperation,
    shape.entryBlock,
    shape.returnValues,
  );
  const operationSubstitution = buildOperationSubstitution({
    callOperationId: site.callOperation.operationId,
    calleeOperations: shape.calleeOperations,
    operations: input.operations,
  });
  const clonedOperations = shape.calleeOperations.map((operation) =>
    rewriteOperationId(
      rewriteOptIrOperationValues(operation, {
        valueFor: (valueId) => valueForSubstitution(substitution, valueId),
      }),
      requireSubstitutedOperationId(operationSubstitution, operation.operationId),
    ),
  );
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  operationById.delete(site.callOperation.operationId);
  for (const operation of clonedOperations) {
    operationById.set(operation.operationId, operation);
  }

  const callerFunction = inlineIntoCaller(input.caller, site, clonedOperations);
  const remap = createOptIrSubjectRemapTable({
    values: valueRemapEntries(substitution),
    operations: operationRemapEntries(operationSubstitution),
    blocks: [[input.callee.entryBlock, site.block.blockId]],
  });
  const preservation = preserveOptIrFactsForRewrite({
    facts: input.facts.filter(
      (fact) => fact.scope.kind !== "function" || fact.scope.functionId === input.callee.functionId,
    ),
    remap,
    nextFactId: input.nextFactId,
    ruleId: "mandatory-semantic-inline",
    obligationId: "mandatory-inline-equivalence",
  });

  return okResult({
    functionOutput: callerFunction,
    operations: [...operationById.values()].sort(compareOperations),
    preservedFacts: preservation.preservedFacts.map((fact) =>
      fact.scope.kind === "function"
        ? Object.freeze({
            ...fact,
            scope: Object.freeze({
              kind: "function" as const,
              functionId: input.caller.functionId,
            }),
          })
        : fact,
    ),
    droppedFacts: preservation.droppedFacts,
    inlinedCallOperationIds: [site.callOperation.operationId],
  });
}

function findInlineSite(input: RunMandatoryInliningInput): InlineSite | undefined {
  const operationsById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  for (const block of input.caller.blocks) {
    for (const operationId of block.operations) {
      const operation = operationsById.get(operationId);
      if (operation === undefined || !isSourceCallTo(operation, input.callee)) {
        continue;
      }
      return { callOperation: operation, block };
    }
  }
  return undefined;
}

function validateInlineShape(
  input: RunMandatoryInliningInput,
  site: InlineSite,
): InlineShapeResult {
  if (input.callee.externalRoot !== undefined) {
    return mandatoryInlineShapeError(input.caller, input.callee, "external-abi-boundary");
  }
  if (input.callee.blocks.length !== 1) {
    return mandatoryInlineShapeError(input.caller, input.callee, "multi-block-callee");
  }
  const entryBlock = input.callee.blocks[0];
  if (entryBlock === undefined || entryBlock.terminator?.kind !== "return") {
    return mandatoryInlineShapeError(input.caller, input.callee, "non-returning-callee");
  }
  if (entryBlock.parameters.length !== site.callOperation.argumentIds.length) {
    return mandatoryInlineShapeError(input.caller, input.callee, "argument-count-mismatch");
  }
  if (entryBlock.terminator.values.length !== site.callOperation.resultIds.length) {
    return mandatoryInlineShapeError(input.caller, input.callee, "result-count-mismatch");
  }

  const operationsById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const callerOperationIds = new Set(input.caller.blocks.flatMap((block) => block.operations));
  const calleeOperations = entryBlock.operations.map((operationId) =>
    operationsById.get(operationId),
  );
  if (calleeOperations.some((operation) => operation === undefined)) {
    return mandatoryInlineShapeError(input.caller, input.callee, "missing-callee-operation");
  }
  const completeOperations = calleeOperations.filter(
    (operation): operation is OptIrOperation => operation !== undefined,
  );
  if (completeOperations.some((operation) => !operationIsInlineSafe(operation))) {
    return mandatoryInlineShapeError(input.caller, input.callee, "unsafe-callee-operation");
  }
  if (completeOperations.some((operation) => callerOperationIds.has(operation.operationId))) {
    return mandatoryInlineShapeError(input.caller, input.callee, "operation-id-collision");
  }

  return {
    kind: "ok",
    entryBlock,
    calleeOperations: completeOperations,
    returnValues: entryBlock.terminator.values,
  };
}

function inlineIntoCaller(
  caller: OptIrFunction,
  site: InlineSite,
  clonedOperations: readonly OptIrOperation[],
): OptIrFunction {
  return Object.freeze({
    ...caller,
    blocks: Object.freeze(
      caller.blocks.map((block) => {
        if (block.blockId !== site.block.blockId) {
          return block;
        }
        return Object.freeze({
          ...block,
          operations: Object.freeze(
            block.operations.flatMap((operationId) =>
              operationId === site.callOperation.operationId
                ? clonedOperations.map((operation) => operation.operationId)
                : [operationId],
            ),
          ),
        });
      }),
    ),
    edges: optIrCfgEdgeTable(caller.edges.entries()),
  });
}

function buildValueSubstitution(
  callOperation: OptIrSourceCallOperation,
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

function rewriteOperationId(
  operation: OptIrOperation,
  operationId: OptIrOperationId,
): OptIrOperation {
  if (
    operation.kind === "sourceCall" ||
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "intrinsicCall"
  ) {
    return Object.freeze({ ...operation, operationId, callId: optIrCallId(Number(operationId)) });
  }
  return Object.freeze({ ...operation, operationId });
}

function valueForSubstitution(
  substitution: ReadonlyMap<OptIrValueId, OptIrValueId>,
  valueId: OptIrValueId,
): OptIrValueId {
  return substitution.get(valueId) ?? valueId;
}

function operationIsInlineSafe(operation: OptIrOperation): boolean {
  if (operation.kind === "sourceCall" || operation.kind === "runtimeCall") {
    return false;
  }
  if (operation.kind === "platformCall" || operation.kind === "intrinsicCall") {
    return true;
  }
  return operation.effects.isRuntimePure && !operation.effects.hasTerminalEffects;
}

function isSourceCallTo(
  operation: OptIrOperation,
  callee: OptIrFunction,
): operation is OptIrSourceCallOperation {
  return (
    operation.kind === "sourceCall" &&
    operation.target.kind === "source" &&
    operation.target.functionInstanceId === callee.monoInstanceId
  );
}

function buildOperationSubstitution(input: {
  readonly callOperationId: OptIrOperationId;
  readonly calleeOperations: readonly OptIrOperation[];
  readonly operations: readonly OptIrOperation[];
}): ReadonlyMap<OptIrOperationId, OptIrOperationId> {
  let nextOperationId = optIrOperationId(
    Math.max(0, ...input.operations.map((operation) => Number(operation.operationId))) + 1,
  );
  const substitutions = new Map<OptIrOperationId, OptIrOperationId>();
  input.calleeOperations.forEach((operation, index) => {
    if (index === 0) {
      substitutions.set(operation.operationId, input.callOperationId);
      return;
    }
    substitutions.set(operation.operationId, nextOperationId);
    nextOperationId = optIrOperationId(Number(nextOperationId) + 1);
  });
  return substitutions;
}

function requireSubstitutedOperationId(
  substitution: ReadonlyMap<OptIrOperationId, OptIrOperationId>,
  operationId: OptIrOperationId,
): OptIrOperationId {
  const substituted = substitution.get(operationId);
  if (substituted === undefined) {
    throw new RangeError(`Missing mandatory inline operation clone for ${String(operationId)}.`);
  }
  return substituted;
}

function operationRemapEntries(
  substitution: ReadonlyMap<OptIrOperationId, OptIrOperationId>,
): readonly (readonly [OptIrOperationId, OptIrOperationId])[] {
  return Object.freeze([...substitution.entries()].sort((left, right) => left[0] - right[0]));
}

function valueRemapEntries(
  substitution: ReadonlyMap<OptIrValueId, OptIrValueId>,
): readonly (readonly [OptIrValueId, OptIrValueId])[] {
  return Object.freeze([...substitution.entries()].sort((left, right) => left[0] - right[0]));
}

function okResult(input: {
  readonly functionOutput: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly preservedFacts: readonly OptIrPreservedFact[];
  readonly droppedFacts: readonly OptIrDroppedFact[];
  readonly inlinedCallOperationIds: readonly OptIrOperationId[];
}): RunMandatoryInliningResult {
  return Object.freeze({
    kind: "ok",
    function: input.functionOutput,
    operations: Object.freeze([...input.operations]),
    preservedFacts: Object.freeze([...input.preservedFacts]),
    droppedFacts: Object.freeze([...input.droppedFacts]),
    inlinedCallOperationIds: Object.freeze([...input.inlinedCallOperationIds]),
  });
}

function mandatoryInlineError(
  caller: OptIrFunction,
  callee: OptIrFunction,
  detail: string,
): RunMandatoryInliningResult {
  return { kind: "error", diagnostics: mandatoryInlineDiagnostics(caller, callee, detail) };
}

function mandatoryInlineShapeError(
  caller: OptIrFunction,
  callee: OptIrFunction,
  detail: string,
): InlineShapeResult {
  return { kind: "error", diagnostics: mandatoryInlineDiagnostics(caller, callee, detail) };
}

function mandatoryInlineDiagnostics(
  caller: OptIrFunction,
  callee: OptIrFunction,
  detail: string,
): readonly OptIrDiagnostic[] {
  const code = optIrDiagnosticCode("OPT_IR_REWRITE_LEGALITY_INVALID");
  const stableDetail = `mandatory-inline:${callee.monoInstanceId}:${detail}`;
  return sortOptIrDiagnostics([
    {
      severity: "error",
      code,
      messageTemplate:
        "Internal compiler error: checked mandatory semantic-inline candidate cannot be inlined safely.",
      arguments: { callee: String(callee.monoInstanceId), detail },
      ownerKey: `function:${callee.functionId}`,
      rootCauseKey: stableDetail,
      stableDetail,
      functionId: optIrFunctionId(Number(caller.functionId)),
      originId: callee.originId,
      orderKey: optIrDiagnosticOrderKey({
        originKey: String(callee.originId),
        functionKey: String(caller.functionId),
        code,
        ownerKey: `function:${callee.functionId}`,
        rootCauseKey: stableDetail,
        stableDetail,
      }),
    },
  ]);
}

function compareOperations(left: OptIrOperation, right: OptIrOperation): number {
  return left.operationId - right.operationId;
}
