import type { OptIrConstant } from "../constants";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";

export interface OptIrCheckedDependency {
  readonly kind: "operation" | "value";
  readonly operationId?: OptIrOperationId;
  readonly valueId?: OptIrValueId;
}

export interface OptIrFactLineage {
  readonly checkedDependencies: readonly OptIrCheckedDependency[];
}

export interface OptIrRange {
  readonly min: bigint;
  readonly max: bigint;
}

export interface OptIrRangeFact {
  readonly kind: "range";
  readonly valueId: OptIrValueId;
  readonly range: OptIrRange;
  readonly lineage: OptIrFactLineage;
}

export interface RangeAnalysisInput {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly constantValues?: ReadonlyMap<OptIrValueId, OptIrConstant>;
}

export interface RangeAnalysisResult {
  readonly facts: readonly OptIrRangeFact[];
  readonly ranges: ReadonlyMap<OptIrValueId, OptIrRange>;
}

export function analyzeRanges(input: RangeAnalysisInput): RangeAnalysisResult {
  const ranges = new Map<OptIrValueId, OptIrRange>();
  const facts: OptIrRangeFact[] = [];

  for (const [valueId, constant] of sortedValueConstants(input.constantValues ?? new Map())) {
    const range = rangeFromConstant(constant);
    ranges.set(valueId, range);
    facts.push({
      kind: "range",
      valueId,
      range,
      lineage: { checkedDependencies: [{ kind: "value", valueId }] },
    });
  }

  for (const operation of operationsInProgramOrder(input.program, input.operations)) {
    if (operation.kind !== "integerBinary" || operation.operator !== "add") {
      continue;
    }
    const left = ranges.get(operation.left);
    const right = ranges.get(operation.right);
    const resultId = operation.resultIds[0];
    if (left === undefined || right === undefined || resultId === undefined) {
      continue;
    }
    const range = { min: left.min + right.min, max: left.max + right.max };
    ranges.set(resultId, range);
    facts.push({
      kind: "range",
      valueId: resultId,
      range,
      lineage: {
        checkedDependencies: [
          { kind: "value", valueId: operation.left },
          { kind: "operation", operationId: operation.operationId },
        ],
      },
    });
  }

  return Object.freeze({
    facts: Object.freeze(facts),
    ranges,
  });
}

export function rangeFromConstant(constant: OptIrConstant): OptIrRange {
  return { min: constant.normalizedValue, max: constant.normalizedValue };
}

function sortedValueConstants(
  constants: ReadonlyMap<OptIrValueId, OptIrConstant>,
): readonly (readonly [OptIrValueId, OptIrConstant])[] {
  return [...constants.entries()].sort((left, right) => left[0] - right[0]);
}

function operationsInProgramOrder(
  program: OptIrProgram,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): readonly OptIrOperation[] {
  const ordered: OptIrOperation[] = [];
  for (const functionInput of program.functions.entries()) {
    for (const block of [...functionInput.blocks].sort(
      (left, right) => left.blockId - right.blockId,
    )) {
      for (const operationId of [...block.operations].sort((left, right) => left - right)) {
        const operation = operations.get(operationId);
        if (operation !== undefined) {
          ordered.push(operation);
        }
      }
    }
  }
  return ordered;
}
