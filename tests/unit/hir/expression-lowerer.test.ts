import { expect, test } from "bun:test";
import {
  createHirUnitContext,
  firstExpressionView,
  lowerTypedHirForTest,
} from "../../support/hir/typed-hir-fixtures";
import { lowerExpression } from "../../../src/hir/expression-lowerer";
import { descendants } from "../../../src/frontend/ast/syntax-query";
import { SyntaxKind } from "../../../src/frontend";
import {
  MemberAccessExpressionView,
  ObjectLiteralExpressionView,
} from "../../../src/frontend/ast/expression-views";
import { coreTypeId } from "../../../src/semantic/ids";
import { coreCheckedType, checkedTypesEqual } from "../../../src/semantic/surface/type-model";
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

test("enum payload construction lowers to HIR constructor", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "enum Result:",
        "    Ok(value: u8)",
        "    Err(error: u16)",
        "",
        "fn wrap(status: u8) -> Result:",
        "    return Result.Ok(value=status)",
      ].join("\n"),
    ],
  ]);

  const constructor = result.program.functions
    .entries()
    .flatMap((func) => func.bodyIndex?.expressions.entries() ?? [])
    .find((expression) => expression.kind.kind === "enumConstructor");

  expect(constructor?.kind.kind).toBe("enumConstructor");
  if (constructor?.kind.kind !== "enumConstructor") return;
  expect(constructor.kind.constructor.caseName).toBe("Ok");
  expect(constructor.kind.constructor.payloadFields.map((field) => field.name)).toEqual(["value"]);
});

test("enum constructor missing-field failure records the returned error expression", () => {
  const context = createHirUnitContext(
    [
      "enum Result:",
      "    Ok(value: u8)",
      "    Err(error: u16)",
      "",
      "fn wrap(status: u8) -> Result:",
      "    return Result.Ok(value=status)",
    ].join("\n"),
  );
  const expectedType = context.program.types.entries()[0]!.type;
  Object.assign(context, {
    program: {
      ...context.program,
      fields: {
        ...context.program.fields,
        get: () => undefined,
      },
    },
  });

  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType,
    context,
  });
  const expressions = context.bodyIndex.build().expressions;

  expect(expression.kind).toEqual({
    kind: "error",
    reason: "enum-constructor-missing-payload-field",
  });
  expect(expressions.get(expression.expressionId)).toEqual(expression);
  expect(context.bodyIndex.nextExpressionId()).not.toBe(expression.expressionId);
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

test("integer literal parse failure emits error HIR instead of zero", () => {
  const context = createHirUnitContext("fn process() -> u64:\n    return 1\n");
  const view = Object.create(firstExpressionView(context.graph)) as ReturnType<
    typeof firstExpressionView
  >;
  Object.assign(view, { literalText: () => "0xg" });

  const expression = lowerExpression({
    view,
    context,
  });

  expect(expression.kind).toEqual({ kind: "error", reason: "invalid-integer-literal" });
  expect(context.diagnostics.entries()).toContainEqual(
    expect.objectContaining({
      code: "HIR_INVALID_INTEGER_LITERAL",
      stableDetail: "0xg",
    }),
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

test("missing name text emits diagnostic with source span and error expression", () => {
  const context = createHirUnitContext("fn process(value: u32) -> u32:\n    return value\n");
  const view = Object.create(firstExpressionView(context.graph)) as ReturnType<
    typeof firstExpressionView
  >;
  Object.assign(view, { nameText: () => undefined });

  const expression = lowerExpression({
    view,
    context,
  });

  expect(expression.kind).toEqual({ kind: "error", reason: "missing-name-text" });
  expect(context.diagnostics.entries()).toContainEqual(
    expect.objectContaining({
      code: "HIR_MISSING_NAME_TEXT",
      span: view.node.span,
      stableDetail: "name",
    }),
  );
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

test("diagnostics that require a function owner report missing owner instead of function zero", () => {
  const context = createHirUnitContext("fn process() -> u32:\n    return true\n");
  Object.assign(context, {
    ownerFunctionId: undefined,
    ownerItemId: undefined,
    ownerModuleId: undefined,
  });

  lowerExpression({
    view: firstExpressionView(context.graph),
    expectedType: coreCheckedType(coreTypeId("u32")),
    context,
  });

  expect(context.diagnostics.entries()).toContainEqual(
    expect.objectContaining({
      code: "HIR_MISSING_OWNER_FUNCTION",
      stableDetail: "HIR_EXPRESSION_TYPE_MISMATCH",
    }),
  );
  expect(
    context.diagnostics.entries().map((diagnostic) => diagnostic.order.ownerKey),
  ).not.toContain("function:0");
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

test("missing object field name text emits diagnostic and excludes unknown empty field", () => {
  const context = createHirUnitContext(
    "class Packet:\n    value: u32\nfn make() -> Packet:\n    { value: 1 }\n",
  );
  const packetType = context.program.types.entries()[0]!.type;
  const view = firstObjectLiteralView(context);
  const fieldView = view.fields()[0]!;
  const fieldViewWithoutName = Object.create(fieldView) as typeof fieldView;
  Object.assign(fieldViewWithoutName, { nameText: () => undefined });
  Object.assign(view, { fields: () => [fieldViewWithoutName] });

  const expression = lowerExpression({
    view,
    expectedType: packetType,
    context,
  });

  expect(expression.kind.kind).toBe("object");
  if (expression.kind.kind !== "object") throw new Error("expected object");
  expect(expression.kind.fields).toHaveLength(0);
  expect(context.diagnostics.entries()).toContainEqual(
    expect.objectContaining({
      code: "HIR_MISSING_NAME_TEXT",
      span: fieldViewWithoutName.node.span,
      stableDetail: "object-field",
    }),
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

test("missing member name text emits diagnostic with source span and error expression", () => {
  const context = createHirUnitContext(
    "class Packet:\n    value: u32\nfn process(packet: Packet) -> u32:\n    return packet.value\n",
  );
  const view = Object.create(firstMemberAccessView(context)) as ReturnType<
    typeof firstMemberAccessView
  >;
  Object.assign(view, { memberName: () => undefined });

  const expression = lowerExpression({
    view,
    context,
  });

  expect(expression.kind).toEqual({ kind: "error", reason: "missing-member-name-text" });
  expect(context.diagnostics.entries()).toContainEqual(
    expect.objectContaining({
      code: "HIR_MISSING_NAME_TEXT",
      span: view.node.span,
      stableDetail: "member",
    }),
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

  expect(expression.kind).toMatchObject({
    kind: "enumConstructor",
    constructor: { caseName: "bad_buffer_size", caseOrdinal: 1, payloadFields: [] },
  });
  expect(context.diagnostics.entries()).toEqual([]);
});

test("fieldless generic enum case adopts expected applied enum type", () => {
  const context = createHirUnitContext(
    [
      "enum Option[Value]:",
      "    some(value: Value)",
      "    none",
      "enum UefiStatus:",
      "    success",
      "fn process() -> Option[UefiStatus]:",
      "    return Option.none",
    ].join("\n"),
  );
  const expectedType = context.program.functions.entries()[0]!.returnType;

  const expression = lowerExpression({
    view: firstMemberAccessView(context),
    expectedType,
    context,
  });

  expect(expression.kind).toMatchObject({
    kind: "enumConstructor",
    constructor: { caseName: "none", payloadFields: [] },
  });
  expect(checkedTypesEqual(expression.type, expectedType)).toBe(true);
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
