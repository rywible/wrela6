import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

test("validated buffer lowering preserves field roles", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "validated buffer Packet:\n    params:\n        bytes: Bytes\n    layout:\n        kind: U8 @ 0\n",
    ],
  ]);

  const buffer = result.program.validatedBuffers.entries()[0]!;
  expect(buffer.parameterFields).toHaveLength(1);
  expect(buffer.layoutFields).toHaveLength(1);
});

test("validated buffer lowering preserves declaration requirements", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "validated buffer Packet:\n    params:\n        bytes: u32\n    require:\n        bytes > 0\n",
    ],
  ]);

  const buffer = result.program.validatedBuffers.entries()[0]!;
  expect(buffer.requirements).toHaveLength(1);
  expect(buffer.requirements[0]!.expression).toEqual({ kind: "opaque", text: "bytes > 0" });
});
