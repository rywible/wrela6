import { expect, test } from "bun:test";

import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrConstantId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrAggregateConstructOperation,
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrMemoryLoadOperation,
  type OptIrAggregateOperation,
  type OptIrMemoryOperation,
  type OptIrOperation,
  type OptIrScalarOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import type { LayoutFactKey } from "../../../src/proof-check/model/fact-packet";

test("W0-05d keeps scalar aggregate and memory operations exported from the stable seam", () => {
  const integerType = optIrUnsignedIntegerType(32);
  const originId = optIrOriginId(0);

  const scalarOperation = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(1),
    resultId: optIrValueId(2),
    left: optIrValueId(3),
    right: optIrValueId(4),
    operator: "add",
    resultType: integerType,
    originId,
  });
  expect(scalarOperation.kind).toBe("integerBinary");
  if (scalarOperation.kind !== "integerBinary") {
    throw new Error("expected scalar operation");
  }
  const scalarAsDomainOperation: OptIrScalarOperation = scalarOperation;
  const scalarAsPublicOperation: OptIrOperation = scalarOperation;

  const aggregateOperation = optIrAggregateConstructOperation({
    operationId: optIrOperationId(5),
    fieldIds: [optIrValueId(6), optIrValueId(7)],
    resultId: optIrValueId(8),
    resultType: integerType,
    originId,
  });
  expect(aggregateOperation.kind).toBe("aggregateConstruct");
  if (aggregateOperation.kind !== "aggregateConstruct") {
    throw new Error("expected aggregate operation");
  }
  const aggregateAsDomainOperation: OptIrAggregateOperation = aggregateOperation;
  const aggregateAsPublicOperation: OptIrOperation = aggregateOperation;

  const memoryResult = optIrMemoryLoadOperation({
    operationId: optIrOperationId(9),
    resultId: optIrValueId(10),
    region: optIrRegionId(11),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: integerType,
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: {
      kind: "layoutFact",
      layoutKey: "packet.u32" as LayoutFactKey,
    },
    originId,
  });

  expect(memoryResult.kind).toBe("ok");
  if (memoryResult.kind !== "ok") {
    return;
  }
  if (memoryResult.operation.kind !== "memoryLoad") {
    throw new Error("expected memory operation");
  }
  const memoryOperation: OptIrMemoryOperation = memoryResult.operation;
  const memoryAsPublicOperation: OptIrOperation = memoryOperation;

  expect(scalarAsDomainOperation.kind).toBe("integerBinary");
  expect(aggregateAsDomainOperation.kind).toBe("aggregateConstruct");
  expect(scalarAsPublicOperation.kind).toBe("integerBinary");
  expect(aggregateAsPublicOperation.kind).toBe("aggregateConstruct");
  expect(memoryAsPublicOperation.kind).toBe("memoryLoad");
});

test("W0-05d keeps constant operation factory available through operations.ts", () => {
  const integerType = optIrUnsignedIntegerType(8);
  const constant = optIrIntegerConstant({
    constantId: optIrConstantId(17),
    type: integerType,
    normalizedValue: 3n,
  });
  const scalarOperation = optIrConstantOperation({
    operationId: optIrOperationId(12),
    resultId: optIrValueId(13),
    constant,
    originId: optIrOriginId(16),
  });

  expect(scalarOperation.kind).toBe("constant");
  if (scalarOperation.kind !== "constant") {
    throw new Error("expected constant operation");
  }
  const scalarAsDomainOperation: OptIrScalarOperation = scalarOperation;
  expect(scalarAsDomainOperation.kind).toBe("constant");
  expect(constant.normalizedValue).toBe(3n);
});
