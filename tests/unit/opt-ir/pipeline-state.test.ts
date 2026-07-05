import { describe, expect, test } from "bun:test";

import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrConstantId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrConstantOperation } from "../../../src/opt-ir/operations";
import { operationMap } from "../../../src/opt-ir/passes/pipeline-state";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

const originId = optIrOriginId(1);
const byteType = optIrUnsignedIntegerType(8);

describe("OptIR pipeline state helpers", () => {
  test("operationMap rejects duplicate operation IDs instead of collapsing entries", () => {
    const first = constantOperation(1, 10, 1n);
    const duplicate = constantOperation(1, 11, 2n);

    expect(() => operationMap([first, duplicate])).toThrow("duplicate OptIR operation id:1");
  });
});

function constantOperation(operationId: number, resultId: number, value: bigint) {
  return optIrConstantOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operationId),
      type: byteType,
      normalizedValue: value,
    }),
    originId,
  });
}
