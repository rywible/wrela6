import type { OptIrBlock, OptIrCfgEdgeTable } from "./cfg";
import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "./operations";
import type { OptIrInterpreterRuleId, OptIrOperationId, OptIrValueId } from "./ids";
import type { OptIrType } from "./types";

export type OptIrRuntimeValue =
  | { readonly type: OptIrType; readonly value: bigint }
  | { readonly type: OptIrType; readonly value: boolean }
  | { readonly type: OptIrType; readonly fields: readonly OptIrRuntimeValue[] };

export type OptIrIntegerOverflowMode = "wrap" | "trap";

export interface OptIrInterpreterMemoryEvent {
  readonly kind: "read" | "write";
  readonly operationId: OptIrOperationId;
  readonly region: number;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
}

export interface OptIrInterpreterEffectTrace {
  readonly record: (event: OptIrInterpreterMemoryEvent) => void;
  readonly snapshot: () => readonly string[];
}

export interface OptIrInterpreterMemory {
  readonly load: (
    access: OptIrMemoryAccessDescriptor,
  ) => { readonly kind: "ok"; readonly value: OptIrRuntimeValue } | OptIrTrap;
  readonly store: (
    access: OptIrMemoryAccessDescriptor,
    value: OptIrRuntimeValue,
  ) => { readonly kind: "ok" } | OptIrTrap;
  readonly snapshot: () => readonly (readonly [string, OptIrRuntimeValue])[];
}

export interface OptIrInterpreterSlice {
  readonly entryBlock: OptIrBlock["blockId"];
  readonly blocks: readonly OptIrBlock[];
  readonly edges: OptIrCfgEdgeTable;
  readonly operations: readonly OptIrOperation[];
}

export interface OptIrInterpreterInput {
  readonly slice: OptIrInterpreterSlice;
  readonly memory?: OptIrInterpreterMemory;
  readonly effects?: OptIrInterpreterEffectTrace;
  readonly overflowMode?: OptIrIntegerOverflowMode;
}

export interface OptIrInterpreterObservations {
  readonly memory: readonly (readonly [string, OptIrRuntimeValue])[];
  readonly effects: readonly string[];
}

export type OptIrInterpreterResult =
  | {
      readonly kind: "returned";
      readonly values: readonly OptIrRuntimeValue[];
      readonly observations: OptIrInterpreterObservations;
    }
  | { readonly kind: "trapped"; readonly reason: string };

export type OptIrTrap = { readonly kind: "trap"; readonly reason: string };

export type OptIrInterpreterCompleteness =
  | { readonly kind: "complete" }
  | { readonly kind: "rejected"; readonly reasons: readonly string[] };

const INTERPRETER_COMPLETE_RULES = new Set<string>([
  "constant-literal",
  "integer-binary",
  "integer-compare",
  "memory-load",
  "memory-store",
]);

export function validateOptIrSliceIsInterpreterComplete(
  slice: OptIrInterpreterSlice,
): OptIrInterpreterCompleteness {
  const reasons: string[] = [];
  for (const operation of slice.operations) {
    const rule = ruleKey(operation.semantics.interpreterRule);
    if (!INTERPRETER_COMPLETE_RULES.has(rule)) {
      reasons.push(`unsupported-interpreter-rule:${rule}`);
    }
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  return uniqueReasons.length === 0
    ? { kind: "complete" }
    : { kind: "rejected", reasons: uniqueReasons };
}

export function interpretOptIrSlice(input: OptIrInterpreterInput): OptIrInterpreterResult {
  const context: Context = {
    values: new Map(),
    operations: new Map(
      input.slice.operations.map((operation) => [operation.operationId, operation]),
    ),
    blocks: new Map(input.slice.blocks.map((block) => [block.blockId, block])),
    edges: input.slice.edges,
    memory: input.memory,
    effects: input.effects,
    overflowMode: input.overflowMode ?? "wrap",
  };

  let currentBlock = context.blocks.get(input.slice.entryBlock);
  if (currentBlock === undefined) {
    return trapped(`missing-entry-block:${input.slice.entryBlock}`);
  }

  for (;;) {
    const blockResult = interpretBlock(currentBlock, context);
    if (blockResult.kind === "trap") {
      return trapped(blockResult.reason);
    }
    if (blockResult.kind === "returned") {
      return {
        kind: "returned",
        values: blockResult.values,
        observations: observations(context),
      };
    }
    currentBlock = context.blocks.get(blockResult.nextBlock);
    if (currentBlock === undefined) {
      return trapped(`missing-successor-block:${blockResult.nextBlock}`);
    }
  }
}

interface Context {
  readonly values: Map<OptIrValueId, OptIrRuntimeValue>;
  readonly operations: Map<OptIrOperationId, OptIrOperation>;
  readonly blocks: Map<OptIrBlock["blockId"], OptIrBlock>;
  readonly edges: OptIrCfgEdgeTable;
  readonly memory?: OptIrInterpreterMemory;
  readonly effects?: OptIrInterpreterEffectTrace;
  readonly overflowMode: OptIrIntegerOverflowMode;
}

type BlockResult =
  | { readonly kind: "next"; readonly nextBlock: OptIrBlock["blockId"] }
  | { readonly kind: "returned"; readonly values: readonly OptIrRuntimeValue[] }
  | OptIrTrap;

function interpretBlock(block: OptIrBlock, context: Context): BlockResult {
  for (const operationId of block.operations) {
    const operation = context.operations.get(operationId);
    if (operation === undefined) {
      return { kind: "trap", reason: `missing-operation:${operationId}` };
    }
    const result = interpretOperation(operation, context);
    if (result.kind === "trap") {
      return result;
    }
  }

  const terminator = block.terminator;
  if (terminator === undefined) {
    return { kind: "trap", reason: `missing-terminator:${block.blockId}` };
  }

  switch (terminator.kind) {
    case "return": {
      const values = readValues(context, terminator.values);
      return values.kind === "trap" ? values : { kind: "returned", values: values.values };
    }
    case "branch": {
      const condition = readValue(context, terminator.condition);
      if (!hasRuntimeValue(condition) || typeof condition.value !== "boolean") {
        return { kind: "trap", reason: `invalid-branch-condition:${terminator.condition}` };
      }
      const edge = context.edges.get(condition.value ? terminator.trueEdge : terminator.falseEdge);
      if (edge?.toBlock === undefined) {
        return { kind: "trap", reason: "missing-branch-edge" };
      }
      return { kind: "next", nextBlock: edge.toBlock };
    }
    case "jump": {
      const edge = context.edges.get(terminator.edge);
      if (edge?.toBlock === undefined) {
        return { kind: "trap", reason: "missing-jump-edge" };
      }
      return { kind: "next", nextBlock: edge.toBlock };
    }
    case "switch":
    case "unreachable":
      return { kind: "trap", reason: `unsupported-terminator:${terminator.kind}` };
  }
  return { kind: "trap", reason: "unknown-terminator" };
}

function interpretOperation(
  operation: OptIrOperation,
  context: Context,
): { readonly kind: "ok" } | OptIrTrap {
  switch (ruleKey(operation.semantics.interpreterRule)) {
    case "constant-literal":
      return assign(operation, context, constantValue(operation));
    case "integer-binary":
      return integerBinary(operation, context);
    case "integer-compare":
      return integerCompare(operation, context);
    case "memory-load":
      return memoryLoad(operation, context);
    case "memory-store":
      return memoryStore(operation, context);
    default:
      return {
        kind: "trap",
        reason: `unsupported-interpreter-rule:${operation.semantics.interpreterRule}`,
      };
  }
}

function constantValue(operation: OptIrOperation): OptIrRuntimeValue {
  if (!("constant" in operation)) {
    throw new RangeError("Interpreter rule constant-literal requires a constant payload.");
  }
  return { type: operation.constant.type, value: operation.constant.normalizedValue };
}

function integerBinary(
  operation: OptIrOperation,
  context: Context,
): { readonly kind: "ok" } | OptIrTrap {
  if (!("left" in operation) || !("right" in operation) || !("operator" in operation)) {
    return { kind: "trap", reason: "invalid-integer-binary-payload" };
  }
  const left = readInteger(context, operation.left);
  const right = readInteger(context, operation.right);
  if (left === undefined || right === undefined) {
    return { kind: "trap", reason: "invalid-integer-binary-operands" };
  }
  const raw = integerBinaryRawValue(operation.operator, left.value, right.value);
  if (raw === undefined) {
    return { kind: "trap", reason: `unsupported-integer-binary:${operation.operator}` };
  }
  const width = integerWidth(operation.resultTypes[0]);
  const modulus = 1n << BigInt(width);
  if (context.overflowMode === "trap" && (raw < 0n || raw >= modulus)) {
    return { kind: "trap", reason: `integer-overflow:${operation.operator}:u${width}` };
  }
  return assign(operation, context, {
    type: operation.resultTypes[0]!,
    value: modulo(raw, modulus),
  });
}

function integerBinaryRawValue(operator: unknown, left: bigint, right: bigint): bigint | undefined {
  switch (operator) {
    case "add":
      return left + right;
    case "multiply":
      return left * right;
    default:
      return undefined;
  }
}

function integerCompare(
  operation: OptIrOperation,
  context: Context,
): { readonly kind: "ok" } | OptIrTrap {
  if (!("left" in operation) || !("right" in operation) || !("operator" in operation)) {
    return { kind: "trap", reason: "invalid-integer-compare-payload" };
  }
  const left = readInteger(context, operation.left);
  const right = readInteger(context, operation.right);
  if (left === undefined || right === undefined) {
    return { kind: "trap", reason: "invalid-integer-compare-operands" };
  }
  const value =
    operation.operator === "unsignedLessThan"
      ? left.value < right.value
      : operation.operator === "equal"
        ? left.value === right.value
        : operation.operator === "notEqual"
          ? left.value !== right.value
          : false;
  return assign(operation, context, { type: operation.resultTypes[0]!, value });
}

function memoryLoad(
  operation: OptIrOperation,
  context: Context,
): { readonly kind: "ok" } | OptIrTrap {
  if (!("memoryAccess" in operation)) {
    return { kind: "trap", reason: "invalid-memory-load-payload" };
  }
  if (context.memory === undefined) {
    return { kind: "trap", reason: "missing-memory-surface" };
  }
  const loaded = context.memory.load(operation.memoryAccess);
  if (loaded.kind === "trap") {
    return loaded;
  }
  recordMemory(context, "read", operation.operationId, operation.memoryAccess);
  return assign(operation, context, loaded.value);
}

function memoryStore(
  operation: OptIrOperation,
  context: Context,
): { readonly kind: "ok" } | OptIrTrap {
  if (!("memoryAccess" in operation) || !("storeValue" in operation)) {
    return { kind: "trap", reason: "invalid-memory-store-payload" };
  }
  if (context.memory === undefined) {
    return { kind: "trap", reason: "missing-memory-surface" };
  }
  const value = readValue(context, operation.storeValue);
  if (value === undefined) {
    return { kind: "trap", reason: `missing-store-value:${operation.storeValue}` };
  }
  const stored = context.memory.store(operation.memoryAccess, value);
  if (stored.kind === "trap") {
    return stored;
  }
  recordMemory(context, "write", operation.operationId, operation.memoryAccess);
  return { kind: "ok" };
}

function assign(
  operation: OptIrOperation,
  context: Context,
  value: OptIrRuntimeValue,
): { readonly kind: "ok" } {
  const resultId = operation.resultIds[0];
  if (resultId !== undefined) {
    context.values.set(resultId, value);
  }
  return { kind: "ok" };
}

function readValues(
  context: Context,
  ids: readonly OptIrValueId[],
): { readonly kind: "ok"; readonly values: readonly OptIrRuntimeValue[] } | OptIrTrap {
  const values: OptIrRuntimeValue[] = [];
  for (const id of ids) {
    const value = readValue(context, id);
    if (value === undefined) {
      return { kind: "trap", reason: `missing-return-value:${id}` };
    }
    values.push(value);
  }
  return { kind: "ok", values };
}

function readValue(context: Context, id: OptIrValueId): OptIrRuntimeValue | undefined {
  return context.values.get(id);
}

function readInteger(
  context: Context,
  id: OptIrValueId,
): { readonly type: OptIrType; readonly value: bigint } | undefined {
  const value = readValue(context, id);
  return hasRuntimeValue(value) && typeof value.value === "bigint" ? value : undefined;
}

function hasRuntimeValue(
  value: OptIrRuntimeValue | undefined,
): value is { readonly type: OptIrType; readonly value: bigint | boolean } {
  return value !== undefined && "value" in value;
}

function integerWidth(type: OptIrType | undefined): number {
  if (type?.kind !== "integer") {
    throw new RangeError("Integer operation result must have an integer type.");
  }
  return type.width;
}

function modulo(value: bigint, modulus: bigint): bigint {
  return ((value % modulus) + modulus) % modulus;
}

function recordMemory(
  context: Context,
  kind: "read" | "write",
  operationId: OptIrOperationId,
  access: OptIrMemoryAccessDescriptor,
): void {
  context.effects?.record({
    kind,
    operationId,
    region: Number(access.region),
    byteOffset: access.byteOffset,
    byteWidth: access.byteWidth,
  });
}

function observations(context: Context): OptIrInterpreterObservations {
  return {
    memory: context.memory?.snapshot() ?? [],
    effects: context.effects?.snapshot() ?? [],
  };
}

function ruleKey(rule: OptIrInterpreterRuleId): string {
  return rule as string;
}

function trapped(reason: string): OptIrInterpreterResult {
  return { kind: "trapped", reason };
}
