import { expect, test } from "bun:test";
import { createHirUnitContext, firstExpressionView } from "../../support/hir/typed-hir-fixtures";
import { lowerExpression } from "../../../src/hir/expression-lowerer";
import { descendants } from "../../../src/frontend/ast/syntax-query";
import { SyntaxKind } from "../../../src/frontend";
import {
  MemberAccessExpressionView,
  ObjectLiteralExpressionView,
} from "../../../src/frontend/ast/expression-views";
import { coreTypeId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { hirOriginId } from "../../../src/hir/ids";

function firstObjectLiteralView(context: ReturnType<typeof createHirUnitContext>) {
  const node = descendants(
    context.graph.modules[0]!.tree.root(),
    SyntaxKind.ObjectLiteralExpression,
  )[0]!;
  return ObjectLiteralExpressionView.from(node)!;
}

function firstMemberAccessView(context: ReturnType<typeof createHirUnitContext>) {
  const node = descendants(
    context.graph.modules[0]!.tree.root(),
    SyntaxKind.MemberAccessExpression,
  )[0]!;
  return MemberAccessExpressionView.from(node)!;
}

test("integer literal uses expected integer type", () => {
  const context = createHirUnitContext("fn process() -> u32:\n    return 42\n");
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("u32")),
    context,
  });

  expect(expression.kind.kind).toBe("literal");
  expect(expression.type).toEqual(coreCheckedType(coreTypeId("u32")));
});

test("integer literal outside expected type range emits HIR_INTEGER_LITERAL_OUT_OF_RANGE", () => {
  const context = createHirUnitContext("fn process() -> u8:\n    return 300\n");
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("u8")),
    context,
  });

  expect(expression.kind.kind).toBe("error");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
  );
});

test("binary expression shapes integer literal operands from the opposite integer operand", () => {
  const context = createHirUnitContext("fn process(value: u8) -> bool:\n    return value == 1\n");
  context.locals.addSourceLocal({
    name: "value",
    type: coreCheckedType(coreTypeId("u8")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    introducedBy: "sourceLet",
  });

  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    context,
  });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_BINARY_OPERAND_TYPE_MISMATCH",
  );
  expect(expression.kind.kind).toBe("comparison");
  if (expression.kind.kind !== "comparison") throw new Error("expected comparison");
  expect(expression.kind.right.type).toEqual(coreCheckedType(coreTypeId("u8")));
});

test("name expression uses local scope before semantic references", () => {
  const context = createHirUnitContext("fn process(value: u32) -> u32:\n    return value\n");
  context.locals.addSourceLocal({
    name: "value",
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    introducedBy: "sourceLet",
  });

  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    context,
  });

  expect(expression.kind).toMatchObject({ kind: "name", name: "value" });
});

test("bool literal reports expected type mismatch", () => {
  const context = createHirUnitContext("fn process() -> u32:\n    return true\n");

  lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("u32")),
    context,
  });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_EXPRESSION_TYPE_MISMATCH",
  );
});

test("bool literal lowers from literal syntax", () => {
  const context = createHirUnitContext("fn process() -> bool:\n    return true\n");

  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("bool")),
    context,
  });

  expect(expression.kind).toEqual({
    kind: "literal",
    literal: { kind: "bool", value: true },
  });
  expect(context.diagnostics.entries()).toEqual([]);
});

test("logical and lowers as a bool binary expression", () => {
  const context = createHirUnitContext("fn process() -> bool:\n    return true and false\n");

  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("bool")),
    context,
  });

  expect(expression.kind.kind).toBe("binary");
  if (expression.kind.kind !== "binary") throw new Error("expected binary");
  expect(expression.kind.operator).toBe("and");
  expect(expression.type).toEqual(coreCheckedType(coreTypeId("bool")));
  expect(context.diagnostics.entries()).toEqual([]);
});

test("bitwise and lowers for same-width unsigned operands", () => {
  const context = createHirUnitContext(
    "fn process(left: u32, right: u32) -> u32:\n    return left & right\n",
  );
  context.locals.addSourceLocal({
    name: "left",
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    introducedBy: "sourceLet",
  });
  context.locals.addSourceLocal({
    name: "right",
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(1),
    introducedBy: "sourceLet",
  });

  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("u32")),
    context,
  });

  expect(expression.kind.kind).toBe("binary");
  if (expression.kind.kind !== "binary") throw new Error("expected binary");
  expect(expression.kind.operator).toBe("&");
  expect(expression.type).toEqual(coreCheckedType(coreTypeId("u32")));
  expect(context.diagnostics.entries()).toEqual([]);
});

test("local name reports expected type mismatch", () => {
  const context = createHirUnitContext("fn process(value: bool) -> u32:\n    return value\n");
  context.locals.addSourceLocal({
    name: "value",
    type: coreCheckedType(coreTypeId("bool")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    introducedBy: "sourceLet",
  });

  lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("u32")),
    context,
  });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_EXPRESSION_TYPE_MISMATCH",
  );
});

test("object literal without expected type emits HIR_OBJECT_LITERAL_TYPE_REQUIRED", () => {
  const context = createHirUnitContext("fn process() -> u32:\n    return { value: 1 }\n");
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    context,
  });

  expect(expression.kind.kind).toBe("error");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_OBJECT_LITERAL_TYPE_REQUIRED",
  );
});

test("object literal allows checked private-state declaration construction authority", () => {
  const context = createHirUnitContext(
    "private class Door:\n    value: u32\nfn make() -> Door:\n    { value: 1 }\n",
  );
  const doorType = context.program.types.entries()[0]!.type;
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: doorType,
    context,
  });

  expect(expression.kind.kind).toBe("object");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_FORGED_SEALED_CONSTRUCTION",
  );
});

test("object literal lowers checked fields by FieldId", () => {
  const context = createHirUnitContext(
    "class Packet:\n    value: u32\nfn make() -> Packet:\n    { value: 1 }\n",
  );
  const packetType = context.program.types.entries()[0]!.type;
  const fieldId = context.program.fields.entries()[0]!.fieldId;
  const expression = lowerExpression({
    view: firstObjectLiteralView(context),
    expectedType: packetType,
    context,
  });

  expect(expression.kind.kind).toBe("object");
  if (expression.kind.kind !== "object") throw new Error("expected object");
  expect(expression.kind.fields).toHaveLength(1);
  expect(expression.kind.fields[0]).toMatchObject({ name: "value", fieldId });
});

test("object literal emits HIR_OBJECT_FIELD_TYPE_MISMATCH for missing checked fields", () => {
  const context = createHirUnitContext(
    "class Binding:\n    net0: NetworkDevice\nedge class NetworkDevice:\nfn make() -> Binding:\n    { }\n",
  );
  const bindingType = context.program.types.entries()[0]!.type;
  lowerExpression({
    view: firstObjectLiteralView(context),
    expectedType: bindingType,
    context,
  });

  expect(context.diagnostics.entries()).toContainEqual(
    expect.objectContaining({
      code: "HIR_OBJECT_FIELD_TYPE_MISMATCH",
      stableDetail: "missing:net0",
    }),
  );
});

test("object literal accepts applied source expected type", () => {
  const context = createHirUnitContext("class Box[T]:\nfn make() -> Box[u32]:\n    {}\n");
  const boxType = context.program.functions.entries()[0]!.returnType;
  const expression = lowerExpression({
    view: firstObjectLiteralView(context),
    expectedType: boxType,
    context,
  });

  expect(expression.kind.kind).toBe("object");
  expect(context.diagnostics.entries()).toEqual([]);
});

test("object literal emits HIR_OBJECT_FIELD_TYPE_MISMATCH for checked field mismatches", () => {
  const context = createHirUnitContext(
    "class Packet:\n    value: u32\nfn make() -> Packet:\n    { value: true }\n",
  );
  const packetType = context.program.types.entries()[0]!.type;
  lowerExpression({
    view: firstObjectLiteralView(context),
    expectedType: packetType,
    context,
  });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_OBJECT_FIELD_TYPE_MISMATCH",
  );
});

test("member access does not fall back to ordinary name references", () => {
  const context = createHirUnitContext(
    "class Packet:\n    value: u32\nfn process(packet: Packet) -> u32:\n    return packet.value\n",
  );
  context.locals.addSourceLocal({
    name: "packet",
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    introducedBy: "sourceLet",
  });
  const field = context.program.fields.entries()[0]!;
  const originalLookup = context.referenceLookup;
  Object.assign(context, {
    referenceLookup: {
      ...originalLookup,
      completedMemberForSpan: () => undefined,
      referenceForSpan: (input: Parameters<typeof originalLookup.referenceForSpan>[0]) =>
        input.kind === "fieldName" || input.kind === undefined
          ? {
              kind: "field" as const,
              ownerItemId: field.itemId,
              fieldId: field.fieldId,
            }
          : undefined,
    },
  });

  const expression = lowerExpression({
    view: firstMemberAccessView(context),
    context,
  });

  expect(expression.kind).toEqual({ kind: "error", reason: "missing-member:value" });
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_MEMBER_REFERENCE_MISSING",
  );
});

test("member access on local source type resolves checked field without completed member", () => {
  const context = createHirUnitContext(
    "class Packet:\n    value: u32\nfn process(packet: Packet) -> u32:\n    return packet.value\n",
  );
  const packetType = context.program.types.entries()[0]!.type;
  context.locals.addSourceLocal({
    name: "packet",
    type: packetType,
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    introducedBy: "validationArm",
  });
  const field = context.program.fields.entries()[0]!;
  const originalLookup = context.referenceLookup;
  Object.assign(context, {
    referenceLookup: {
      ...originalLookup,
      completedMemberForSpan: () => undefined,
    },
  });

  const expression = lowerExpression({
    view: firstMemberAccessView(context),
    context,
  });

  expect(expression.kind).toMatchObject({ kind: "member", fieldId: field.fieldId });
  expect(context.diagnostics.entries()).toEqual([]);
});

test("enum case member lowers without requiring enum type as value receiver", () => {
  const context = createHirUnitContext(
    "enum UefiStatus:\n    success\n    bad_buffer_size\nfn process() -> UefiStatus:\n    return UefiStatus.bad_buffer_size\n",
  );
  const expression = lowerExpression({
    view: firstMemberAccessView(context),
    expectedType: context.program.types.entries()[0]!.type,
    context,
  });

  expect(expression.kind).toEqual({
    kind: "literal",
    literal: { kind: "integer", text: "1", value: 1n },
  });
  expect(context.diagnostics.entries()).toEqual([]);
});

test("enum case member lowering reports broken ordinal metadata instead of defaulting to zero", () => {
  const context = createHirUnitContext(
    "enum UefiStatus:\n    success\n    bad_buffer_size\nfn process() -> UefiStatus:\n    return UefiStatus.bad_buffer_size\n",
  );
  const originalIndex = context.index;
  const indexWithoutReferencedCase = Object.create(originalIndex) as typeof originalIndex;
  Object.assign(indexWithoutReferencedCase, {
    items: () =>
      originalIndex
        .items()
        .filter(
          (candidate) => !(candidate.kind === "enumCase" && candidate.name === "bad_buffer_size"),
        ),
  });
  Object.assign(context, {
    index: indexWithoutReferencedCase,
  });

  const expression = lowerExpression({
    view: firstMemberAccessView(context),
    expectedType: context.program.types.entries()[0]!.type,
    context,
  });

  expect(expression.kind.kind).toBe("error");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_MEMBER_REFERENCE_MISMATCH",
  );
});
