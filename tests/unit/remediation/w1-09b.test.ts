import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import {
  optIrBlockId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrLayoutEndianDecodeOperation } from "../../../src/opt-ir/operations";
import { runWrelaCluster } from "../../../src/opt-ir/passes/pipeline-steps";
import type { PipelineState } from "../../../src/opt-ir/passes/pipeline-types";
import { optIrFunctionTable, optIrProgram } from "../../../src/opt-ir/program";
import { optIrConstantTable, optIrRegionTable } from "../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { targetSurfaceForInternalConstructionTest } from "../../support/opt-ir/internal-construction-fixtures";

describe("W1-09b Wrela endian target contract threading", () => {
  test("runWrelaCluster passes the target-owned endian fold contract to endian collapse", () => {
    const operation = optIrLayoutEndianDecodeOperation({
      operationId: optIrOperationId(9),
      bytes: optIrValueId(1),
      endian: "little",
      resultId: optIrValueId(2),
      resultType: optIrUnsignedIntegerType(32),
      originId: optIrOriginId(9),
    });
    const target = {
      ...targetSurfaceForInternalConstructionTest(),
      endianFoldContract: {
        permitsFirmwareEndianFold: true,
        permitsVolatileEndianFold: true,
      },
    };

    const result = runWrelaCluster(pipelineStateWithOperations([operation], target), target);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        ownerKey: "operation:9",
        rootCauseKey: "endianFolded",
        stableDetail: "provenance:wrela;facts:layout:endian:little>target:endian-fold",
      }),
    );
  });

  test("pipeline steps no longer hardcode a conservative endian fold contract", () => {
    const source = readFileSync("src/opt-ir/passes/pipeline-steps.ts", "utf8");

    expect(source).not.toContain("permitsFirmwareEndianFold: false");
    expect(source).not.toContain("permitsVolatileEndianFold: false");
  });
});

function pipelineStateWithOperations(
  operations: readonly ReturnType<typeof optIrLayoutEndianDecodeOperation>[],
  target: ReturnType<typeof targetSurfaceForInternalConstructionTest>,
): PipelineState {
  const block = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "return" as const,
      operationId: optIrOperationId(99),
      values: [],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
  const function_ = {
    functionId: optIrFunctionId(1),
    monoInstanceId: "w1-09b::fixture" as never,
    signature: {} as never,
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId: optIrOriginId(1),
  };

  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: target.targetId,
      functions: optIrFunctionTable([function_]),
      regions: optIrRegionTable([]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [optIrOriginId(1)] },
    }),
    operations,
    optimizationRegions: [],
    facts: emptyOptIrFactSet(),
    diagnostics: [],
    decisionLog: undefined,
    verificationCheckpoints: [],
  };
}
