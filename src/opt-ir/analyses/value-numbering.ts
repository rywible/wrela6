import { optIrConstantStableKey } from "../constants";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import { optIrTypeStableKey } from "../types";

export interface ValueNumberingInput {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}

export interface ValueNumberRecord {
  readonly operationId: OptIrOperationId;
  readonly resultIds: readonly OptIrValueId[];
  readonly valueNumber: string;
  readonly commonable: boolean;
}

export interface ValueNumberingResult {
  readonly records: readonly ValueNumberRecord[];
  readonly byOperationId: ReadonlyMap<OptIrOperationId, ValueNumberRecord>;
  readonly worklistOrder: readonly string[];
}

export function computeValueNumbers(input: ValueNumberingInput): ValueNumberingResult {
  const records: ValueNumberRecord[] = [];
  const byOperationId = new Map<OptIrOperationId, ValueNumberRecord>();
  const worklistOrder: string[] = [];
  const aliases = new Map<OptIrValueId, OptIrValueId>();

  for (const functionInput of input.program.functions.entries()) {
    worklistOrder.push(`function:${functionInput.functionId}`);
    for (const block of [...functionInput.blocks].sort(
      (left, right) => left.blockId - right.blockId,
    )) {
      worklistOrder.push(`block:${block.blockId}`);
      for (const operationId of [...block.operations].sort((left, right) => left - right)) {
        const operation = input.operations.get(operationId);
        if (operation === undefined) {
          continue;
        }
        worklistOrder.push(`operation:${operation.operationId}`);
        for (const valueId of [...operation.resultIds].sort((left, right) => left - right)) {
          worklistOrder.push(`value:${valueId}`);
        }
        const record = {
          operationId: operation.operationId,
          resultIds: operation.resultIds,
          valueNumber: valueNumberFor(operation, aliases),
          commonable: isCommonableOperation(operation),
        };
        records.push(record);
        byOperationId.set(operation.operationId, record);
        const resultId = operation.resultIds[0];
        if (resultId !== undefined) {
          aliases.set(resultId, canonicalAliasForResult(operation, resultId));
        }
      }
    }
  }

  return Object.freeze({
    records: Object.freeze(records),
    byOperationId,
    worklistOrder: Object.freeze(worklistOrder),
  });
}

function canonicalAliasForResult(operation: OptIrOperation, resultId: OptIrValueId): OptIrValueId {
  if (operation.kind === "constant") {
    return operation.operationId as unknown as OptIrValueId;
  }
  return resultId;
}

export function isCommonableOperation(operation: OptIrOperation): boolean {
  if (operation.resultIds.length !== 1 || !operation.effects.isRuntimePure) {
    return false;
  }
  if (operation.effects.hasTerminalEffects || operation.effects.usesOrderedRegionTokens) {
    return false;
  }
  if (
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "sourceCall" ||
    operation.kind === "memoryLoad" ||
    operation.kind === "memoryStore" ||
    operation.kind === "vectorLoad" ||
    operation.kind === "vectorMaskedLoad" ||
    operation.kind === "vectorStore" ||
    operation.kind === "vectorMaskedStore" ||
    operation.kind === "proofErasedMarker"
  ) {
    return false;
  }
  return (
    typeof operation.semantics.loweringRequirement === "object" &&
    operation.semantics.loweringRequirement.kind === "core"
  );
}

export function valueNumberFor(
  operation: OptIrOperation,
  aliases: ReadonlyMap<OptIrValueId, OptIrValueId> = new Map(),
): string {
  const operandKey = operation.operandIds
    .map((valueId) => `${canonicalValue(aliases, valueId)}:${valueId}`)
    .join(",");
  return [
    operation.kind,
    operation.semantics.semanticsRule,
    operation.semantics.interpreterRule,
    operandKey,
    attributesKey(operation),
    `types:${operation.resultTypes.map(optIrTypeStableKey).join(",")}`,
  ].join("|");
}

function canonicalValue(
  aliases: ReadonlyMap<OptIrValueId, OptIrValueId>,
  valueId: OptIrValueId,
): OptIrValueId {
  return aliases.get(valueId) ?? valueId;
}

function attributesKey(operation: OptIrOperation): string {
  switch (operation.kind) {
    case "constant":
      return `constant:${optIrConstantStableKey(operation.constant)}`;
    case "integerUnary":
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      return `operator:${operation.operator}`;
    case "layoutOffset":
    case "layoutByteRange":
      return `layout:${operation.layoutPath}`;
    case "layoutEndianDecode":
    case "vectorByteSwap":
      return `endian:${operation.endian}`;
    case "aggregateExtract":
    case "aggregateInsert":
      return `field:${operation.fieldPath.join(".")}`;
    case "memoryLoad":
    case "memoryStore":
    case "vectorLoad":
    case "vectorMaskedLoad":
    case "vectorStore":
    case "vectorMaskedStore":
      return memoryAccessKey(operation.memoryAccess);
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      return `target:${JSON.stringify(operation.target)}`;
    case "vectorShuffle":
      return `shuffle:${operation.shuffleIndices.join(",")}`;
    case "proofErasedMarker":
      return `proof:${operation.erasedProof}`;
    case "booleanNot":
    case "aggregateConstruct":
    case "vectorCompare":
    case "vectorSelect":
      return "attributes:none";
  }
}

function memoryAccessKey(memoryAccess: OptIrMemoryAccessDescriptor): string {
  return [
    `region:${memoryAccess.region}`,
    `offset:${memoryAccess.byteOffset}`,
    `width:${memoryAccess.byteWidth}`,
    `align:${memoryAccess.alignment}`,
    `type:${optIrTypeStableKey(memoryAccess.valueType)}`,
    `endian:${memoryAccess.endian}`,
    `volatility:${memoryAccess.volatility}`,
    `bounds:${JSON.stringify(memoryAccess.boundsAuthority)}`,
  ].join(",");
}
