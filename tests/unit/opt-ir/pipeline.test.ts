import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrAliasClassId,
  optIrBlockId,
  optIrConstantId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrMemoryStoreOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { constructOptIr } from "../../../src/opt-ir/public-api";
import {
  optimizeOptIr,
  stableOptimizedOptIrResultKey,
  type OptimizeOptIrInput,
} from "../../../src/opt-ir/passes/pipeline";
import { productionOptimizationPolicyForTest } from "../../../src/opt-ir/policy/optimization-profile";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
} from "../../../src/opt-ir/program";
import type { OptIrRegion, OptIrRegionKind } from "../../../src/opt-ir/regions";
import type { OptIrTargetSurface } from "../../../src/opt-ir/target-surface";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { validConstructOptIrInputForTest } from "../../support/opt-ir/construction-fixtures";

const originId = optIrOriginId(10_000);
const byteType = optIrUnsignedIntegerType(8);

describe("OptIR optimizer pipeline", () => {
  test("runs the fixed production pipeline with required verifier checkpoints", () => {
    const input = validConstructOptIrInputForTest();
    const constructed = constructOptIr(input);
    if (constructed.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    const result = optimizeOptIr({
      program: constructed.program,
      facts: constructed.facts,
      target: input.target,
      policy: productionOptimizationPolicyForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected optimization to succeed.");
    }

    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
    expect(result.decisionLog.entries().map((entry) => entry.candidateKey)).toEqual(
      expect.arrayContaining([
        "pipeline:00:construction-cleanup",
        "pipeline:01:mandatory-semantic-inlining",
        "pipeline:19:fact-gated-egraph",
        "pipeline:25:final-verification",
      ]),
    );
    expect(result.verificationCheckpoints.map((checkpoint) => checkpoint.kind)).toEqual(
      expect.arrayContaining([
        "after-construction",
        "after-mandatory-inlining",
        "after-scope-expansion-cluster",
        "after-scalar-simplification-cluster",
        "after-memory-region-cluster",
        "after-wrela-cluster",
        "after-fact-gated-egraph",
        "after-vectorization-cluster",
        "after-final-cleanup",
        "before-target-lowering",
      ]),
    );

    const repeated = optimizeOptIr({
      program: constructed.program,
      facts: constructed.facts,
      target: input.target,
      policy: productionOptimizationPolicyForTest(),
    });
    expect(stableOptimizedOptIrResultKey(result)).toBe(stableOptimizedOptIrResultKey(repeated));
  });

  test("rejects stale external provenance maps instead of accepting optimizer input sidecars", () => {
    const input = validConstructOptIrInputForTest();
    const constructed = constructOptIr(input);
    if (constructed.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    const result = optimizeOptIr({
      program: constructed.program,
      facts: constructed.facts,
      target: input.target,
      policy: productionOptimizationPolicyForTest(),
      provenance: constructed.provenance,
    } as unknown as OptimizeOptIrInput);

    expect(result).toMatchObject({
      kind: "error",
      diagnostics: [{ stableDetail: "stale-external-provenance:provenance" }],
    });
  });

  test("keeps dead-store removals synchronized across operation artifacts and blocks", () => {
    const input = validConstructOptIrInputForTest();
    const constructed = constructOptIr(input);
    if (constructed.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    const region = regionForTest("stackLocal", 1);
    const firstValue = constantOperation(1, 10, 1, 1n);
    const secondValue = constantOperation(2, 11, 2, 2n);
    const firstStore = storeOperation(3, 10, region);
    const secondStore = storeOperation(4, 11, region);
    const operations = [firstValue, secondValue, firstStore, secondStore];
    const program = pipelineProgramWithOperations(operations, [region], input.target);

    const result = optimizeOptIr({
      program: {
        ...program,
        operations,
        optimizationRegions: [region],
      },
      facts: constructed.facts,
      target: { ...input.target, vector: { ...input.target.vector, enabled: false } },
      policy: productionOptimizationPolicyForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected optimization to succeed.");
    }

    const operationIds = result.operations.map((operation) => operation.operationId);
    expect(operationIds).not.toContain(firstStore.operationId);
    expect(result.program.operations?.map((operation) => operation.operationId)).toEqual(
      operationIds,
    );

    const blockOperationIds = result.program.functions.entries()[0]?.blocks[0]?.operations ?? [];
    expect(blockOperationIds).not.toContain(firstStore.operationId);
  });
});

function pipelineProgramWithOperations(
  operations: readonly OptIrOperation[],
  regions: readonly OptIrRegion[],
  target: OptIrTargetSurface,
) {
  const block = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "return" as const,
      operationId: optIrOperationId(99),
      values: [],
      originId,
    },
    originId,
  };
  const function_ = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("pipeline-memory-sync::fixture"),
    signature: {} as MonoFunctionSignature,
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId,
  };
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: target.targetId,
    functions: optIrFunctionTable([function_]),
    regions: optIrRegionTable(regions.map((region) => ({ regionId: region.regionId, originId }))),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
}

function regionForTest(kind: OptIrRegionKind, id: number): OptIrRegion {
  return {
    regionId: optIrRegionId(id),
    kind,
    owner: { kind: "function", functionId: monoInstanceId("pipeline-memory-sync::fixture") },
    lifetime: "activation",
    aliasClass: optIrAliasClassId(id),
    volatility: "nonVolatile",
    effects: { mutability: "mutable", ordering: "none" },
    origin: { originId, source: { file: `pipeline-memory-sync-${kind}-${id}.wr` } },
  };
}

function constantOperation(
  operationId: number,
  valueId: number,
  constantId: number,
  normalizedValue: bigint,
): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(valueId),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(constantId),
      type: byteType,
      normalizedValue,
    }),
    originId,
  });
}

function storeOperation(operationId: number, valueId: number, region: OptIrRegion): OptIrOperation {
  const result = optIrMemoryStoreOperation({
    operationId: optIrOperationId(operationId),
    storeValue: optIrValueId(valueId),
    region: region.regionId,
    byteOffset: 0n,
    byteWidth: 1,
    alignment: 1,
    valueType: byteType,
    endian: "native",
    volatility: region.volatility,
    boundsAuthority: { kind: "targetContract", authorityKey: `region:${region.regionId}` },
    originId,
  });
  if (result.kind !== "ok") {
    throw new Error("Expected store construction to succeed.");
  }
  return result.operation;
}
