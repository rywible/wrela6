import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { hirOriginId } from "../../../src/hir/ids";
import { optIrBlockId } from "../../../src/opt-ir/ids";
import { lowerCheckedMirSkeletonForTest } from "../../../src/opt-ir/lower/lower-checked-mir";
import { optIrUnsignedIntegerType, optIrZeroSizedType } from "../../../src/opt-ir/types";
import { coreTypeId, functionId, itemId, targetId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../src/shared/source-span";
import { proofMirOriginId } from "../../../src/proof-mir/ids";

describe("OptIR checked MIR skeleton construction", () => {
  test("lowers functions, blocks, edges, parameters, proof-only values, and provenance in checked MIR order", () => {
    const result = lowerCheckedMirSkeletonForTest({
      targetId: targetId("test-target"),
      functions: [
        {
          functionInstanceId: monoInstanceId("mono:second"),
          signature: signatureForTest(2),
          origin: {
            source: { file: "input.wrela", span: { start: 30, end: 40 } },
            hir: { originId: hirOriginId(30) },
            proofMirOriginId: proofMirOriginId(30),
          },
          blocks: [
            {
              blockKey: "entry",
              origin: { proofMirOriginId: proofMirOriginId(31) },
              parameters: [
                {
                  valueKey: "packet",
                  type: optIrUnsignedIntegerType(64),
                  role: "entry",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(32) },
                },
              ],
              edges: [],
            },
          ],
        },
        {
          functionInstanceId: monoInstanceId("mono:first"),
          signature: signatureForTest(1),
          origin: {
            source: { file: "input.wrela", span: { start: 0, end: 29 } },
            hir: { originId: hirOriginId(1) },
            proofMirOriginId: proofMirOriginId(1),
          },
          blocks: [
            {
              blockKey: "entry",
              origin: { proofMirOriginId: proofMirOriginId(2) },
              parameters: [
                {
                  valueKey: "packet",
                  type: optIrUnsignedIntegerType(64),
                  role: "entry",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(3) },
                },
                {
                  valueKey: "proof-token",
                  type: optIrZeroSizedType("proof-token"),
                  role: "entry",
                  runtime: false,
                  proofOnlyReason: "factToken",
                  origin: { proofMirOriginId: proofMirOriginId(4) },
                },
              ],
              edges: [
                {
                  edgeKey: "entry-to-header",
                  toBlockKey: "header",
                  kind: "normal",
                  argumentValueKeys: ["packet", "limit"],
                  origin: { proofMirOriginId: proofMirOriginId(5) },
                },
              ],
            },
            {
              blockKey: "header",
              origin: { proofMirOriginId: proofMirOriginId(6) },
              merge: "loopHeader",
              parameters: [
                {
                  valueKey: "packet",
                  type: optIrUnsignedIntegerType(64),
                  role: "entry",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(7) },
                },
                {
                  valueKey: "limit",
                  type: optIrUnsignedIntegerType(32),
                  role: "loopCarried",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(8) },
                },
              ],
              edges: [
                {
                  edgeKey: "header-to-join",
                  toBlockKey: "join",
                  kind: "branchTrue",
                  argumentValueKeys: ["limit"],
                  origin: { proofMirOriginId: proofMirOriginId(9) },
                },
              ],
            },
            {
              blockKey: "join",
              origin: { proofMirOriginId: proofMirOriginId(10) },
              parameters: [
                {
                  valueKey: "limit",
                  type: optIrUnsignedIntegerType(32),
                  role: "branchArgument",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(11) },
                },
              ],
              edges: [],
            },
          ],
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const functions = result.program.functions.entries();
    expect(functions.map((function_) => function_.monoInstanceId)).toEqual([
      monoInstanceId("mono:second"),
      monoInstanceId("mono:first"),
    ]);
    expect(result.valueIdsByKey.get("mono:second/packet")).not.toBe(
      result.valueIdsByKey.get("mono:first/packet"),
    );

    const lowered = requireValue(functions[1], "Expected second lowered function.");
    expect(lowered.blocks.map((block) => block.blockId)).toEqual([
      optIrBlockId(1),
      optIrBlockId(2),
      optIrBlockId(3),
    ]);
    expect(lowered.blocks.map((block) => block.parameters.length)).toEqual([2, 2, 1]);

    const header = requireValue(lowered.blocks[1], "Expected lowered header block.");
    expect(header.parameters.map((parameter) => parameter.incomingRole)).toEqual([
      "entry",
      "loopCarried",
    ]);

    const join = requireValue(lowered.blocks[2], "Expected lowered join block.");
    expect(join.parameters.map((parameter) => parameter.incomingRole)).toEqual(["branchArgument"]);

    for (const edge of lowered.edges.entries()) {
      const successor = lowered.blocks.find((block) => block.blockId === edge.toBlock);
      expect(edge.arguments.length).toBe(successor?.parameters.length ?? 0);
    }

    const proofTokenValueId = result.valueIdsByKey.get("mono:first/proof-token");
    expect(proofTokenValueId).toBeDefined();
    if (proofTokenValueId === undefined) {
      return;
    }

    expect(result.executableValueIds).not.toContain(proofTokenValueId);
    expect(result.proofOnlyValueIds).toContain(proofTokenValueId);
    expect(result.valuesMarkedForErasure).toEqual([
      expect.objectContaining({ reason: "factToken", valueId: proofTokenValueId }),
    ]);

    const functionOrigin = result.origins.get(lowered.originId);
    expect(functionOrigin).toMatchObject({
      source: { file: "input.wrela", span: { start: 0, end: 29 } },
      hir: { originId: hirOriginId(1) },
      mono: { functionInstanceId: monoInstanceId("mono:first") },
      proofMirNode: { kind: "node", nodeKey: "origin:1" },
      checkedMir: {
        functionInstanceId: monoInstanceId("mono:first"),
        nodeKey: "function:mono:first",
      },
    });

    const firstEdge = requireValue(lowered.edges.entries()[0], "Expected lowered edge.");
    const edgeOrigin = result.origins.get(firstEdge.originId);
    expect(edgeOrigin).toMatchObject({
      proofMirNode: { kind: "node", nodeKey: "origin:5" },
      checkedMir: { functionInstanceId: "mono:first", nodeKey: "edge:entry-to-header" },
    });

    const joinParameter = requireValue(join.parameters[0], "Expected lowered join parameter.");
    const parameterOrigin = result.origins.get(joinParameter.originId);
    expect(parameterOrigin).toMatchObject({
      proofMirNode: { kind: "node", nodeKey: "origin:11" },
      checkedMir: {
        functionInstanceId: monoInstanceId("mono:first"),
        nodeKey: "parameter:join:limit",
      },
    });
  });

  test("rejects proof-only and unknown values as edge arguments before lowering", () => {
    const result = lowerCheckedMirSkeletonForTest({
      targetId: targetId("test-target"),
      functions: [
        {
          functionInstanceId: monoInstanceId("mono:invalid-edge"),
          signature: signatureForTest(3),
          origin: { proofMirOriginId: proofMirOriginId(40) },
          blocks: [
            {
              blockKey: "entry",
              origin: { proofMirOriginId: proofMirOriginId(41) },
              parameters: [
                {
                  valueKey: "proof-token",
                  type: optIrZeroSizedType("proof-token"),
                  role: "entry",
                  runtime: false,
                  origin: { proofMirOriginId: proofMirOriginId(42) },
                },
              ],
              edges: [
                {
                  edgeKey: "bad-edge",
                  toBlockKey: "join",
                  kind: "normal",
                  argumentValueKeys: ["proof-token", "missing"],
                  origin: { proofMirOriginId: proofMirOriginId(43) },
                },
              ],
            },
            {
              blockKey: "join",
              origin: { proofMirOriginId: proofMirOriginId(44) },
              parameters: [
                {
                  valueKey: "runtime-value",
                  type: optIrUnsignedIntegerType(32),
                  role: "branchArgument",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(45) },
                },
                {
                  valueKey: "other-runtime-value",
                  type: optIrUnsignedIntegerType(32),
                  role: "branchArgument",
                  runtime: true,
                  origin: { proofMirOriginId: proofMirOriginId(46) },
                },
              ],
              edges: [],
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      kind: "error",
      diagnostics: [
        "edge:bad-edge:proof-only-argument:proof-token",
        "edge:bad-edge:unknown-argument:missing",
      ],
    });
  });
});

function signatureForTest(id: number): MonoFunctionSignature {
  return {
    functionId: functionId(id),
    itemId: itemId(id),
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
    sourceSpan: SourceSpan.from(id, id),
  };
}

function monoCheckedTypeForTest(name: string): MonoCheckedType {
  return coreCheckedType(coreTypeId(name)) as MonoCheckedType;
}

function requireValue<Value>(value: Value | undefined, message: string): Value {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
