import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { functionId, itemId, moduleId, typeId, coreTypeId } from "../../../../src/semantic/ids";
import {
  CheckedProgramBuilder,
  completedMemberKeyString,
} from "../../../../src/semantic/surface/checked-program";
import { sourceCheckedType, coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { SourceText } from "../../../../src/frontend";
import {
  checkedConstructorKindRuleTableFromRecords,
  checkedExternalEntryRootTableFromRecords,
  checkedInstanceEligibilityRuleTableFromRecords,
} from "../../../../src/semantic/surface/mono-closure";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";

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
  expect(program.monoClosureFacts.targetTypeKinds.entries()).toEqual([]);
  expect(program.monoClosureFacts.constructorKindRules.entries()).toEqual([]);
  expect(program.monoClosureFacts.instanceEligibilityRules.entries()).toEqual([]);
  expect(program.monoClosureFacts.externalEntryRoots.entries()).toEqual([]);
});

test("checked mono closure fact tables expose unique get lookups", () => {
  const parameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const eligibility = {
    owner: parameter.owner,
    parameter,
    allowedConcreteKinds: ["Copy" as const],
  };
  const eligibilityTable = checkedInstanceEligibilityRuleTableFromRecords([eligibility]);
  const externalRoot = {
    functionId: functionId(1),
    itemId: itemId(1),
    ownerTypeArguments: [],
    functionTypeArguments: [coreCheckedType(coreTypeId("u8"))],
    reason: "imageEntry" as const,
  };
  const externalRootTable = checkedExternalEntryRootTableFromRecords([externalRoot]);

  expect(eligibilityTable.get(parameter.owner, parameter)).toEqual(eligibility);
  expect(
    eligibilityTable.get(
      { kind: "item", itemId: itemId(2) },
      {
        owner: { kind: "item", itemId: itemId(2) },
        index: 0,
      },
    ),
  ).toBeUndefined();
  expect(externalRootTable.get(functionId(1))).toEqual(externalRoot);
  expect(externalRootTable.get(functionId(99))).toBeUndefined();
  expect(concreteKind("Copy")).toEqual({ kind: "concrete", value: "Copy" });
});

test("semantic mono closure facts do not import HIR ids", () => {
  const source = readFileSync("src/semantic/surface/mono-closure.ts", "utf8");

  expect(source).not.toContain("../../hir/ids");
});

test("constructor kind rules sort source constructors by fixed-width ids", () => {
  const table = checkedConstructorKindRuleTableFromRecords([
    {
      constructor: { kind: "source", typeId: typeId(10) },
      rule: "fieldAggregation",
    },
    {
      constructor: { kind: "source", typeId: typeId(2) },
      rule: "fieldAggregation",
    },
  ]);

  expect(table.entries().map((entry) => entry.constructor)).toEqual([
    { kind: "source", typeId: typeId(2) },
    { kind: "source", typeId: typeId(10) },
  ]);
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
