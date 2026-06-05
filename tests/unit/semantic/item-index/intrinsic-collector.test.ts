import { describe, expect, test } from "bun:test";
import {
  functionId,
  intrinsicId,
  itemId,
  moduleId,
  parameterId,
} from "../../../../src/semantic/ids";
import { collectIntrinsicItems } from "../../../../src/semantic/item-index/intrinsic-collector";
import type { IntrinsicCatalog } from "../../../../src/semantic/item-index/intrinsic-catalog";

const testType = { name: ["U8"], arguments: [] } as const;

describe("intrinsic collector", () => {
  test("collects intrinsic functions, types, and parameters deterministically", () => {
    const catalog: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/memory.wr",
          display: "intrinsics/memory.wr",
          declarations: [
            {
              kind: "function",
              intrinsicId: intrinsicId("intrinsics.memory.load"),
              name: "load",
              signature: {
                typeParameters: [],
                parameters: [{ name: "address", type: testType, isConsumed: false }],
                returnType: testType,
              },
              targetAvailability: { targets: ["test"] },
              proofContract: {
                requiredFacts: [],
                consumedCapabilities: [],
                producedCapabilities: [],
              },
              lowering: { backend: "test", operation: "load", attributes: {} },
            },
            {
              kind: "type",
              intrinsicId: intrinsicId("intrinsics.memory.Address"),
              name: "Address",
              signature: { typeParameters: [] },
              targetAvailability: { targets: ["test"] },
              proofContract: {
                requiredFacts: [],
                consumedCapabilities: [],
                producedCapabilities: [],
              },
              lowering: { backend: "test", operation: "type", attributes: {} },
            },
          ],
        },
      ],
    };

    const result = collectIntrinsicItems(catalog, {
      moduleIdOffset: 0,
      itemIdOffset: 0,
      typeIdOffset: 0,
      functionIdOffset: 0,
      imageIdOffset: 0,
      fieldIdOffset: 0,
      parameterIdOffset: 0,
    });
    expect(result.items.map((item) => item.origin)).toEqual(["intrinsic", "intrinsic"]);
    expect(result.typeParameters).toEqual([]);
    expect(result.parameters[0]!.origin).toBe("intrinsic");
    expect((result.parameters[0]! as any).span).toBeUndefined();
    expect(result.functions).toHaveLength(1);
    expect(result.types).toHaveLength(1);
  });

  test("applies offsets correctly", () => {
    const catalog: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/memory.wr",
          display: "intrinsics/memory.wr",
          declarations: [
            {
              kind: "function",
              intrinsicId: intrinsicId("intrinsics.memory.load"),
              name: "load",
              signature: {
                typeParameters: [],
                parameters: [{ name: "address", type: testType, isConsumed: false }],
                returnType: testType,
              },
              targetAvailability: { targets: ["test"] },
              proofContract: {
                requiredFacts: [],
                consumedCapabilities: [],
                producedCapabilities: [],
              },
              lowering: { backend: "test", operation: "load", attributes: {} },
            },
          ],
        },
      ],
    };

    const result = collectIntrinsicItems(catalog, {
      moduleIdOffset: 5,
      itemIdOffset: 10,
      typeIdOffset: 3,
      functionIdOffset: 7,
      imageIdOffset: 0,
      fieldIdOffset: 0,
      parameterIdOffset: 20,
    });

    expect(result.modules[0]!.id).toBe(moduleId(5));
    expect(result.items[0]!.id).toBe(itemId(10));
    expect(result.functions[0]!.id).toBe(functionId(7));
    expect(result.parameters[0]!.id).toBe(parameterId(20));
  });

  test("sorts modules deterministically", () => {
    const catalog: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/z.wr",
          display: "intrinsics/z.wr",
          declarations: [],
        },
        {
          pathKey: "intrinsics/a.wr",
          display: "intrinsics/a.wr",
          declarations: [],
        },
      ],
    };

    const result = collectIntrinsicItems(catalog, {
      moduleIdOffset: 0,
      itemIdOffset: 0,
      typeIdOffset: 0,
      functionIdOffset: 0,
      imageIdOffset: 0,
      fieldIdOffset: 0,
      parameterIdOffset: 0,
    });

    expect(result.modules.map((mod) => mod.pathKey)).toEqual([
      "intrinsics/a.wr",
      "intrinsics/z.wr",
    ]);
  });
});
