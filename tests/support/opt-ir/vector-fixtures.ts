import {
  optIrBlockId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { OptIrLoopVectorizationCandidate } from "../../../src/opt-ir/passes/loop-vectorization";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

export function loopVectorizationCandidateForTest(
  overrides: Partial<OptIrLoopVectorizationCandidate> = {},
): OptIrLoopVectorizationCandidate {
  return {
    loopId: "loop:payload-copy",
    headerBlockId: optIrBlockId(10),
    latchBlockIds: [optIrBlockId(12)],
    bodyBlockIds: [optIrBlockId(10), optIrBlockId(11), optIrBlockId(12)],
    scalarOperationIds: [optIrOperationId(1), optIrOperationId(2), optIrOperationId(3)],
    nextOperationId: 100,
    nextValueId: 200,
    originId: optIrOriginId(1),
    laneType: optIrUnsignedIntegerType(8),
    lanes: 4,
    tripCount: { kind: "certifiedExact", iterations: 16 },
    tailPlan: { kind: "certifiedMultiple" },
    laneBounds: [
      { operationId: optIrOperationId(1), proven: true },
      { operationId: optIrOperationId(2), proven: true },
    ],
    memoryAccesses: [
      {
        operationId: optIrOperationId(1),
        kind: "load",
        region: optIrRegionId(1),
        byteOffset: 0n,
        byteWidth: 4,
        alignment: 4,
        sourceValueIds: [],
        boundsAuthority: { kind: "targetContract", authorityKey: "loop-vector-load" },
        memoryVersionBefore: 0,
        memoryVersionAfter: 0,
      },
      {
        operationId: optIrOperationId(2),
        kind: "store",
        region: optIrRegionId(2),
        byteOffset: 0n,
        byteWidth: 4,
        alignment: 4,
        sourceValueIds: [optIrValueId(20), optIrValueId(21)],
        boundsAuthority: { kind: "targetContract", authorityKey: "loop-vector-store" },
        memoryVersionBefore: 0,
        memoryVersionAfter: 1,
      },
    ],
    memoryIndependenceProven: true,
    effectSafety: {
      safe: true,
      carriedValues: [
        { valueId: optIrValueId(30), kind: "scalarRecurrence" },
        { valueId: optIrValueId(31), kind: "recognizedReduction" },
        { valueId: optIrValueId(32), kind: "preservedRegionToken" },
        { valueId: optIrValueId(33), kind: "preservedEffectToken" },
      ],
      blockedEffects: [],
      vectorPermittedEffects: [],
    },
    targetOperationKinds: ["vectorLoad", "vectorStore"],
    estimatedLiveVectorRegisters: 2,
    ...overrides,
  };
}
