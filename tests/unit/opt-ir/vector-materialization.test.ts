import { describe, expect, test } from "bun:test";
import { optIrOperationId } from "../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import { runLoopVectorization } from "../../../src/opt-ir/passes/loop-vectorization";
import { runSlpVectorization } from "../../../src/opt-ir/passes/slp-vectorization";
import {
  materializeLoopVectorization,
  materializeSlpVectorization,
} from "../../../src/opt-ir/passes/vector-materialization";
import { hasMemoryAccess } from "../../../src/opt-ir/operation-access";
import { discoverSlpCandidates } from "../../../src/opt-ir/passes/vector-discovery";
import { runCopyPropagation } from "../../../src/opt-ir/passes/copy-propagation";
import { optIrDefaultVectorPolicy } from "../../../src/opt-ir/policy/vector-policy";
import { targetOptimizationSurfaceForTest } from "../../support/opt-ir/target-optimization-fakes";
import {
  adjacentLoadProgramForTest,
  eightLoadProgramForTest,
  interleavedAdjacentLoadProgramForTest,
  loopMemoryProgramForTest,
  splitBlockAdjacentLoadProgramForTest,
} from "../../support/opt-ir/vector-materialization-fixtures";
import { loopVectorizationCandidateForTest } from "../../support/opt-ir/vector-fixtures";

describe("OptIR vector materialization", () => {
  test("SLP materialization produces vectorLoad in program operations", () => {
    const { program, operations, blockId } = adjacentLoadProgramForTest();
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const candidates = discoverSlpCandidates({
      program,
      operations,
      facts: optIrFactSetFromRecords([]),
    });
    expect(candidates.length).toBeGreaterThan(0);

    const slp = runSlpVectorization({
      nextOperationId: 100,
      nextValueId: 200,
      candidates,
      policy,
    });
    const materialized = materializeSlpVectorization({
      program,
      operations,
      slpResult: slp,
    });

    expect(materialized.operations.some((operation) => operation.kind === "vectorLoad")).toBe(true);
    const block = materialized.program.functions
      .entries()[0]
      ?.blocks.find((entry) => entry.blockId === blockId);
    expect(
      block?.operations.some((operationId) => {
        const operation = materialized.operations.find(
          (entry) => entry.operationId === operationId,
        );
        return operation?.kind === "vectorLoad";
      }),
    ).toBe(true);
    expect(
      materialized.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("slp-vectorization:materialized:"),
      ),
    ).toBe(true);
    const vectorLoad = materialized.operations.find((operation) => operation.kind === "vectorLoad");
    expect(vectorLoad?.kind).toBe("vectorLoad");
    if (vectorLoad?.kind !== "vectorLoad") {
      throw new Error("Expected SLP materialization to create a vector load.");
    }
    const sourceOperation = operations[0]!;
    if (!hasMemoryAccess(sourceOperation)) {
      throw new Error("Expected first fixture operation to carry memory access metadata.");
    }
    expect(vectorLoad.memoryAccess.region).toBe(sourceOperation.memoryAccess.region);
    expect(vectorLoad.memoryAccess.endian).toBe(sourceOperation.memoryAccess.endian);
    expect(vectorLoad.memoryAccess.boundsAuthority).toEqual(
      sourceOperation.memoryAccess.boundsAuthority,
    );
    expect(vectorLoad.originId).toBe(sourceOperation.originId);
  });

  test("SLP materialization merges multiple packs in one block", () => {
    const { program, operations, blockId } = eightLoadProgramForTest();
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const candidates = discoverSlpCandidates({
      program,
      operations,
      facts: optIrFactSetFromRecords([]),
    });
    expect(candidates.length).toBeGreaterThan(1);

    const slp = runSlpVectorization({
      nextOperationId: 100,
      nextValueId: 200,
      candidates,
      policy,
    });
    expect(slp.rewriteRecords.length).toBeGreaterThan(1);

    const materialized = materializeSlpVectorization({
      program,
      operations,
      slpResult: slp,
    });

    const vectorLoads = materialized.operations.filter(
      (operation) => operation.kind === "vectorLoad",
    );
    expect(vectorLoads.length).toBe(slp.rewriteRecords.length);
    const block = materialized.program.functions
      .entries()[0]
      ?.blocks.find((entry) => entry.blockId === blockId);
    expect(
      block?.operations.filter((operationId) =>
        materialized.operations.some(
          (operation) => operation.operationId === operationId && operation.kind === "vectorLoad",
        ),
      ).length,
    ).toBe(slp.rewriteRecords.length);
  });

  test("lane shuffle forwards scalar consumers", () => {
    const { program, operations, blockId, firstLoadResult, secondLoadResult } =
      adjacentLoadProgramForTest();
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const candidates = discoverSlpCandidates({
      program,
      operations,
      facts: optIrFactSetFromRecords([]),
    });
    const slp = runSlpVectorization({
      nextOperationId: 100,
      nextValueId: 200,
      candidates,
      policy,
    });
    const materialized = materializeSlpVectorization({
      program,
      operations,
      slpResult: slp,
    });
    expect(materialized.operations.some((operation) => operation.kind === "vectorShuffle")).toBe(
      true,
    );
    expect(materialized.valueForwards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceValue: firstLoadResult }),
        expect.objectContaining({ sourceValue: secondLoadResult }),
      ]),
    );

    const function_ = materialized.program.functions.entries()[0];
    if (function_ === undefined) {
      throw new Error("Expected materialized program to contain a function.");
    }
    const operationById = new Map(
      materialized.operations.map((operation) => [operation.operationId, operation]),
    );
    const propagated = runCopyPropagation({
      function: function_,
      operations: operationById,
      valueCopies: materialized.valueForwards.map(
        (forward) => [forward.sourceValue, forward.replacementValue] as const,
      ),
    });
    const shuffleResults = new Set(
      materialized.valueForwards.map((forward) => forward.replacementValue),
    );
    const returnBlock = propagated.function.blocks.find((block) => block.blockId === blockId);
    expect(returnBlock?.terminator?.kind).toBe("return");
    if (returnBlock?.terminator?.kind !== "return") {
      throw new Error("Expected return terminator.");
    }
    for (const valueId of returnBlock.terminator.values) {
      expect(shuffleResults.has(valueId)).toBe(true);
    }
  });

  test("loop materialization replaces safe scalar loads with vector lane forwards", () => {
    const { program, operations, blockId, loadResult } = loopMemoryProgramForTest();
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const loop = runLoopVectorization({
      candidates: [loopVectorizationCandidateForTest()],
      policy,
    });
    const materialized = materializeLoopVectorization({
      program,
      operations,
      loopResult: loop,
    });

    const block = materialized.program.functions
      .entries()[0]
      ?.blocks.find((entry) => entry.blockId === blockId);
    const blockKinds = block?.operations.map(
      (operationId) =>
        materialized.operations.find((operation) => operation.operationId === operationId)?.kind,
    );
    expect(blockKinds).toEqual(["vectorLoad", "vectorShuffle", "memoryStore", "memoryLoad"]);
    expect(materialized.operations.some((operation) => operation.kind === "vectorStore")).toBe(
      false,
    );
    expect(
      materialized.operations.some((operation) => operation.operationId === optIrOperationId(1)),
    ).toBe(false);
    expect(
      materialized.operations.some((operation) => operation.operationId === optIrOperationId(2)),
    ).toBe(true);
    expect(materialized.removedOperationIds).toEqual([optIrOperationId(1)]);
    expect(materialized.valueForwards).toEqual([
      expect.objectContaining({ sourceValue: loadResult }),
    ]);
    const forward = materialized.valueForwards[0];
    if (forward === undefined) {
      throw new Error("Expected loop materialization to forward the scalar load result.");
    }

    const store = materialized.operations.find(
      (operation) => operation.operationId === optIrOperationId(2),
    );
    if (store?.kind !== "memoryStore") {
      throw new Error("Expected scalar store to remain materialized.");
    }
    expect(store.storeValue).toBe(forward.replacementValue);

    const terminator = block?.terminator;
    expect(terminator?.kind).toBe("return");
    if (terminator?.kind !== "return") {
      throw new Error("Expected return terminator.");
    }
    expect(terminator.values).toEqual([forward.replacementValue]);
    expect(
      materialized.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("loop-vectorization:memory-pack-materialized:"),
      ),
    ).toBe(true);
  });

  test("SLP materialization preserves placement for multiple packs in one block", () => {
    const { program, operations, blockId } = eightLoadProgramForTest();
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const slp = runSlpVectorization({
      nextOperationId: 100,
      nextValueId: 200,
      candidates: discoverSlpCandidates({
        program,
        operations,
        facts: optIrFactSetFromRecords([]),
      }),
      policy,
    });
    const materialized = materializeSlpVectorization({
      program,
      operations,
      slpResult: slp,
    });

    const block = materialized.program.functions
      .entries()[0]
      ?.blocks.find((entry) => entry.blockId === blockId);
    const operationKinds = block?.operations.map(
      (operationId) =>
        materialized.operations.find((operation) => operation.operationId === operationId)?.kind,
    );
    expect(operationKinds).toEqual([
      "vectorLoad",
      "vectorShuffle",
      "vectorShuffle",
      "vectorShuffle",
      "vectorShuffle",
      "vectorLoad",
      "vectorShuffle",
      "vectorShuffle",
      "vectorShuffle",
      "vectorShuffle",
    ]);
    expect(block?.operations.includes(optIrOperationId(5))).toBe(false);
    expect(block?.operations.includes(optIrOperationId(8))).toBe(false);
  });

  test("SLP discovery does not pack adjacent loads from different blocks", () => {
    const { program, operations } = splitBlockAdjacentLoadProgramForTest();
    const candidates = discoverSlpCandidates({
      program,
      operations,
      facts: optIrFactSetFromRecords([]),
    });

    expect(candidates).toEqual([]);
  });

  test("SLP discovery does not pack adjacent loads separated by intervening block operations", () => {
    const { program, operations } = interleavedAdjacentLoadProgramForTest();
    const candidates = discoverSlpCandidates({
      program,
      operations,
      facts: optIrFactSetFromRecords([]),
    });

    expect(candidates).toEqual([]);
  });
});
