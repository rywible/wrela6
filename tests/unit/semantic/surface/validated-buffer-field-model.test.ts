import { describe, expect, test } from "bun:test";
import { semanticSurfaceForHirTest } from "../../../support/hir/typed-hir-fixtures";

describe("validated buffer field model", () => {
  test("builds canonical section order and roles on checked program", () => {
    const result = semanticSurfaceForHirTest([
      [
        "main.wr",
        [
          "validated buffer Packet:",
          "    derive:",
          "        version: u8",
          "            0 -> 1",
          "            otherwise -> 2",
          "    layout:",
          "        payload: u8 @ 0",
          "    params:",
          "        expected_len: u16",
        ].join("\n"),
      ],
    ]);

    const packetType = result.program.types.entries().find((typeRecord) => {
      const itemFields = result.program.fields
        .entries()
        .filter((field) => field.itemId === typeRecord.itemId);
      return itemFields.some((field) => field.fieldRole === "layoutField");
    });
    if (packetType === undefined) throw new Error("expected Packet type");

    const model = result.program.validatedBufferFields.get(packetType.typeId);
    expect(model).toBeDefined();
    if (model === undefined) return;

    expect(model.parameterFieldIds).toHaveLength(1);
    expect(model.layoutFieldIds).toHaveLength(1);
    expect(model.derivedFieldIds).toHaveLength(1);
    expect(model.layoutDerivedFieldOrder.map(String)).toEqual([
      String(model.derivedFieldIds[0]),
      String(model.layoutFieldIds[0]),
    ]);

    const deriveDescriptor = model.fields.find((field) => field.section === "derive");
    expect(deriveDescriptor?.surfaceOrdinal).toBe(0);
    expect(deriveDescriptor?.bodyOrdinal).toBe(0);
  });
});
