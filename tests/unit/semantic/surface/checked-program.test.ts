import { expect, test } from "bun:test";
import { functionId, itemId, moduleId, typeId, coreTypeId } from "../../../../src/semantic/ids";
import {
  CheckedProgramBuilder,
  completedMemberKeyString,
} from "../../../../src/semantic/surface/checked-program";
import { sourceCheckedType, coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { SourceText } from "../../../../src/frontend";

test("checked program tables sort by semantic ids", () => {
  const builder = new CheckedProgramBuilder();
  builder.addType({
    typeId: typeId(2),
    itemId: itemId(2),
    type: sourceCheckedType({ itemId: itemId(2), typeId: typeId(2) }),
  });
  builder.addType({
    typeId: typeId(1),
    itemId: itemId(1),
    type: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
  });

  const program = builder.build();
  expect(program.types.entries().map((entry) => entry.typeId)).toEqual([typeId(1), typeId(2)]);
});

test("checked function lookup returns undefined for missing functions", () => {
  const program = new CheckedProgramBuilder().build();
  expect(program.functions.get(functionId(99))).toBeUndefined();
});

test("checked program builder builds empty program", () => {
  const program = new CheckedProgramBuilder().build();
  expect(program.types.entries()).toEqual([]);
  expect(program.functions.entries()).toEqual([]);
  expect(program.fields.entries()).toEqual([]);
  expect(program.genericParameters.entries()).toEqual([]);
  expect(program.completedMembers.entries()).toEqual([]);
  expect(program.certifiedPlatformBindings.entries()).toEqual([]);
});

test("completedMemberKeyString produces deterministic key", () => {
  const source = SourceText.from("main.wr", "abc");
  const key = {
    moduleId: moduleId(0),
    span: source.span(0, 3),
    kind: "memberName" as const,
    ordinal: 1,
  };
  expect(completedMemberKeyString(key)).toBe("0:0:3:memberName:1");
});

test("checked type table preserves added records", () => {
  const builder = new CheckedProgramBuilder();
  builder.addType({
    typeId: typeId(5),
    itemId: itemId(3),
    type: coreCheckedType(coreTypeId("u32")),
  });
  const program = builder.build();
  const record = program.types.get(typeId(5));
  expect(record).toBeDefined();
  expect(record!.typeId).toBe(typeId(5));
});
