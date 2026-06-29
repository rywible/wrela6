import { describe, expect, test } from "bun:test";

import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFactId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  eraseProofOnlyOptIrForTest,
  type OptIrProofErasureFact,
} from "../../../src/opt-ir/lower/proof-erasure";
import {
  optIrIntegerBinaryOperation,
  optIrProofErasedMarkerOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { runConstructionCleanup } from "../../../src/opt-ir/passes/cleanup";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { coreTypeId, functionId, itemId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";

const integer32 = optIrSignedIntegerType(32);

describe("OptIR proof erasure", () => {
  test("removes proof-only operations after imported erasure facts and records provenance", () => {
    const proofOperation = proofMarker(1, "range-proof");
    const runtimeOperation = addOperation(2, 20, 3, 4);
    const erasureFact = fact(1, { kind: "value", valueId: optIrValueId(10) }, []);

    const result = eraseProofOnlyOptIrForTest({
      function: functionWithOperations([proofOperation.operationId, runtimeOperation.operationId]),
      operations: [proofOperation, runtimeOperation],
      facts: [erasureFact],
      factImportCompleted: true,
      proofOnlyValueIds: [optIrValueId(10)],
      proofOnlyOperationIds: [proofOperation.operationId],
      proofValueFacts: [[optIrValueId(10), erasureFact.factId]],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      runtimeOperation.operationId,
    ]);
    expect(result.function.blocks[0]?.operations).toEqual([runtimeOperation.operationId]);
    expect(result.provenance.erasedValues).toEqual([
      {
        valueId: optIrValueId(10),
        factIds: [erasureFact.factId],
        operationIds: [proofOperation.operationId],
        originIds: [proofOperation.originId],
      },
    ]);
  });

  test("refuses to erase before fact import has completed", () => {
    const result = eraseProofOnlyOptIrForTest({
      function: functionWithOperations([]),
      operations: [],
      facts: [],
      factImportCompleted: false,
      proofOnlyValueIds: [optIrValueId(10)],
      proofOnlyOperationIds: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected proof erasure to reject pre-import execution.");
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "OPT_IR_INPUT_CONTRACT_INVALID",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual([
      "fact-import",
    ]);
  });

  test("preserves facts depending on erased values only through valid lineage", () => {
    const proofOperation = proofMarker(1, "bounds-proof");
    const erasureFact = fact(1, { kind: "value", valueId: optIrValueId(10) }, []);
    const dependentFact = fact(2, { kind: "value", valueId: optIrValueId(20) }, [
      { kind: "value", valueId: optIrValueId(10) },
    ]);
    const orphanFact = fact(3, { kind: "value", valueId: optIrValueId(30) }, [
      { kind: "value", valueId: optIrValueId(11) },
    ]);

    const result = eraseProofOnlyOptIrForTest({
      function: functionWithOperations([proofOperation.operationId]),
      operations: [proofOperation],
      facts: [erasureFact, dependentFact, orphanFact],
      factImportCompleted: true,
      proofOnlyValueIds: [optIrValueId(10), optIrValueId(11)],
      proofOnlyOperationIds: [proofOperation.operationId],
      proofValueFacts: [[optIrValueId(10), erasureFact.factId]],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.facts.map((preservedFact) => preservedFact.factId)).toEqual([
      erasureFact.factId,
      dependentFact.factId,
    ]);
    expect(result.droppedFacts).toEqual([{ factId: orphanFact.factId, reason: "missingLineage" }]);
    expect(result.facts[1]?.lineage).toEqual({
      kind: "proofErasurePreserved",
      sourceFactId: dependentFact.factId,
      erasedValueIds: [optIrValueId(10)],
    });
  });

  test("fails when executable operations still depend on an erased value", () => {
    const runtimeOperation = addOperation(2, 20, 10, 4);
    const erasureFact = fact(1, { kind: "value", valueId: optIrValueId(10) }, []);

    const result = eraseProofOnlyOptIrForTest({
      function: functionWithOperations([runtimeOperation.operationId]),
      operations: [runtimeOperation],
      facts: [erasureFact],
      factImportCompleted: true,
      proofOnlyValueIds: [optIrValueId(10)],
      proofOnlyOperationIds: [],
      proofValueFacts: [[optIrValueId(10), erasureFact.factId]],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected proof erasure to reject executable erased-value use.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "operation:2:operand:10",
    ]);
  });

  test("fails when executable terminators or edge arguments still depend on erased values", () => {
    const erasedValue = optIrValueId(10);
    const functionInput = functionWithBlocks({
      blocks: [
        {
          blockId: optIrBlockId(1),
          parameters: [],
          operations: [],
          terminator: {
            kind: "branch",
            operationId: optIrOperationId(50),
            condition: erasedValue,
            trueEdge: optIrEdgeId(1),
            falseEdge: optIrEdgeId(2),
            originId: optIrOriginId(1),
          },
          originId: optIrOriginId(1),
        },
      ],
      edges: [
        edgeForTest({
          edgeId: optIrEdgeId(1),
          from: optIrBlockId(1),
          toBlock: optIrBlockId(1),
          arguments: [erasedValue],
        }),
      ],
    });

    const result = eraseProofOnlyOptIrForTest({
      function: functionInput,
      operations: [],
      facts: [fact(1, { kind: "value", valueId: erasedValue }, [])],
      factImportCompleted: true,
      proofOnlyValueIds: [erasedValue],
      proofOnlyOperationIds: [],
      proofValueFacts: [[erasedValue, optIrFactId(1)]],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected proof erasure to reject executable erased-value use.");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "edge:1:argument:10",
      "terminator:50:value:10",
    ]);
  });

  test("construction cleanup removes proof scaffolding and keeps fact indexes consistent", () => {
    const proofOperation = proofMarker(1, "");
    const runtimeOperation = addOperation(2, 20, 3, 4);
    const liveFact = fact(2, { kind: "value", valueId: optIrValueId(20) }, []);
    const proofFact = fact(3, { kind: "operation", operationId: proofOperation.operationId }, []);

    const result = runConstructionCleanup({
      function: functionWithOperations([proofOperation.operationId, runtimeOperation.operationId]),
      operations: [proofOperation, runtimeOperation],
      facts: [liveFact, proofFact],
    });

    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      runtimeOperation.operationId,
    ]);
    expect(result.function.blocks[0]?.operations).toEqual([runtimeOperation.operationId]);
    expect(result.facts.records.map((record) => record.factId)).toEqual([liveFact.factId]);
    expect(result.facts.indexes.byId[Number(liveFact.factId)]?.factId).toBe(liveFact.factId);
    expect(result.facts.indexes.bySubjectKey["value:20"]).toEqual([liveFact.factId]);
    expect(result.facts.indexes.bySubjectKey["operation:1"]).toBeUndefined();
  });

  test("construction cleanup prunes blocks unreachable through actual terminators", () => {
    const proofOperation = proofMarker(1, "");
    const liveOperation = addOperation(2, 20, 3, 4);
    const unreachableOperation = addOperation(3, 21, 5, 6);
    const functionInput = functionWithBlocks({
      blocks: [
        blockWithReturn(optIrBlockId(1), [proofOperation.operationId, liveOperation.operationId]),
        blockWithReturn(optIrBlockId(2), [unreachableOperation.operationId]),
      ],
      edges: [
        edgeForTest({
          edgeId: optIrEdgeId(1),
          from: optIrBlockId(1),
          toBlock: optIrBlockId(2),
          arguments: [],
        }),
      ],
    });
    const unreachableFact = fact(
      4,
      {
        kind: "operation",
        operationId: unreachableOperation.operationId,
      },
      [],
    );

    const result = runConstructionCleanup({
      function: functionInput,
      operations: [proofOperation, liveOperation, unreachableOperation],
      facts: [fact(2, { kind: "value", valueId: optIrValueId(20) }, []), unreachableFact],
    });

    expect(result.function.blocks.map((block) => block.blockId)).toEqual([optIrBlockId(1)]);
    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      liveOperation.operationId,
    ]);
    expect(result.removedOperationIds).toEqual([
      proofOperation.operationId,
      unreachableOperation.operationId,
    ]);
    expect(result.removedFactIds).toEqual([unreachableFact.factId]);
    expect(result.facts.indexes.bySubjectKey["operation:3"]).toBeUndefined();
  });
});

function proofMarker(operationId: number, erasedProof: string): OptIrOperation {
  return optIrProofErasedMarkerOperation({
    operationId: optIrOperationId(operationId),
    erasedProof,
    originId: optIrOriginId(operationId),
  });
}

function addOperation(
  operationId: number,
  resultId: number,
  left: number,
  right: number,
): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    left: optIrValueId(left),
    right: optIrValueId(right),
    operator: "add",
    resultType: integer32,
    originId: optIrOriginId(operationId),
  });
}

function fact(
  factId: number,
  subject: OptIrProofErasureFact["subject"],
  dependencies: OptIrProofErasureFact["dependencies"],
): OptIrProofErasureFact {
  return {
    factId: optIrFactId(factId),
    subject,
    dependencies,
    lineage: { kind: "imported" },
  };
}

function functionWithOperations(operationIds: readonly ReturnType<typeof optIrOperationId>[]) {
  const block: OptIrBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operationIds,
    originId: optIrOriginId(1),
  };
  const functionInput: OptIrFunction = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test.instance"),
    signature: signatureForTest(),
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId: optIrOriginId(1),
  };
  return functionInput;
}

function functionWithBlocks(input: {
  readonly blocks: readonly OptIrBlock[];
  readonly edges?: readonly OptIrEdge[];
}): OptIrFunction {
  return {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test.instance"),
    signature: signatureForTest(),
    blocks: input.blocks,
    edges: optIrCfgEdgeTable(input.edges ?? []),
    entryBlock: input.blocks[0]?.blockId ?? optIrBlockId(1),
    originId: optIrOriginId(1),
  };
}

function blockWithReturn(
  blockId: ReturnType<typeof optIrBlockId>,
  operationIds: readonly ReturnType<typeof optIrOperationId>[],
): OptIrBlock {
  return {
    blockId,
    parameters: [],
    operations: operationIds,
    terminator: {
      kind: "return",
      operationId: optIrOperationId(Number(blockId) + 100),
      values: [],
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
}

function edgeForTest(input: {
  readonly edgeId: ReturnType<typeof optIrEdgeId>;
  readonly from: ReturnType<typeof optIrBlockId>;
  readonly toBlock: ReturnType<typeof optIrBlockId>;
  readonly arguments: readonly ReturnType<typeof optIrValueId>[];
}): OptIrEdge {
  return {
    edgeId: input.edgeId,
    from: input.from,
    toBlock: input.toBlock,
    ordinal: Number(input.edgeId),
    kind: "normal",
    arguments: input.arguments,
    originId: optIrOriginId(1),
  };
}

function signatureForTest(): MonoFunctionSignature {
  return {
    functionId: functionId(1),
    itemId: itemId(1),
    parameters: [],
    returnType: monoCheckedTypeForTest("Never"),
    returnKind: "Never",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}

function monoCheckedTypeForTest(name: string): MonoCheckedType {
  return coreCheckedType(coreTypeId(name)) as MonoCheckedType;
}
