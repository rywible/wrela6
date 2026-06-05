import { describe, expect, test } from "bun:test";
import { intrinsicId } from "../../../../src/semantic/ids";
import { stableSerializeIntrinsicDeclaration } from "../../../../src/semantic/item-index/stable-serialization";
import type { IntrinsicCatalog } from "../../../../src/semantic/item-index/intrinsic-catalog";

describe("intrinsic catalog contracts", () => {
  test("stable serialization sorts object keys recursively", () => {
    const left = { b: "two", a: { z: "last", c: "first" } };
    const right = { a: { c: "first", z: "last" }, b: "two" };

    expect(stableSerializeIntrinsicDeclaration(left)).toBe(
      stableSerializeIntrinsicDeclaration(right),
    );
  });

  test("stable serialization handles arrays", () => {
    const left = [{ b: 2 }, { a: 1 }];
    const right = [{ a: 1 }, { b: 2 }];
    // Arrays are not sorted - order is preserved
    expect(stableSerializeIntrinsicDeclaration(left)).not.toBe(
      stableSerializeIntrinsicDeclaration(right),
    );
  });

  test("catalog fake satisfies function and type contracts", () => {
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
                parameters: [
                  {
                    name: "address",
                    type: { name: ["Address"], arguments: [] },
                    isConsumed: false,
                  },
                ],
                returnType: { name: ["U8"], arguments: [] },
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

    expect(catalog.modules[0]!.declarations[0]!.name).toBe("load");
  });

  test("stable serialization handles primitives", () => {
    expect(stableSerializeIntrinsicDeclaration(42)).toBe("42");
    expect(stableSerializeIntrinsicDeclaration("hello")).toBe('"hello"');
    expect(stableSerializeIntrinsicDeclaration(true)).toBe("true");
    expect(stableSerializeIntrinsicDeclaration(null)).toBe("null");
  });
});
