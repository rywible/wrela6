import { monoInstanceId } from "../../../../../src/mono/ids";
import { optIrCfgEdgeTable } from "../../../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../../../src/opt-ir/constants";
import {
  optIrAliasClassId,
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrPathCertificateId,
  optIrRegionId,
  optIrValueId,
  optIrCallId,
} from "../../../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrFpNumericOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrLayoutEndianDecodeOperation,
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  optIrProofErasedMarkerOperation,
  optIrPlatformCallOperation,
  optIrSemanticAtomicOperation,
  optIrSemanticChecksumOperation,
  optIrSemanticClassifierOperation,
  optIrSemanticPolynomialOperation,
  optIrSourceCallOperation,
  optIrVectorCompareOperation,
  optIrVectorLoadOperation,
  optIrVectorStoreOperation,
  type OptIrOperation,
} from "../../../../../src/opt-ir/operations";
import {
  optIrFunctionTable,
  optIrRegionTable,
  type OptIrProgram,
} from "../../../../../src/opt-ir/program";
import type { OptIrRegion } from "../../../../../src/opt-ir/regions";
import { optIrUnsignedIntegerType, type OptIrType } from "../../../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../../../src/opt-ir/values";
import {
  optIrBlockForTest,
  optIrFunctionForTest,
  optIrProgramForTest,
} from "../../../opt-ir/cfg-fakes";

export function optimizedOptIrProgramWithOneFunctionForAArch64Test() {
  const originId = optIrOriginId(1);
  const u64 = optIrUnsignedIntegerType(64);
  const left = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(10),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: u64,
      normalizedValue: 40n,
    }),
    originId,
  });
  const right = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(11),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(2),
      type: u64,
      normalizedValue: 2n,
    }),
    originId,
  });
  const sum = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(3),
    resultId: optIrValueId(12),
    left: optIrValueId(10),
    right: optIrValueId(11),
    operator: "add",
    resultType: u64,
    originId,
  });
  const store = requireOperation(
    optIrMemoryStoreOperation({
      operationId: optIrOperationId(4),
      storeValue: optIrValueId(12),
      region: optIrRegionId(1),
      byteOffset: 32n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "aarch64.integration" },
      originId,
    }),
  );
  const load = requireOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(5),
      resultId: optIrValueId(13),
      region: optIrRegionId(1),
      byteOffset: 32n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "aarch64.integration" },
      originId,
    }),
  );
  const comparison = optIrIntegerCompareOperation({
    operationId: optIrOperationId(6),
    resultId: optIrValueId(14),
    left: optIrValueId(13),
    right: optIrValueId(12),
    operator: "equal",
    originId,
  });
  const operations = [left, right, sum, store, load, comparison];
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(13)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([sourceFunction]),
  });
  return {
    program,
    operations,
    operationIds: operations.map((operation) => Number(operation.operationId)),
  };
}

export function optimizedOptIrProgramWithValidatedBufferForAArch64Test() {
  const u64 = optIrUnsignedIntegerType(64);
  const originId = optIrOriginId(10);
  const load = requireOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(7),
      resultId: optIrValueId(70),
      region: optIrRegionId(4),
      byteOffset: 16n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "validated.packet" },
      validatedBuffer: {
        fieldName: "payload",
        layoutPath: ["packet", "payload"],
        readRequires: ["length-checked"],
        pathCertificates: [optIrPathCertificateId(1)],
      },
      originId,
    }),
  );
  return programWithSingleBlockOperations([load], [optIrValueId(70)], originId);
}

export function optimizedOptIrProgramWithValidatedBufferPairForAArch64Test() {
  const u64 = optIrUnsignedIntegerType(64);
  const originId = optIrOriginId(11);
  const first = requireOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(7),
      resultId: optIrValueId(71),
      region: optIrRegionId(4),
      byteOffset: 16n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "validated.packet" },
      validatedBuffer: {
        fieldName: "payload.first",
        layoutPath: ["packet", "payload", "first"],
        readRequires: ["length-checked"],
        pathCertificates: [optIrPathCertificateId(1)],
      },
      originId,
    }),
  );
  const second = requireOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(8),
      resultId: optIrValueId(72),
      region: optIrRegionId(4),
      byteOffset: 24n,
      byteWidth: 8,
      alignment: 8,
      valueType: u64,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "validated.packet" },
      validatedBuffer: {
        fieldName: "payload.second",
        layoutPath: ["packet", "payload", "second"],
        readRequires: ["length-checked"],
        pathCertificates: [optIrPathCertificateId(2)],
      },
      originId,
    }),
  );
  return programWithSingleBlockOperations(
    [first, second],
    [optIrValueId(71), optIrValueId(72)],
    originId,
  );
}

export function optimizedOptIrProgramWithEntryParameterForAArch64Test() {
  const originId = optIrOriginId(20);
  const u64 = optIrUnsignedIntegerType(64);
  const constant = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(11),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: u64,
      normalizedValue: 2n,
    }),
    originId,
  });
  const sum = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(12),
    left: optIrValueId(10),
    right: optIrValueId(11),
    operator: "add",
    resultType: u64,
    originId,
  });
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [
      optIrBlockParameter({
        valueId: optIrValueId(10),
        type: u64,
        incomingRole: "entry",
        originId,
      }),
    ],
    operations: [constant.operationId, sum.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(12)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  return {
    program: optIrProgramForTest({ functions: optIrFunctionTable([sourceFunction]) }),
    operations: [constant, sum],
  };
}

export function optimizedOptIrProgramWithNineEntryParametersForAArch64Test() {
  const originId = optIrOriginId(25);
  const u64 = optIrUnsignedIntegerType(64);
  const parameters = Array.from({ length: 9 }, (_unused, index) =>
    optIrBlockParameter({
      valueId: optIrValueId(200 + index),
      type: u64,
      incomingRole: "entry",
      originId,
    }),
  );
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters,
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [optIrValueId(208)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  return {
    program: optIrProgramForTest({ functions: optIrFunctionTable([sourceFunction]) }),
    operations: [],
  };
}

export function optimizedOptIrProgramWithEndianDecodeForAArch64Test(widthBits: 16 | 32 | 64) {
  const originId = optIrOriginId(30 + widthBits);
  const integerType = optIrUnsignedIntegerType(widthBits);
  const bytes = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(21),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(2),
      type: integerType,
      normalizedValue: 0x1234n,
    }),
    originId,
  });
  const decode = optIrLayoutEndianDecodeOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(22),
    bytes: optIrValueId(21),
    endian: "big",
    resultType: integerType,
    originId,
  });
  return programWithSingleBlockOperations([bytes, decode], [optIrValueId(22)], originId);
}

export function optimizedOptIrProgramWithOutOfRangeU32ConstantForAArch64Test() {
  const originId = optIrOriginId(39);
  const constant = optIrConstantOperation({
    operationId: optIrOperationId(39),
    resultId: optIrValueId(39),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(39),
      type: optIrUnsignedIntegerType(32),
      normalizedValue: 0x1_0000_0000n,
    }),
    originId,
  });
  return programWithSingleBlockOperations([constant], [optIrValueId(39)], originId);
}

export function optimizedOptIrProgramWithAcquireLoadForAArch64Test(options?: {
  readonly byteOffset?: bigint;
}) {
  const originId = optIrOriginId(40);
  const load = requireOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(5),
      resultId: optIrValueId(50),
      region: optIrRegionId(2),
      byteOffset: options?.byteOffset ?? 0n,
      byteWidth: 8,
      alignment: 8,
      valueType: optIrUnsignedIntegerType(64),
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "acquire.load" },
      originId,
    }),
  );
  return programWithSingleBlockOperations([load], [optIrValueId(50)], originId);
}

export function optimizedOptIrProgramWithFpNumericForAArch64Test() {
  const originId = optIrOriginId(45);
  const u64 = optIrUnsignedIntegerType(64);
  const left = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(41),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(41),
      type: u64,
      normalizedValue: 2n,
    }),
    originId,
  });
  const right = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(42),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(42),
      type: u64,
      normalizedValue: 3n,
    }),
    originId,
  });
  const addend = optIrConstantOperation({
    operationId: optIrOperationId(3),
    resultId: optIrValueId(43),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(43),
      type: u64,
      normalizedValue: 4n,
    }),
    originId,
  });
  const fused = optIrFpNumericOperation({
    operationId: optIrOperationId(45),
    operands: [optIrValueId(41), optIrValueId(42), optIrValueId(43)],
    resultIds: [optIrValueId(44)],
    resultTypes: [u64],
    numericContract: { family: "multiplyAdd" },
    originId,
  });
  return programWithSingleBlockOperations(
    [left, right, addend, fused],
    [optIrValueId(44)],
    originId,
  );
}

export function optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test(options?: {
  readonly alignment?: number;
  readonly byteOffset?: bigint;
}) {
  const originId = optIrOriginId(50);
  const u64 = optIrUnsignedIntegerType(64);
  const stored = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(60),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(3),
      type: u64,
      normalizedValue: 1n,
    }),
    originId,
  });
  const store = requireOperation(
    optIrMemoryStoreOperation({
      operationId: optIrOperationId(9),
      storeValue: optIrValueId(60),
      region: optIrRegionId(3),
      byteOffset: options?.byteOffset ?? 8n,
      byteWidth: 8,
      alignment: options?.alignment ?? 8,
      valueType: u64,
      endian: "little",
      volatility: "volatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "virtio.release" },
      originId,
    }),
  );
  return programWithSingleBlockOperations([stored, store], [], originId, [
    optIrOptimizationRegionForAArch64Test({
      regionId: optIrRegionId(3),
      kind: "imageDevice",
      owner: { kind: "target", targetKey: "virtio.notify" },
      originId,
    }),
  ]);
}

export function optimizedOptIrProgramWithVectorLoadForAArch64Test(
  input: { readonly laneCount?: number } = {},
) {
  const originId = optIrOriginId(60);
  const vectorType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: input.laneCount ?? 16,
  };
  const byteWidth = vectorByteWidthForTest(vectorType);
  const load = requireOperation(
    optIrVectorLoadOperation({
      operationId: optIrOperationId(8),
      resultId: optIrValueId(80),
      resultType: vectorType,
      region: optIrRegionId(5),
      byteOffset: 0n,
      byteWidth,
      alignment: byteWidth,
      valueType: vectorType,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "vector.load" },
      originId,
    }),
  );
  return programWithSingleBlockOperations([load], [optIrValueId(80)], originId);
}

export function optimizedOptIrProgramWithVectorStoreForAArch64Test(
  input: { readonly laneCount?: number } = {},
) {
  const originId = optIrOriginId(61);
  const vectorType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: input.laneCount ?? 16,
  };
  const byteWidth = vectorByteWidthForTest(vectorType);
  const store = requireOperation(
    optIrVectorStoreOperation({
      operationId: optIrOperationId(8),
      vector: optIrValueId(80),
      storeValue: optIrValueId(80),
      region: optIrRegionId(5),
      byteOffset: 0n,
      byteWidth,
      alignment: byteWidth,
      valueType: vectorType,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "vector.store" },
      originId,
    }),
  );
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [
      optIrBlockParameter({
        valueId: optIrValueId(80),
        type: vectorType,
        incomingRole: "entry",
        originId,
      }),
    ],
    operations: [store.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: [],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  return {
    program: optIrProgramForTest({
      functions: optIrFunctionTable([sourceFunction]),
    }),
    operations: [store],
    operationIds: [Number(store.operationId)],
  };
}

export function optimizedOptIrProgramWithSourceCallForAArch64Test() {
  const originId = optIrOriginId(70);
  const call = optIrSourceCallOperation({
    operationId: optIrOperationId(12),
    callId: optIrCallId(1),
    target: { kind: "source", functionInstanceId: monoInstanceId("callee") },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId,
  });
  return programWithSingleBlockOperations([call], [], originId);
}

export function optimizedOptIrProgramWithSourceCallArgumentsForAArch64Test() {
  const originId = optIrOriginId(71);
  const u64 = optIrUnsignedIntegerType(64);
  const constants = Array.from({ length: 9 }, (_unused, index) =>
    optIrConstantOperation({
      operationId: optIrOperationId(200 + index),
      resultId: optIrValueId(300 + index),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(200 + index),
        type: u64,
        normalizedValue: BigInt(index + 1),
      }),
      originId,
    }),
  );
  const call = optIrSourceCallOperation({
    operationId: optIrOperationId(212),
    callId: optIrCallId(212),
    target: { kind: "source", functionInstanceId: monoInstanceId("callee.with.args") },
    argumentIds: constants.map((operation) => operation.resultIds[0] ?? optIrValueId(0)),
    resultIds: [],
    resultTypes: [],
    originId,
  });
  return programWithSingleBlockOperations([...constants, call], [], originId);
}

export function optimizedOptIrProgramWithVectorReturnSourceCallForAArch64Test() {
  const originId = optIrOriginId(73);
  const vectorType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: 16,
  };
  const call = optIrSourceCallOperation({
    operationId: optIrOperationId(213),
    callId: optIrCallId(213),
    target: { kind: "source", functionInstanceId: monoInstanceId("callee.vector") },
    argumentIds: [],
    resultIds: [optIrValueId(313)],
    resultTypes: [vectorType],
    originId,
  });
  return programWithSingleBlockOperations([call], [optIrValueId(313)], originId);
}

export function optimizedOptIrProgramWithVectorStackCallArgumentsForAArch64Test() {
  const originId = optIrOriginId(74);
  const vectorType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: 16,
  };
  const constants = Array.from({ length: 10 }, (_unused, index) =>
    optIrConstantOperation({
      operationId: optIrOperationId(230 + index),
      resultId: optIrValueId(330 + index),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(230 + index),
        type: vectorType,
        normalizedValue: BigInt(index + 1),
      }),
      originId,
    }),
  );
  const call = optIrSourceCallOperation({
    operationId: optIrOperationId(240),
    callId: optIrCallId(240),
    target: { kind: "source", functionInstanceId: monoInstanceId("callee.with.vector.args") },
    argumentIds: constants.map((operation) => operation.resultIds[0] ?? optIrValueId(0)),
    resultIds: [],
    resultTypes: [],
    originId,
  });
  return programWithSingleBlockOperations([...constants, call], [], originId);
}

export function optimizedOptIrProgramWithJumpArgumentForAArch64Test() {
  const originId = optIrOriginId(72);
  const u64 = optIrUnsignedIntegerType(64);
  const constant = optIrConstantOperation({
    operationId: optIrOperationId(220),
    resultId: optIrValueId(320),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(220),
      type: u64,
      normalizedValue: 42n,
    }),
    originId,
  });
  const entry = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [constant.operationId],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(221),
      edge: optIrEdgeId(1),
      originId,
    },
    originId,
  });
  const successor = optIrBlockForTest({
    blockId: optIrBlockId(2),
    parameters: [
      optIrBlockParameter({
        valueId: optIrValueId(321),
        type: u64,
        incomingRole: "branchArgument",
        originId,
      }),
    ],
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(222),
      values: [optIrValueId(321)],
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [entry, successor],
    edges: optIrCfgEdgeTable([
      {
        edgeId: optIrEdgeId(1),
        from: optIrBlockId(1),
        toBlock: optIrBlockId(2),
        ordinal: 0,
        kind: "normal",
        arguments: [optIrValueId(320)],
        originId,
      },
    ]),
    entryBlock: entry.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([sourceFunction]),
  });
  return { program, operations: [constant] };
}

export function optimizedOptIrProgramWithPlatformCallForAArch64Test() {
  const originId = optIrOriginId(75);
  const call = optIrPlatformCallOperation({
    operationId: optIrOperationId(18),
    callId: optIrCallId(18),
    target: { kind: "platform", platformKey: "uefi.boot-services.allocate-pool" },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId,
  });
  return programWithSingleBlockOperations([call], [], originId);
}

export function optimizedOptIrProgramWithProofErasedMarkerForAArch64Test() {
  const originId = optIrOriginId(80);
  const marker = optIrProofErasedMarkerOperation({
    operationId: optIrOperationId(13),
    erasedProof: "fixture-erased-proof",
    originId,
  });
  return programWithSingleBlockOperations([marker], [], originId);
}

export function optimizedOptIrProgramWithSemanticAtomicForAArch64Test(input?: {
  readonly semanticContract?: Readonly<Record<string, unknown>>;
}) {
  const originId = optIrOriginId(85);
  const u64 = optIrUnsignedIntegerType(64);
  const address = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(85),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(8),
      type: u64,
      normalizedValue: 16n,
    }),
    originId,
  });
  const addend = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(86),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(9),
      type: u64,
      normalizedValue: 1n,
    }),
    originId,
  });
  const atomic = optIrSemanticAtomicOperation({
    operationId: optIrOperationId(17),
    operands: [optIrValueId(85), optIrValueId(86)],
    resultIds: [optIrValueId(87)],
    resultTypes: [u64],
    semanticContract: input?.semanticContract ?? {
      addressSourceIndex: 0,
      valueSourceIndex: 1,
      regionMemoryType: "normalCacheable",
    },
    originId,
  });
  return programWithSingleBlockOperations([address, addend, atomic], [optIrValueId(87)], originId);
}

export function optimizedOptIrProgramWithSemanticChecksumForAArch64Test() {
  const originId = optIrOriginId(90);
  const u64 = optIrUnsignedIntegerType(64);
  const vector128 = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: 16,
  };
  const left = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(90),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(10),
      type: u64,
      normalizedValue: 0x1234n,
    }),
    originId,
  });
  const right = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(91),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(11),
      type: u64,
      normalizedValue: 0x5678n,
    }),
    originId,
  });
  const polynomialLeft = optIrConstantOperation({
    operationId: optIrOperationId(3),
    resultId: optIrValueId(94),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(10),
      type: vector128,
      normalizedValue: 0x01020304n,
    }),
    originId,
  });
  const polynomialRight = optIrConstantOperation({
    operationId: optIrOperationId(4),
    resultId: optIrValueId(95),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(11),
      type: vector128,
      normalizedValue: 0x05060708n,
    }),
    originId,
  });
  const checksum = optIrSemanticChecksumOperation({
    operationId: optIrOperationId(14),
    operands: [optIrValueId(90), optIrValueId(91)],
    resultIds: [optIrValueId(92)],
    resultTypes: [u64],
    semanticContract: {
      algorithm: "crc32",
      polynomial: "crc32-ieee",
      widthBits: 32,
      chunkWidthBits: 64,
      chunking: "fixed-width",
      initialXor: 0,
      finalXor: 0,
    },
    originId,
  });
  const polynomial = optIrSemanticPolynomialOperation({
    operationId: optIrOperationId(15),
    operands: [optIrValueId(94), optIrValueId(95)],
    resultIds: [optIrValueId(93)],
    resultTypes: [vector128],
    semanticContract: {
      polynomial: "pmull",
      chunkWidthBits: 64,
      reductionShape: "carryless-multiply",
      regionId: 4,
      alignmentBytes: 16,
      securityDomain: "cryptographic",
    },
    originId,
  });
  return programWithSingleBlockOperations(
    [left, right, polynomialLeft, polynomialRight, checksum, polynomial],
    [optIrValueId(92)],
    originId,
  );
}

export function optimizedOptIrProgramWithSemanticClassifierForAArch64Test(options?: {
  readonly tableShape?: "dotprod" | "tbl" | "tbx";
}) {
  const originId = optIrOriginId(100);
  const valueType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: 16,
  };
  const table = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(100),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(12),
      type: valueType,
      normalizedValue: 0x10101010n,
    }),
    originId,
  });
  const classifierInput = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(101),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(13),
      type: valueType,
      normalizedValue: 0x01020304n,
    }),
    originId,
  });
  const classifier = optIrSemanticClassifierOperation({
    operationId: optIrOperationId(16),
    operands: [optIrValueId(100), optIrValueId(101)],
    resultIds: [optIrValueId(102)],
    resultTypes: [valueType],
    semanticContract: { alphabet: "fixed-u8", tableShape: options?.tableShape ?? "dotprod" },
    originId,
  });
  return programWithSingleBlockOperations(
    [table, classifierInput, classifier],
    [optIrValueId(102)],
    originId,
  );
}

export function optimizedOptIrProgramWithTwoSemanticClassifiersForAArch64Test() {
  const originId = optIrOriginId(101);
  const valueType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: 16,
  };
  const firstTable = optIrConstantOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(100),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(12),
      type: valueType,
      normalizedValue: 0x10101010n,
    }),
    originId,
  });
  const firstInput = optIrConstantOperation({
    operationId: optIrOperationId(2),
    resultId: optIrValueId(101),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(13),
      type: valueType,
      normalizedValue: 0x01020304n,
    }),
    originId,
  });
  const firstClassifier = optIrSemanticClassifierOperation({
    operationId: optIrOperationId(16),
    operands: [optIrValueId(100), optIrValueId(101)],
    resultIds: [optIrValueId(102)],
    resultTypes: [valueType],
    semanticContract: { alphabet: "fixed-u8", tableShape: "tbl" },
    originId,
  });
  const secondTable = optIrConstantOperation({
    operationId: optIrOperationId(21),
    resultId: optIrValueId(110),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(21),
      type: valueType,
      normalizedValue: 0x20202020n,
    }),
    originId,
  });
  const secondInput = optIrConstantOperation({
    operationId: optIrOperationId(22),
    resultId: optIrValueId(111),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(22),
      type: valueType,
      normalizedValue: 0x05060708n,
    }),
    originId,
  });
  const secondClassifier = optIrSemanticClassifierOperation({
    operationId: optIrOperationId(26),
    operands: [optIrValueId(110), optIrValueId(111)],
    resultIds: [optIrValueId(112)],
    resultTypes: [valueType],
    semanticContract: { alphabet: "fixed-u8", tableShape: "tbl" },
    originId,
  });
  return programWithSingleBlockOperations(
    [firstTable, firstInput, firstClassifier, secondTable, secondInput, secondClassifier],
    [],
    originId,
  );
}

export function optimizedOptIrProgramWithVectorCompareForAArch64Test() {
  const originId = optIrOriginId(105);
  const vectorType = {
    kind: "vector" as const,
    laneType: optIrUnsignedIntegerType(8),
    laneCount: 16,
  };
  const left = requireOperation(
    optIrVectorLoadOperation({
      operationId: optIrOperationId(8),
      resultId: optIrValueId(105),
      resultType: vectorType,
      region: optIrRegionId(5),
      byteOffset: 0n,
      byteWidth: 16,
      alignment: 16,
      valueType: vectorType,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "vector.compare.left" },
      originId,
    }),
  );
  const right = requireOperation(
    optIrVectorLoadOperation({
      operationId: optIrOperationId(9),
      resultId: optIrValueId(106),
      resultType: vectorType,
      region: optIrRegionId(6),
      byteOffset: 0n,
      byteWidth: 16,
      alignment: 16,
      valueType: vectorType,
      endian: "little",
      volatility: "nonVolatile",
      boundsAuthority: { kind: "targetContract", authorityKey: "vector.compare.right" },
      originId,
    }),
  );
  const compare = optIrVectorCompareOperation({
    operationId: optIrOperationId(19),
    sourceValueIds: [optIrValueId(105), optIrValueId(106)],
    resultId: optIrValueId(107),
    resultType: vectorType,
    originId,
  });
  return programWithSingleBlockOperations([left, right, compare], [optIrValueId(107)], originId);
}

function vectorByteWidthForTest(type: OptIrType & { readonly kind: "vector" }): number {
  const laneWidthBits = (() => {
    switch (type.laneType.kind) {
      case "boolean":
        return 1;
      case "integer":
        return type.laneType.width;
      case "pointer":
      case "address":
      case "never":
      case "unit":
      case "zeroSized":
        return 64;
    }
  })();
  return Math.ceil((laneWidthBits * type.laneCount) / 8);
}

function programWithSingleBlockOperations(
  operations: readonly OptIrOperation[],
  returnValues: readonly ReturnType<typeof optIrValueId>[],
  originId: ReturnType<typeof optIrOriginId>,
  optimizationRegions: readonly OptIrRegion[] = [],
) {
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "return",
      operationId: optIrOperationId(99),
      values: returnValues,
      originId,
    },
    originId,
  });
  const sourceFunction = optIrFunctionForTest({
    blocks: [block],
    entryBlock: block.blockId,
    externalRoot: { reason: "imageEntry", originId },
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([sourceFunction]),
    regions: optIrRegionTable(
      memoryRegionIdsForOperations(operations).map((regionId) => ({ regionId, originId })),
    ),
  });
  return {
    program: programWithOptimizationRegions(program, optimizationRegions),
    operations,
  };
}

function memoryRegionIdsForOperations(
  operations: readonly OptIrOperation[],
): readonly ReturnType<typeof optIrRegionId>[] {
  const regionIds = new Set<ReturnType<typeof optIrRegionId>>([optIrRegionId(1)]);
  for (const operation of operations) {
    const memoryAccess = (operation as { readonly memoryAccess?: { readonly region?: unknown } })
      .memoryAccess;
    if (typeof memoryAccess?.region === "number") {
      regionIds.add(memoryAccess.region as ReturnType<typeof optIrRegionId>);
    }
  }
  return [...regionIds].sort((left, right) => Number(left) - Number(right));
}

function programWithOptimizationRegions(
  program: OptIrProgram,
  optimizationRegions: readonly OptIrRegion[],
): OptIrProgram & { readonly optimizationRegions?: readonly OptIrRegion[] } {
  return optimizationRegions.length === 0
    ? program
    : {
        ...program,
        optimizationRegions: Object.freeze([...optimizationRegions]),
      };
}

function optIrOptimizationRegionForAArch64Test(input: {
  readonly regionId: ReturnType<typeof optIrRegionId>;
  readonly kind: OptIrRegion["kind"];
  readonly owner: OptIrRegion["owner"];
  readonly originId: ReturnType<typeof optIrOriginId>;
}): OptIrRegion {
  return {
    regionId: input.regionId,
    kind: input.kind,
    owner: input.owner,
    lifetime:
      input.kind === "imageDevice" || input.kind === "firmwareTable" ? "external" : "program",
    aliasClass: optIrAliasClassId(Number(input.regionId)),
    volatility: input.kind === "imageDevice" ? "volatile" : "nonVolatile",
    effects:
      input.kind === "imageDevice"
        ? { mutability: "mutable", ordering: "orderedEffectToken" }
        : { mutability: "readOnly", ordering: "none" },
    origin: { originId: input.originId },
  };
}

function requireOperation(
  result:
    | ReturnType<typeof optIrMemoryStoreOperation>
    | ReturnType<typeof optIrMemoryLoadOperation>
    | ReturnType<typeof optIrVectorLoadOperation>,
): OptIrOperation {
  if (result.kind !== "ok") {
    throw new Error("Expected AArch64 optimized OptIR fixture operation to construct.");
  }
  return result.operation;
}
