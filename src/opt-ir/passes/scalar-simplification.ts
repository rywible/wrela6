import { optIrCfgEdgeTable } from "../cfg";
import { optIrIntegerConstant } from "../constants";
import {
  createOptIrSubjectRemapTable,
  type OptIrFactSubject,
  type OptIrSubjectRemapTable,
} from "../facts/subject-remapping";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrOperationId,
  optIrValueId,
  type OptIrEdgeId,
  type OptIrOperationId,
  type OptIrValueId,
} from "../ids";
import {
  optIrConstantOperation,
  type OptIrBooleanBinaryOperator,
  type OptIrBoundsAuthority,
  type OptIrIntegerBinaryOperator,
  type OptIrIntegerCompareOperator,
  type OptIrIntegerUnaryOperator,
  type OptIrOperation,
} from "../operations";
import type { OptIrFunction } from "../program";
import { optIrBooleanType, type OptIrIntegerType, type OptIrType } from "../types";
import { runCfgSimplification } from "./cfg-simplification";

export interface OptIrCompareFact {
  readonly left: OptIrValueId;
  readonly operator: OptIrIntegerCompareOperator | OptIrBooleanBinaryOperator;
  readonly right: OptIrValueId;
  readonly result: boolean;
}

export interface RemovableBoundsCheck {
  readonly checkOperationId: OptIrOperationId;
  readonly affectedAccessOperationIds: readonly OptIrOperationId[];
  readonly replacementAuthority?: OptIrBoundsAuthority;
}

export interface ScalarSimplificationInput {
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly compareFacts?: readonly OptIrCompareFact[];
  readonly removableBoundsChecks?: readonly RemovableBoundsCheck[];
  readonly fuel?: number;
}

export interface ScalarSimplificationRewriteRecord {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly replacement: { readonly kind: "constant"; readonly normalizedValue: bigint };
  readonly invariant:
    | { readonly kind: "pureAlgebraicEquivalence" }
    | { readonly kind: "factBackedCompareEquivalence" };
}

export interface RejectedBoundsCheck {
  readonly checkOperationId: OptIrOperationId;
  readonly reason:
    | "missingReplacementAuthority"
    | "missingCheckOperation"
    | "notRuntimeBoundsCheck"
    | "missingAffectedAccess";
}

export interface ScalarSimplificationResult {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly rewriteRecords: readonly ScalarSimplificationRewriteRecord[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly removedEdgeIds: readonly OptIrEdgeId[];
  readonly rejectedBoundsChecks: readonly RejectedBoundsCheck[];
  readonly subjectRemap: OptIrSubjectRemapTable;
}

export function runScalarSimplification(
  input: ScalarSimplificationInput,
): ScalarSimplificationResult {
  const fuel = Math.max(0, Math.floor(input.fuel ?? 4));
  if (fuel === 0) {
    return Object.freeze({
      function: input.function,
      operations: Object.freeze(operationsInFunctionOrder(input.function, input.operations)),
      rewriteRecords: Object.freeze([]),
      removedOperationIds: Object.freeze([]),
      removedEdgeIds: Object.freeze([]),
      rejectedBoundsChecks: Object.freeze([]),
      subjectRemap: createOptIrSubjectRemapTable({}),
    });
  }

  let functionOutput = input.function;
  let operationsOutput = operationsInFunctionOrder(input.function, input.operations);
  const rewriteRecords: ScalarSimplificationRewriteRecord[] = [];
  const removedOperationIds: OptIrOperationId[] = [];
  const removedEdgeIds: OptIrEdgeId[] = [];
  const rejectedBoundsChecks: RejectedBoundsCheck[] = [];
  const subjectRemaps = emptySubjectRemapAccumulator();

  for (let round = 0; round < fuel; round += 1) {
    const state = scalarRound(functionOutput, operationsOutput, {
      compareFacts: input.compareFacts ?? [],
      removableBoundsChecks: round === 0 ? (input.removableBoundsChecks ?? []) : [],
    });
    rewriteRecords.push(...state.rewriteRecords);
    removedOperationIds.push(...state.removedOperationIds);
    removedEdgeIds.push(...state.removedEdgeIds);
    rejectedBoundsChecks.push(...state.rejectedBoundsChecks);
    accumulateSubjectRemap(subjectRemaps, state.subjectRemap);

    const changed = scalarRoundChanged(state);
    functionOutput = state.function;
    operationsOutput = state.operations;
    if (!changed) {
      break;
    }
  }

  return Object.freeze({
    function: functionOutput,
    operations: Object.freeze(operationsOutput),
    rewriteRecords: Object.freeze(rewriteRecords),
    removedOperationIds: Object.freeze(sortedUnique(removedOperationIds)),
    removedEdgeIds: Object.freeze(sortedUnique(removedEdgeIds)),
    rejectedBoundsChecks: Object.freeze(rejectedBoundsChecks),
    subjectRemap: createOptIrSubjectRemapTable(subjectRemaps),
  });
}

function scalarRound(
  functionInput: OptIrFunction,
  operationsInput: readonly OptIrOperation[],
  context: {
    readonly compareFacts: readonly OptIrCompareFact[];
    readonly removableBoundsChecks: readonly RemovableBoundsCheck[];
  },
): ScalarSimplificationResult {
  const operationConstants = constantValues(operationsInput);
  const rewriteRecords: ScalarSimplificationRewriteRecord[] = [];
  const foldedOperations = operationsInput.map((operation) => {
    const folded = foldOperation(operation, operationConstants, context.compareFacts);
    if (folded === undefined) {
      return operation;
    }
    rewriteRecords.push(folded.record);
    return folded.operation;
  });

  const boundsResult = removeBoundsChecks(
    functionInput,
    foldedOperations,
    context.removableBoundsChecks,
  );
  const foldedOperationTable = operationTable(boundsResult.operations);
  const booleanFacts = booleanConstantsByValue(boundsResult.operations);
  const switchFacts = switchConstantsByValue(boundsResult.operations);
  const cfgResult = runCfgSimplification({
    function: boundsResult.function,
    operations: foldedOperationTable,
    booleanFacts: [...booleanFacts.entries()].sort(compareValuePairs),
    switchFacts: [...switchFacts.entries()].sort(compareValueStringPairs),
    fuel: 4,
  });

  return {
    function: cfgResult.function,
    operations: cfgResult.operations,
    rewriteRecords,
    removedOperationIds: boundsResult.removedOperationIds,
    removedEdgeIds: cfgResult.removedEdgeIds,
    rejectedBoundsChecks: boundsResult.rejectedBoundsChecks,
    subjectRemap: mergeSubjectRemaps(
      createOptIrSubjectRemapTable({
        droppedSubjects: boundsResult.removedOperationIds.map((operationId) => ({
          kind: "operation" as const,
          operationId,
        })),
      }),
      cfgResult.subjectRemap,
    ),
  };
}

function scalarRoundChanged(result: ScalarSimplificationResult): boolean {
  return (
    result.rewriteRecords.length > 0 ||
    result.removedOperationIds.length > 0 ||
    result.removedEdgeIds.length > 0 ||
    result.subjectRemap.entries.length > 0 ||
    result.subjectRemap.droppedSubjectKeys.length > 0
  );
}

interface SubjectRemapAccumulator {
  readonly values: (readonly [OptIrValueId, OptIrValueId])[];
  readonly operations: (readonly [OptIrOperationId, OptIrOperationId])[];
  readonly blocks: (readonly [ReturnType<typeof optIrBlockId>, ReturnType<typeof optIrBlockId>])[];
  readonly edges: (readonly [OptIrEdgeId, OptIrEdgeId])[];
  readonly droppedSubjects: OptIrFactSubject[];
}

function emptySubjectRemapAccumulator(): SubjectRemapAccumulator {
  return {
    values: [],
    operations: [],
    blocks: [],
    edges: [],
    droppedSubjects: [],
  };
}

function mergeSubjectRemaps(
  left: OptIrSubjectRemapTable,
  right: OptIrSubjectRemapTable,
): OptIrSubjectRemapTable {
  const accumulator = emptySubjectRemapAccumulator();
  accumulateSubjectRemap(accumulator, left);
  accumulateSubjectRemap(accumulator, right);
  return createOptIrSubjectRemapTable(accumulator);
}

function accumulateSubjectRemap(
  accumulator: SubjectRemapAccumulator,
  table: OptIrSubjectRemapTable,
): void {
  for (const entry of table.entries) {
    switch (entry.source.kind) {
      case "value":
        if (entry.target.kind === "value") {
          accumulator.values.push([entry.source.valueId, entry.target.valueId]);
        }
        break;
      case "operation":
        if (entry.target.kind === "operation") {
          accumulator.operations.push([entry.source.operationId, entry.target.operationId]);
        }
        break;
      case "block":
        if (entry.target.kind === "block") {
          accumulator.blocks.push([entry.source.blockId, entry.target.blockId]);
        }
        break;
      case "edge":
        if (entry.target.kind === "edge") {
          accumulator.edges.push([entry.source.edgeId, entry.target.edgeId]);
        }
        break;
      case "region":
      case "fact":
        break;
    }
  }
  accumulator.droppedSubjects.push(...table.droppedSubjectKeys.map(parseDroppedSubjectKey));
}

function sortedUnique<Identifier extends number>(
  identifiers: readonly Identifier[],
): readonly Identifier[] {
  return [...new Set(identifiers)].sort(compareNumbers);
}

function foldOperation(
  operation: OptIrOperation,
  constants: ReadonlyMap<OptIrValueId, bigint>,
  compareFacts: readonly OptIrCompareFact[],
):
  | {
      readonly operation: OptIrOperation;
      readonly record: ScalarSimplificationRewriteRecord;
    }
  | undefined {
  const resultId = operation.resultIds[0];
  if (resultId === undefined || operation.kind === "constant") {
    return undefined;
  }

  const folded = foldedValue(operation, constants, compareFacts);
  if (folded === undefined) {
    return undefined;
  }

  return {
    operation: optIrConstantOperation({
      operationId: operation.operationId,
      resultId,
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(Number(operation.operationId)),
        type: folded.type,
        normalizedValue: folded.value,
        dataModel:
          folded.type.kind === "integer" ? { pointerWidth: 64, endian: "little" } : undefined,
      }),
      originId: operation.originId,
      displayName: operation.displayName,
    }),
    record: {
      operationId: operation.operationId,
      resultId,
      replacement: { kind: "constant", normalizedValue: folded.value },
      invariant: {
        kind:
          folded.source === "fact" ? "factBackedCompareEquivalence" : "pureAlgebraicEquivalence",
      },
    },
  };
}

function foldedValue(
  operation: OptIrOperation,
  constants: ReadonlyMap<OptIrValueId, bigint>,
  compareFacts: readonly OptIrCompareFact[],
):
  | { readonly value: bigint; readonly type: OptIrType; readonly source: "semantic" | "fact" }
  | undefined {
  switch (operation.kind) {
    case "integerUnary": {
      const operand = constants.get(operation.operand);
      if (operand === undefined) {
        return undefined;
      }
      return foldIntegerUnary(operation.operator, operand, operation.resultTypes[0]);
    }
    case "integerBinary": {
      const left = constants.get(operation.left);
      const right = constants.get(operation.right);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return foldIntegerBinary(operation.operator, left, right, operation.resultTypes[0]);
    }
    case "integerCompare": {
      const fact = matchingCompareFact(
        compareFacts,
        operation.left,
        operation.operator,
        operation.right,
      );
      if (fact !== undefined) {
        return { value: fact ? 1n : 0n, type: optIrBooleanType(), source: "fact" };
      }
      const left = constants.get(operation.left);
      const right = constants.get(operation.right);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return {
        value: evaluateIntegerCompare(operation.operator, left, right) ? 1n : 0n,
        type: optIrBooleanType(),
        source: "semantic",
      };
    }
    case "booleanNot": {
      const operand = constants.get(operation.operand);
      if (operand === undefined || !isBooleanConstant(operand)) {
        return undefined;
      }
      return { value: operand === 0n ? 1n : 0n, type: optIrBooleanType(), source: "semantic" };
    }
    case "booleanBinary": {
      const fact = matchingCompareFact(
        compareFacts,
        operation.left,
        operation.operator,
        operation.right,
      );
      if (fact !== undefined) {
        return { value: fact ? 1n : 0n, type: optIrBooleanType(), source: "fact" };
      }
      const left = constants.get(operation.left);
      const right = constants.get(operation.right);
      if (
        left === undefined ||
        right === undefined ||
        !isBooleanConstant(left) ||
        !isBooleanConstant(right)
      ) {
        return undefined;
      }
      return {
        value: evaluateBooleanBinary(operation.operator, left === 1n, right === 1n) ? 1n : 0n,
        type: optIrBooleanType(),
        source: "semantic",
      };
    }
    default:
      return undefined;
  }
}

function foldIntegerUnary(
  operator: OptIrIntegerUnaryOperator,
  operand: bigint,
  resultType: OptIrType | undefined,
): { readonly value: bigint; readonly type: OptIrType; readonly source: "semantic" } | undefined {
  if (resultType?.kind !== "integer") {
    return undefined;
  }
  const value = operator === "negate" ? -operand : ~operand;
  return integerResult(value, resultType);
}

function foldIntegerBinary(
  operator: OptIrIntegerBinaryOperator,
  left: bigint,
  right: bigint,
  resultType: OptIrType | undefined,
): { readonly value: bigint; readonly type: OptIrType; readonly source: "semantic" } | undefined {
  if (resultType?.kind !== "integer") {
    return undefined;
  }
  if ((operator === "signedDivide" || operator === "unsignedDivide") && right === 0n) {
    return undefined;
  }
  if ((operator === "shiftLeft" || operator === "shiftRight") && right < 0n) {
    return undefined;
  }
  const value = evaluateIntegerBinary(operator, left, right);
  return value === undefined ? undefined : integerResult(value, resultType);
}

function integerResult(
  value: bigint,
  type: OptIrIntegerType,
): { readonly value: bigint; readonly type: OptIrType; readonly source: "semantic" } | undefined {
  if (!fitsIntegerType(value, type)) {
    return undefined;
  }
  return { value, type, source: "semantic" };
}

function evaluateIntegerBinary(
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
    case "signedDivide":
    case "unsignedDivide":
      return left / right;
    case "and":
      return left & right;
    case "or":
      return left | right;
    case "xor":
      return left ^ right;
    case "shiftLeft":
      return left << right;
    case "shiftRight":
      return left >> right;
  }
}

function evaluateIntegerCompare(
  operator: OptIrIntegerCompareOperator,
  left: bigint,
  right: bigint,
): boolean {
  switch (operator) {
    case "equal":
      return left === right;
    case "notEqual":
      return left !== right;
    case "signedLessThan":
    case "unsignedLessThan":
      return left < right;
    case "signedLessThanOrEqual":
    case "unsignedLessThanOrEqual":
      return left <= right;
  }
}

function evaluateBooleanBinary(
  operator: OptIrBooleanBinaryOperator,
  left: boolean,
  right: boolean,
): boolean {
  switch (operator) {
    case "and":
      return left && right;
    case "or":
      return left || right;
    case "xor":
      return left !== right;
    case "equal":
      return left === right;
    case "notEqual":
      return left !== right;
  }
}

function matchingCompareFact(
  facts: readonly OptIrCompareFact[],
  left: OptIrValueId,
  operator: OptIrCompareFact["operator"],
  right: OptIrValueId,
): boolean | undefined {
  const fact = facts.find(
    (candidate) =>
      candidate.left === left && candidate.operator === operator && candidate.right === right,
  );
  return fact?.result;
}

function removeBoundsChecks(
  functionInput: OptIrFunction,
  operationsInput: readonly OptIrOperation[],
  checks: readonly RemovableBoundsCheck[],
): {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly rejectedBoundsChecks: readonly RejectedBoundsCheck[];
} {
  const operations = new Map(
    operationsInput.map((operation) => [operation.operationId, operation]),
  );
  const removedOperationIds: OptIrOperationId[] = [];
  const rejectedBoundsChecks: RejectedBoundsCheck[] = [];
  const accessAuthorities = new Map<OptIrOperationId, OptIrBoundsAuthority>();

  for (const check of [...checks].sort(
    (left, right) => left.checkOperationId - right.checkOperationId,
  )) {
    const checkOperation = operations.get(check.checkOperationId);
    if (checkOperation === undefined) {
      rejectedBoundsChecks.push({
        checkOperationId: check.checkOperationId,
        reason: "missingCheckOperation",
      });
      continue;
    }
    if (!isRuntimeBoundsCheck(checkOperation)) {
      rejectedBoundsChecks.push({
        checkOperationId: check.checkOperationId,
        reason: "notRuntimeBoundsCheck",
      });
      continue;
    }
    if (check.replacementAuthority === undefined) {
      rejectedBoundsChecks.push({
        checkOperationId: check.checkOperationId,
        reason: "missingReplacementAuthority",
      });
      continue;
    }
    const affectedAccesses = check.affectedAccessOperationIds.map((operationId) =>
      operations.get(operationId),
    );
    if (
      affectedAccesses.some((operation) => operation === undefined || !hasMemoryAccess(operation))
    ) {
      rejectedBoundsChecks.push({
        checkOperationId: check.checkOperationId,
        reason: "missingAffectedAccess",
      });
      continue;
    }
    removedOperationIds.push(check.checkOperationId);
    for (const operationId of check.affectedAccessOperationIds) {
      accessAuthorities.set(operationId, check.replacementAuthority);
    }
  }

  const removed = new Set(removedOperationIds);
  const rewrittenOperations = operationsInput
    .filter((operation) => !removed.has(operation.operationId))
    .map((operation) =>
      rewriteBoundsAuthority(operation, accessAuthorities.get(operation.operationId)),
    );
  const functionOutput: OptIrFunction = {
    ...functionInput,
    blocks: functionInput.blocks.map((block) => ({
      ...block,
      operations: block.operations.filter((operationId) => !removed.has(operationId)),
    })),
    edges: optIrCfgEdgeTable(functionInput.edges.entries()),
  };

  return {
    function: functionOutput,
    operations: rewrittenOperations,
    removedOperationIds: removedOperationIds.sort(compareNumbers),
    rejectedBoundsChecks,
  };
}

function rewriteBoundsAuthority(
  operation: OptIrOperation,
  authority: OptIrBoundsAuthority | undefined,
): OptIrOperation {
  if (authority === undefined || !hasMemoryAccess(operation)) {
    return operation;
  }
  return {
    ...operation,
    memoryAccess: {
      ...operation.memoryAccess,
      boundsAuthority: authority,
    },
  };
}

function hasMemoryAccess(
  operation: OptIrOperation | undefined,
): operation is Extract<OptIrOperation, { readonly memoryAccess: object }> {
  return operation !== undefined && "memoryAccess" in operation;
}

function isRuntimeBoundsCheck(operation: OptIrOperation): boolean {
  return (
    operation.kind === "runtimeCall" &&
    operation.target.kind === "runtime" &&
    operation.target.runtimeKey === "runtime.bounds_check"
  );
}

function constantValues(operations: readonly OptIrOperation[]): ReadonlyMap<OptIrValueId, bigint> {
  const constants = new Map<OptIrValueId, bigint>();
  for (const operation of operations) {
    if (operation.kind === "constant") {
      const resultId = operation.resultIds[0];
      if (resultId !== undefined) {
        constants.set(resultId, operation.constant.normalizedValue);
      }
    }
  }
  return constants;
}

function booleanConstantsByValue(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrValueId, boolean> {
  const constants = new Map<OptIrValueId, boolean>();
  for (const operation of operations) {
    if (operation.kind !== "constant" || !isBooleanType(operation.constant.type)) {
      continue;
    }
    const resultId = operation.resultIds[0];
    if (resultId !== undefined && isBooleanConstant(operation.constant.normalizedValue)) {
      constants.set(resultId, operation.constant.normalizedValue === 1n);
    }
  }
  return constants;
}

function switchConstantsByValue(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrValueId, string> {
  const constants = new Map<OptIrValueId, string>();
  for (const operation of operations) {
    if (operation.kind !== "constant") {
      continue;
    }
    const resultId = operation.resultIds[0];
    if (resultId !== undefined) {
      constants.set(resultId, operation.constant.normalizedValue.toString());
    }
  }
  return constants;
}

function isBooleanType(type: OptIrType): boolean {
  return type.kind === "boolean";
}

function isBooleanConstant(value: bigint): boolean {
  return value === 0n || value === 1n;
}

function fitsIntegerType(value: bigint, type: OptIrIntegerType): boolean {
  const width = BigInt(type.width);
  if (type.signedness === "unsigned") {
    return value >= 0n && value < 1n << width;
  }
  const lower = -(1n << (width - 1n));
  const upper = 1n << (width - 1n);
  return value >= lower && value < upper;
}

function operationsInFunctionOrder(
  functionInput: OptIrFunction,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): readonly OptIrOperation[] {
  return functionInput.blocks
    .flatMap((block) => block.operations)
    .map((operationId) => requireOperation(operations, operationId));
}

function operationTable(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

function requireOperation(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  operationId: OptIrOperationId,
): OptIrOperation {
  const operation = operations.get(operationId);
  if (operation === undefined) {
    throw new RangeError(`Missing OptIR operation ${operationId}.`);
  }
  return operation;
}

function parseDroppedSubjectKey(key: string) {
  const [kind, rawId] = key.split(":");
  const id = Number(rawId);
  switch (kind) {
    case "operation":
      return { kind, operationId: optIrOperationId(id) };
    case "edge":
      return { kind, edgeId: optIrEdgeId(id) };
    case "block":
      return { kind, blockId: optIrBlockId(id) };
    case "value":
      return { kind, valueId: optIrValueId(id) };
    default:
      throw new RangeError(`Unknown dropped subject key ${key}.`);
  }
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function compareValuePairs(
  left: readonly [OptIrValueId, boolean],
  right: readonly [OptIrValueId, boolean],
): number {
  return left[0] - right[0];
}

function compareValueStringPairs(
  left: readonly [OptIrValueId, string],
  right: readonly [OptIrValueId, string],
): number {
  return left[0] - right[0];
}
