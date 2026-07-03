import { computeValueNumbers } from "../analyses/value-numbering";
import { computeOptIrDominance, type OptIrDominanceAnalysis } from "../analyses/dominance";
import type { OptIrBlockId, OptIrFunctionId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import { optIrCfgEdgeTable } from "../cfg";
import type { OptIrTerminator } from "../terminators";
import {
  optIrFunctionTable,
  optIrProgram,
  type OptIrFunction,
  type OptIrProgram,
} from "../program";
import { rewriteOptIrOperationValues } from "./operation-value-rewrite";

export interface GvnReplacement {
  readonly removedOperationId: OptIrOperationId;
  readonly keptOperationId: OptIrOperationId;
  readonly removedValueId: OptIrValueId;
  readonly keptValueId: OptIrValueId;
  readonly valueNumber: string;
}

export interface GvnInput {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}

export interface GvnResult {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly replacements: readonly GvnReplacement[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly worklistOrder: readonly string[];
}

interface OperationPlacement {
  readonly functionId: OptIrFunctionId;
  readonly blockId: OptIrBlockId;
  readonly position: number;
  readonly dominance: OptIrDominanceAnalysis;
}

export function runGvn(input: GvnInput): GvnResult {
  const valueNumbers = computeValueNumbers(input);
  const placements = operationPlacements(input.program);
  const keptByValueNumber = new Map<string, OptIrOperation[]>();
  const removedOperationIds = new Set<OptIrOperationId>();
  const replacements: GvnReplacement[] = [];

  for (const record of valueNumbers.records) {
    const operation = input.operations.get(record.operationId);
    if (operation === undefined || !record.commonable) {
      continue;
    }
    const existing = (keptByValueNumber.get(record.valueNumber) ?? []).find((candidate) =>
      operationDominatesOperation(candidate, operation, placements),
    );
    if (existing === undefined) {
      keptByValueNumber.set(record.valueNumber, [
        ...(keptByValueNumber.get(record.valueNumber) ?? []),
        operation,
      ]);
      continue;
    }
    const removedValueId = operation.resultIds[0];
    const keptValueId = existing.resultIds[0];
    if (removedValueId === undefined || keptValueId === undefined) {
      continue;
    }
    removedOperationIds.add(operation.operationId);
    replacements.push({
      removedOperationId: operation.operationId,
      keptOperationId: existing.operationId,
      removedValueId,
      keptValueId,
      valueNumber: record.valueNumber,
    });
  }

  const valueReplacements = canonicalValueReplacements(replacements);
  const operations = new Map<OptIrOperationId, OptIrOperation>();
  for (const [operationId, operation] of input.operations.entries()) {
    if (!removedOperationIds.has(operationId)) {
      operations.set(
        operationId,
        rewriteOptIrOperationValues(operation, {
          valueFor: (valueId) => substituteValue(valueId, valueReplacements),
        }),
      );
    }
  }
  const program = optIrProgram({
    ...input.program,
    functions: optIrFunctionTable(
      input.program.functions
        .entries()
        .map((functionInput) =>
          rewriteFunctionValues(
            removeOperations(functionInput, removedOperationIds),
            valueReplacements,
          ),
        ),
    ),
  });

  return Object.freeze({
    program,
    operations,
    replacements: Object.freeze(replacements),
    removedOperationIds: Object.freeze(
      [...removedOperationIds].sort((left, right) => left - right),
    ),
    worklistOrder: valueNumbers.worklistOrder,
  });
}

function operationPlacements(
  program: OptIrProgram,
): ReadonlyMap<OptIrOperationId, OperationPlacement> {
  const placements = new Map<OptIrOperationId, OperationPlacement>();
  for (const function_ of program.functions.entries()) {
    const dominance = computeOptIrDominance(function_);
    for (const block of function_.blocks) {
      block.operations.forEach((operationId, position) => {
        placements.set(operationId, {
          functionId: function_.functionId,
          blockId: block.blockId,
          position,
          dominance,
        });
      });
    }
  }
  return placements;
}

function operationDominatesOperation(
  dominator: OptIrOperation,
  dominated: OptIrOperation,
  placements: ReadonlyMap<OptIrOperationId, OperationPlacement>,
): boolean {
  const dominatorPlacement = placements.get(dominator.operationId);
  const dominatedPlacement = placements.get(dominated.operationId);
  if (
    dominatorPlacement === undefined ||
    dominatedPlacement === undefined ||
    dominatorPlacement.functionId !== dominatedPlacement.functionId
  ) {
    return false;
  }
  if (dominatorPlacement.blockId === dominatedPlacement.blockId) {
    return dominatorPlacement.position < dominatedPlacement.position;
  }
  return dominatorPlacement.dominance.dominates(
    dominatorPlacement.blockId,
    dominatedPlacement.blockId,
  );
}

function removeOperations(
  functionInput: OptIrFunction,
  removedOperationIds: ReadonlySet<OptIrOperationId>,
): OptIrFunction {
  return {
    ...functionInput,
    blocks: functionInput.blocks.map((block) => ({
      ...block,
      operations: block.operations.filter((operationId) => !removedOperationIds.has(operationId)),
    })),
  };
}

function canonicalValueReplacements(
  replacements: readonly GvnReplacement[],
): ReadonlyMap<OptIrValueId, OptIrValueId> {
  const direct = new Map<OptIrValueId, OptIrValueId>(
    replacements
      .map((replacement) => [replacement.removedValueId, replacement.keptValueId] as const)
      .sort((left, right) => left[0] - right[0]),
  );
  const canonical = new Map<OptIrValueId, OptIrValueId>();
  for (const valueId of [...direct.keys()].sort((left, right) => left - right)) {
    const replacement = resolveValueReplacement(valueId, direct);
    if (replacement !== valueId) {
      canonical.set(valueId, replacement);
    }
  }
  return canonical;
}

function resolveValueReplacement(
  valueId: OptIrValueId,
  replacements: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrValueId {
  const seen = new Set<OptIrValueId>();
  let current = valueId;
  while (true) {
    const next = replacements.get(current);
    if (next === undefined) {
      return current;
    }
    if (seen.has(next)) {
      return valueId;
    }
    seen.add(current);
    current = next;
  }
}

function rewriteFunctionValues(
  functionInput: OptIrFunction,
  replacements: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrFunction {
  if (replacements.size === 0) {
    return functionInput;
  }
  return {
    ...functionInput,
    blocks: functionInput.blocks.map((block) => ({
      ...block,
      terminator:
        block.terminator === undefined
          ? undefined
          : rewriteTerminatorValues(block.terminator, replacements),
    })),
    edges: optIrCfgEdgeTable(
      functionInput.edges.entries().map((edge) => ({
        ...edge,
        arguments: edge.arguments.map((argument) => substituteValue(argument, replacements)),
        ...(edge.condition === undefined
          ? {}
          : { condition: substituteValue(edge.condition, replacements) }),
      })),
    ),
  };
}

function rewriteTerminatorValues(
  terminator: OptIrTerminator,
  replacements: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrTerminator {
  switch (terminator.kind) {
    case "branch":
      return { ...terminator, condition: substituteValue(terminator.condition, replacements) };
    case "switch":
      return { ...terminator, scrutinee: substituteValue(terminator.scrutinee, replacements) };
    case "return":
      return {
        ...terminator,
        values: terminator.values.map((value) => substituteValue(value, replacements)),
      };
    case "jump":
    case "unreachable":
      return terminator;
  }
}

function substituteValue(
  valueId: OptIrValueId,
  replacements: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrValueId {
  return replacements.get(valueId) ?? valueId;
}
