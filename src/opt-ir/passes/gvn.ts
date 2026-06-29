import { computeValueNumbers } from "../analyses/value-numbering";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import {
  optIrFunctionTable,
  optIrProgram,
  type OptIrFunction,
  type OptIrProgram,
} from "../program";

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

export function runGvn(input: GvnInput): GvnResult {
  const valueNumbers = computeValueNumbers(input);
  const keptByValueNumber = new Map<string, OptIrOperation>();
  const removedOperationIds = new Set<OptIrOperationId>();
  const replacements: GvnReplacement[] = [];

  for (const record of valueNumbers.records) {
    const operation = input.operations.get(record.operationId);
    if (operation === undefined || !record.commonable) {
      continue;
    }
    const existing = keptByValueNumber.get(record.valueNumber);
    if (existing === undefined) {
      keptByValueNumber.set(record.valueNumber, operation);
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

  const operations = new Map<OptIrOperationId, OptIrOperation>();
  for (const [operationId, operation] of input.operations.entries()) {
    if (!removedOperationIds.has(operationId)) {
      operations.set(operationId, operation);
    }
  }
  const program = optIrProgram({
    ...input.program,
    functions: optIrFunctionTable(
      input.program.functions
        .entries()
        .map((functionInput) => removeOperations(functionInput, removedOperationIds)),
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
