import { monoInstanceId } from "../../../src/mono/ids";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrConstantId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
  type OptIrBlockId,
  type OptIrEdgeId,
  type OptIrOperationId,
  type OptIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import type { OptIrCfgEdit } from "../../../src/opt-ir/cfg-edits";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrMemoryLoadOperation,
} from "../../../src/opt-ir/operations";
import type { OptIrTerminator } from "../../../src/opt-ir/terminators";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import { targetIdForTest } from "./cfg-fakes";
import {
  verifyOptIrProgram,
  type VerifyOptIrProgramInput,
} from "../../../src/opt-ir/verify/structural-verifier";

const U32 = optIrUnsignedIntegerType(32);
const EMPTY_MONO_SIGNATURE_FOR_TEST = {} as unknown as MonoFunctionSignature;

export function verifierOperationTableForTest(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

export function optIrVerifierInputForTest(
  input: {
    readonly program?: OptIrProgram;
    readonly operations?: readonly OptIrOperation[];
    readonly cfgEdits?: readonly OptIrCfgEdit[];
    readonly oldEdges?: readonly OptIrEdgeId[];
    readonly newEdges?: readonly OptIrEdgeId[];
    readonly oldBlocks?: readonly OptIrBlockId[];
    readonly newBlocks?: readonly OptIrBlockId[];
  } = {},
): VerifyOptIrProgramInput {
  return {
    program: input.program ?? validVerifierProgramForTest().program,
    operations: verifierOperationTableForTest(
      input.operations ?? validVerifierProgramForTest().operations,
    ),
    cfgEdits: input.cfgEdits ?? [],
    oldCfg: {
      edges: new Set(input.oldEdges ?? []),
      blocks: new Set(input.oldBlocks ?? []),
    },
    newCfg: {
      edges: new Set(input.newEdges ?? []),
      blocks: new Set(input.newBlocks ?? []),
    },
    options: { checkDominance: true, recomputeOperationMetadata: true },
  };
}

export function verifyOptIrProgramForTest(input: VerifyOptIrProgramInput) {
  return verifyOptIrProgram(input);
}

export function validVerifierProgramForTest(): {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
} {
  const parameter = optIrBlockParameter({
    valueId: optIrValueId(1),
    type: U32,
    incomingRole: "entry",
    originId: optIrOriginId(1),
  });
  const constant = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(2),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: U32,
      normalizedValue: 3n,
    }),
    originId: optIrOriginId(1),
  });
  const add = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(3),
    left: parameter.valueId,
    right: optIrValueId(2),
    operator: "add",
    resultType: U32,
    originId: optIrOriginId(1),
  });
  const block = blockForTest({
    blockId: optIrBlockId(1),
    parameters: [parameter],
    operations: [constant.operationId, add.operationId],
  });
  const func = functionForTest({ blocks: [block], entryBlock: block.blockId });

  return {
    operations: [constant, add],
    program: programForFunctionForTest(func),
  };
}

export function optIrProgramWithDuplicateValueDefinitionForTest(valueId: OptIrValueId) {
  const first = constantForTest({ operationId: optIrOperationId(1), resultId: valueId });
  const second = constantForTest({ operationId: optIrOperationId(2), resultId: valueId });
  const block = blockForTest({ operations: [first.operationId, second.operationId] });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(
      functionForTest({ blocks: [block], entryBlock: block.blockId }),
    ),
    operations: [first, second],
  });
}

export function optIrProgramWithBlockArgumentMismatchForTest() {
  const sourceValue = constantForTest({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(1),
  });
  const predecessor = blockForTest({
    blockId: optIrBlockId(1),
    operations: [sourceValue.operationId],
  });
  const successor = blockForTest({
    blockId: optIrBlockId(2),
    parameters: [
      optIrBlockParameter({
        valueId: optIrValueId(2),
        type: U32,
        incomingRole: "branchArgument",
        originId: optIrOriginId(1),
      }),
      optIrBlockParameter({
        valueId: optIrValueId(3),
        type: U32,
        incomingRole: "branchArgument",
        originId: optIrOriginId(1),
      }),
    ],
  });
  const edge = edgeForTest({
    edgeId: optIrEdgeId(1),
    from: predecessor.blockId,
    toBlock: successor.blockId,
    arguments: [sourceValue.resultIds[0] ?? optIrValueId(1)],
  });
  const func = functionForTest({
    blocks: [predecessor, successor],
    edges: optIrCfgEdgeTable([edge]),
    entryBlock: predecessor.blockId,
  });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(func),
    operations: [sourceValue],
  });
}

export function optIrProgramWithDominanceViolationForTest() {
  const useBeforeDefinition = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(3),
    left: optIrValueId(2),
    right: optIrValueId(2),
    operator: "add",
    resultType: U32,
    originId: optIrOriginId(1),
  });
  const definition = constantForTest({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(2),
  });
  const block = blockForTest({
    operations: [useBeforeDefinition.operationId, definition.operationId],
  });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(
      functionForTest({ blocks: [block], entryBlock: block.blockId }),
    ),
    operations: [useBeforeDefinition, definition],
  });
}

export function optIrProgramWithMissingReturnValueDefinitionForTest() {
  const block = blockForTest({
    terminator: {
      kind: "return",
      operationId: optIrOperationId(10),
      values: [optIrValueId(404)],
      originId: optIrOriginId(1),
    },
  });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(
      functionForTest({ blocks: [block], entryBlock: block.blockId }),
    ),
    operations: [],
  });
}

export function optIrProgramWithSiblingBranchDominanceViolationForTest() {
  const condition = optIrBlockParameter({
    valueId: optIrValueId(1),
    type: optIrBooleanTypeForTest(),
    incomingRole: "entry",
    originId: optIrOriginId(1),
  });
  const siblingValue = constantForTest({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(2),
  });
  const useFromSibling = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(3),
    left: optIrValueId(2),
    right: optIrValueId(2),
    operator: "add",
    resultType: U32,
    originId: optIrOriginId(1),
  });
  const entry = blockForTest({
    blockId: optIrBlockId(1),
    parameters: [condition],
    terminator: branchTerminator(condition.valueId, optIrEdgeId(1), optIrEdgeId(2)),
  });
  const left = blockForTest({
    blockId: optIrBlockId(2),
    operations: [siblingValue.operationId],
  });
  const right = blockForTest({
    blockId: optIrBlockId(3),
    operations: [useFromSibling.operationId],
  });
  const func = functionForTest({
    blocks: [entry, left, right],
    edges: optIrCfgEdgeTable([
      edgeForTest({
        edgeId: optIrEdgeId(1),
        from: entry.blockId,
        toBlock: left.blockId,
        kind: "branchTrue",
      }),
      edgeForTest({
        edgeId: optIrEdgeId(2),
        from: entry.blockId,
        toBlock: right.blockId,
        kind: "branchFalse",
      }),
    ]),
    entryBlock: entry.blockId,
  });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(func),
    operations: [siblingValue, useFromSibling],
  });
}

export function optIrProgramWithLaterDominatingDefinitionForTest() {
  const dominatingValue = constantForTest({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(2),
  });
  const useAfterJump = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(3),
    left: optIrValueId(2),
    right: optIrValueId(2),
    operator: "add",
    resultType: U32,
    originId: optIrOriginId(1),
  });
  const entry = blockForTest({
    blockId: optIrBlockId(1),
    operations: [dominatingValue.operationId],
    terminator: jumpTerminator(optIrEdgeId(1)),
  });
  const successor = blockForTest({
    blockId: optIrBlockId(2),
    operations: [useAfterJump.operationId],
  });
  const func = functionForTest({
    blocks: [successor, entry],
    edges: optIrCfgEdgeTable([
      edgeForTest({ edgeId: optIrEdgeId(1), from: entry.blockId, toBlock: successor.blockId }),
    ]),
    entryBlock: entry.blockId,
  });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(func),
    operations: [dominatingValue, useAfterJump],
  });
}

export function optIrProgramWithMetadataMismatchForTest() {
  const operation = {
    ...constantForTest({ operationId: optIrOperationId(1), resultId: optIrValueId(1) }),
    effects: {
      ...constantForTest({ operationId: optIrOperationId(9), resultId: optIrValueId(9) }).effects,
      isRuntimePure: false,
    },
  } as OptIrOperation;
  const block = blockForTest({ operations: [operation.operationId] });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(
      functionForTest({ blocks: [block], entryBlock: block.blockId }),
    ),
    operations: [operation],
  });
}

export function optIrProgramWithMissingRegionTokenForTest() {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(1),
    region: optIrRegionId(99),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: U32,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "test" },
    originId: optIrOriginId(1),
  });
  if (result.kind === "error") {
    throw new Error("test memory operation should be constructible");
  }
  const block = blockForTest({ operations: [result.operation.operationId] });
  return optIrVerifierInputForTest({
    program: programForFunctionForTest(
      functionForTest({ blocks: [block], entryBlock: block.blockId }),
    ),
    operations: [result.operation],
  });
}

export function cfgEditWithMissingReferencesForTest() {
  return optIrVerifierInputForTest({
    cfgEdits: [
      {
        kind: "branchFold",
        oldTerminator: optIrOperationId(500),
        survivingEdge: optIrEdgeId(10),
        removedEdges: [optIrEdgeId(11)],
      },
    ],
    oldEdges: [optIrEdgeId(11)],
    newEdges: [],
  });
}

function constantForTest(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
}): OptIrOperation {
  return optIrConstantOperation({
    ...input,
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: U32,
      normalizedValue: 1n,
    }),
    originId: optIrOriginId(1),
  });
}

function blockForTest(input: Partial<OptIrBlock> = {}): OptIrBlock {
  return {
    blockId: input.blockId ?? optIrBlockId(1),
    parameters: input.parameters ?? [],
    operations: input.operations ?? [],
    terminator: input.terminator,
    originId: input.originId ?? optIrOriginId(1),
  };
}

function branchTerminator(
  condition: OptIrValueId,
  trueEdge: OptIrEdgeId,
  falseEdge: OptIrEdgeId,
): OptIrTerminator {
  return {
    kind: "branch",
    operationId: optIrOperationId(1_000),
    condition,
    trueEdge,
    falseEdge,
    originId: optIrOriginId(1),
  };
}

function jumpTerminator(edge: OptIrEdgeId): OptIrTerminator {
  return {
    kind: "jump",
    operationId: optIrOperationId(1_001),
    edge,
    originId: optIrOriginId(1),
  };
}

function optIrBooleanTypeForTest() {
  return { kind: "boolean" as const };
}

function edgeForTest(input: Partial<OptIrEdge> = {}): OptIrEdge {
  return {
    edgeId: input.edgeId ?? optIrEdgeId(1),
    from: input.from ?? optIrBlockId(1),
    toBlock: input.toBlock ?? optIrBlockId(2),
    ordinal: input.ordinal ?? 0,
    kind: input.kind ?? "normal",
    arguments: input.arguments ?? [],
    originId: input.originId ?? optIrOriginId(1),
  };
}

function functionForTest(input: Partial<OptIrFunction> = {}): OptIrFunction {
  return {
    functionId: input.functionId ?? optIrFunctionId(1),
    monoInstanceId: input.monoInstanceId ?? monoInstanceId("test::verifier"),
    signature: input.signature ?? EMPTY_MONO_SIGNATURE_FOR_TEST,
    blocks: input.blocks ?? [],
    edges: input.edges ?? optIrCfgEdgeTable([]),
    entryBlock: input.entryBlock ?? optIrBlockId(1),
    summary: input.summary,
    originId: input.originId ?? optIrOriginId(1),
  };
}

function programForFunctionForTest(func: OptIrFunction): OptIrProgram {
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetIdForTest("test-target"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId: optIrOriginId(1) }]),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [optIrOriginId(1)] },
  });
}
