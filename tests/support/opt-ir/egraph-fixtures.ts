import type { OptIrOperation } from "../../../src/opt-ir/operations";
import type { OptIrEGraphSelectionInput } from "../../../src/opt-ir/egraph/region-selection";
import {
  optIrConstantId,
  optIrOperationId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerUnaryOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

const u32 = optIrUnsignedIntegerType(32);

export function shuffledOperandImportFixtureForTest(): {
  readonly operations: readonly OptIrOperation[];
  readonly values: {
    readonly source: ReturnType<typeof optIrValueId>;
    readonly left: ReturnType<typeof optIrValueId>;
    readonly right: ReturnType<typeof optIrValueId>;
  };
} {
  const source = optIrValueId(1);
  const left = optIrValueId(3);
  const right = optIrValueId(7);
  return {
    operations: [
      optIrIntegerBinaryOperation({
        operationId: optIrOperationId(5),
        resultId: optIrValueId(9),
        left: right,
        right: left,
        operator: "add",
        resultType: u32,
        originId: 0 as never,
      }),
      optIrIntegerUnaryOperation({
        operationId: optIrOperationId(3),
        resultId: left,
        operand: source,
        operator: "negate",
        resultType: u32,
        originId: 0 as never,
      }),
      optIrConstantOperation({
        operationId: optIrOperationId(2),
        resultId: source,
        constant: {
          kind: "integer",
          constantId: optIrConstantId(0),
          type: u32,
          normalizedValue: 1n,
        },
        originId: 0 as never,
      }),
    ],
    values: { source, left, right },
  };
}

export function parserAndScalarDagProgramForTest(): OptIrEGraphSelectionInput {
  return {
    candidates: [
      candidate(4, "pureScalarDag", [40, 41, 42], 40),
      candidate(1, "parserValidationReadDispatchSlice", [10, 11, 12], 10),
      candidate(2, "vectorizableLoop", [20, 21, 22, 23], 20),
      candidate(3, "singleEntrySingleExitMemorySlice", [30, 31], 30),
      candidate(9, "pureScalarDag", [11, 12], 41),
      candidate(10, "pureScalarDag", [41, 42], 39),
    ],
  };
}

export function containingRegionTieBreakFixtureForTest(): OptIrEGraphSelectionInput {
  return {
    candidates: [
      candidate(1, "pureScalarDag", [10, 11], 10, {
        containingOperationIds: [10, 11, 12, 13].map(optIrOperationId),
      }),
      candidate(2, "pureScalarDag", [10, 11], 9, {
        containingOperationIds: [10, 11].map(optIrOperationId),
      }),
    ],
  };
}

export function boundaryFixtureForTest(): OptIrEGraphSelectionInput {
  return {
    candidates: [
      candidate(1, "pureScalarDag", [1, 2], 1, { boundary: "volatile" }),
      candidate(2, "pureScalarDag", [3, 4], 3, { boundary: "terminal" }),
      candidate(3, "pureScalarDag", [5, 6], 5, { boundary: "callback" }),
      candidate(4, "pureScalarDag", [7], 7, { boundary: "unknownCall" }),
      candidate(5, "pureScalarDag", [8, 9], 8),
      candidate(6, "pureScalarDag", [10], 10, { boundary: "externalRoot" }),
      candidate(7, "pureScalarDag", [11], 11, { boundary: "effectBoundary" }),
    ],
  };
}

export function multiTokenCallPartialWindowForTest(): OptIrEGraphSelectionInput {
  return {
    candidates: [
      candidate(1, "singleEntrySingleExitMemorySlice", [1, 3], 1, {
        tokenWindow: {
          operationIds: [1, 2, 3].map(optIrOperationId),
          tokenInputKeys: ["packet", "runtime"],
          tokenOutputKeys: ["packet", "runtime"],
        },
      }),
    ],
  };
}

function candidate(
  region: number,
  kind: OptIrEGraphSelectionInput["candidates"][number]["kind"],
  operations: readonly number[],
  root: number,
  extra: Partial<OptIrEGraphSelectionInput["candidates"][number]> = {},
): OptIrEGraphSelectionInput["candidates"][number] {
  return {
    regionId: region as never,
    containingRegionId: optIrRegionId(region),
    kind,
    operationIds: operations.map(optIrOperationId),
    rootOperationId: optIrOperationId(root),
    ...extra,
  };
}
