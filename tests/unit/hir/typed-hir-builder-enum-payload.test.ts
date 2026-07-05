import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

test("typed HIR enum cases include ordered payload field ids", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "enum Result:\n    Ok(value: u8)\n    Err(error: u16)\n"],
  ]);

  const enumType = result.program.types.entries().find((record) => record.sourceKind === "enum");
  expect(enumType).toBeDefined();
  const fieldsById = new Map(
    result.program.fields.entries().map((field) => [field.fieldId, field.name]),
  );

  expect(
    enumType!.enumCases.map((caseRecord) => ({
      name: caseRecord.name,
      payloadFields: caseRecord.payloadFieldIds.map((fieldId) => fieldsById.get(fieldId)),
    })),
  ).toEqual([
    { name: "Ok", payloadFields: ["value"] },
    { name: "Err", payloadFields: ["error"] },
  ]);
});
