import { expect, test } from "bun:test";
import {
  createHirUnitContext,
  firstExpressionView,
  lowerTypedHirForTest,
} from "../../support/hir/typed-hir-fixtures";
import { lowerCallExpression } from "../../../src/hir/call-lowerer";
import { CallExpressionView } from "../../../src/frontend/ast/expression-views";
import {
  appliedType,
  checkedTypeFingerprint,
  coreCheckedType,
  genericParameterCheckedType,
} from "../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { checkedProofSurface } from "../../../src/semantic/surface/proof-surface";
import { CheckedPlatformEnsuredFactSurfaceTableBuilder } from "../../../src/semantic/surface/proof-contracts";
import { platformEnsuredFactSurfaceFake } from "../../support/semantic/semantic-surface-fakes";
import { coreTypeId } from "../../../src/semantic/ids";

test("named arguments lower in checked parameter order", () => {
  const context = createHirUnitContext(
    "fn pair(left: u32, right: u32) -> u32\nfn caller() -> u32:\n    pair(right=2, left=1)\n",
  );
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;
  const call = lowerCallExpression({ view: callView, context });

  expect(call.kind.kind).toBe("call");
  if (call.kind.kind !== "call") throw new Error("expected call expression");
  expect(call.kind.call.arguments.map((argument) => argument.name)).toEqual(["left", "right"]);
});

test("unresolved callee emits HIR_CALL_CALLEE_NOT_FUNCTION", () => {
  const context = createHirUnitContext("fn caller() -> u32:\n    missing()\n");
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;

  lowerCallExpression({ view: callView, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CALL_CALLEE_NOT_FUNCTION",
  );
});

test("argument type mismatches emit HIR_CALL_ARGUMENT_MISMATCH", () => {
  const context = createHirUnitContext(
    "fn accept(value: bool) -> bool\nfn caller() -> bool:\n    accept(1)\n",
  );
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;

  lowerCallExpression({ view: callView, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CALL_ARGUMENT_MISMATCH",
  );
});

test("integer literal arguments use concrete parameter expected types", () => {
  const context = createHirUnitContext(
    "fn accept(value: u64) -> u64\nfn caller() -> u64:\n    accept(0)\n",
  );
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;

  const callExpression = lowerCallExpression({ view: callView, context });

  expect(context.diagnostics.entries()).toEqual([]);
  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind !== "call") throw new Error("expected call expression");
  expect(checkedTypeFingerprint(callExpression.kind.call.arguments[0]!.expression.type)).toBe(
    "core:u64",
  );
});

test("unknown named arguments emit HIR_CALL_ARGUMENT_MISMATCH and recover the call", () => {
  const context = createHirUnitContext(
    "fn pair(left: u32) -> u32\nfn caller() -> u32:\n    pair(right=1)\n",
  );
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;

  const callExpression = lowerCallExpression({ view: callView, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CALL_ARGUMENT_MISMATCH",
  );
  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind !== "call") throw new Error("expected call expression");
  expect(callExpression.kind.call.recovered).toBe(true);
});

test("invalid explicit type argument recovers call and does not mint terminal metadata", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "terminal fn maker[T]() -> T\nfn caller() -> Never:\n    maker[Missing]()\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_EXPLICIT_TYPE_ARGUMENT_NOT_TYPE",
  );
  expect(result.program.proofMetadata.terminalCalls.entries()).toEqual([]);
  expect(result.program.proofMetadata.obligations.entries()).toEqual([]);
  const callExpressions = result.program.functions
    .entries()
    .flatMap((func) => func.bodyIndex?.expressions.entries() ?? [])
    .filter((expression) => expression.kind.kind === "call");
  expect(callExpressions).toContainEqual(
    expect.objectContaining({
      kind: expect.objectContaining({
        kind: "call",
        call: expect.objectContaining({ recovered: true }),
      }),
    }),
  );
});

test("missing argument recovery expression is added to the body index", () => {
  const context = createHirUnitContext(
    "fn target(value: u32) -> u32\nfn caller() -> u32:\n    target(value=)\n",
  );
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;

  const callExpression = lowerCallExpression({ view: callView, context });

  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind !== "call") throw new Error("expected call expression");
  const argumentExpression = callExpression.kind.call.arguments[0]!.expression;
  expect(argumentExpression.kind).toEqual({ kind: "error", reason: "missing-argument" });
  expect(context.bodyIndex.build().expressions.get(argumentExpression.expressionId)).toEqual(
    argumentExpression,
  );
});

test("call callee expression is allocated in the function body index", () => {
  const context = createHirUnitContext("fn target() -> u32\nfn caller() -> u32:\n    target()\n");
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;
  const callExpression = lowerCallExpression({ view: callView, context });

  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind !== "call") throw new Error("expected call expression");
  const indexedExpressionIds = context.bodyIndex
    .build()
    .expressions.entries()
    .map((entry) => entry.expressionId);
  const indexedCalleeExpression = context.bodyIndex
    .build()
    .expressions.get(callExpression.kind.call.callee.expressionId);

  expect(indexedCalleeExpression?.kind.kind).toBe("name");
  expect(new Set(indexedExpressionIds).size).toBe(indexedExpressionIds.length);
});

test("method call records owner type arguments from receiver type", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      `
class Box[T]:
    value: T
    fn get(self) -> T:
        return self.value

fn main(box: Box[u8]) -> u8:
    return box.get()
`,
    ],
  ]);

  const callExpressions = result.program.functions
    .entries()
    .flatMap((func) => func.bodyIndex?.expressions.entries() ?? [])
    .filter((expression) => expression.kind.kind === "call");
  const methodCall = callExpressions.at(-1)!;

  expect(methodCall.kind.kind).toBe("call");
  if (methodCall.kind.kind === "call") {
    expect(methodCall.kind.call.ownerTypeArgumentSource).toBe("receiverType");
    expect(methodCall.kind.call.ownerTypeArguments.map((type) => type.kind)).toEqual(["core"]);
  }
});

test("constructor call records owner type arguments from the expected constructed type", () => {
  const context = createHirUnitContext(
    [
      "class Box[T]:",
      "    value: T",
      "fn make() -> Never",
      "fn caller() -> Never:",
      "    make()",
    ].join("\n"),
  );
  const boxType = context.index.types().find((type) => type.name === "Box");
  const makeFunction = context.index.functions().find((func) => func.name === "make");
  if (boxType === undefined || makeFunction === undefined) {
    throw new Error("expected Box type and make function");
  }
  const existingSignature = context.program.functions.get(makeFunction.id);
  if (existingSignature === undefined) throw new Error("expected make signature");
  const ownerParameter = {
    owner: { kind: "item" as const, itemId: boxType.itemId },
    index: 0,
  };
  const constructorSignature = {
    ...existingSignature,
    ownerItemId: boxType.itemId,
    returnType: appliedType({
      constructor: { kind: "source", typeId: boxType.id },
      arguments: [genericParameterCheckedType(ownerParameter)],
      resourceKind: concreteKind("Copy"),
    }),
    returnKind: concreteKind("Copy"),
    modifiers: { ...existingSignature.modifiers, isConstructor: true },
  };
  const contextWithConstructor = {
    ...context,
    program: {
      ...context.program,
      functions: {
        get: (functionId: typeof makeFunction.id) =>
          functionId === makeFunction.id
            ? constructorSignature
            : context.program.functions.get(functionId),
        entries: () =>
          context.program.functions
            .entries()
            .map((signature) =>
              signature.functionId === makeFunction.id ? constructorSignature : signature,
            ),
      },
    },
  };
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;
  const expectedType = appliedType({
    constructor: { kind: "source", typeId: boxType.id },
    arguments: [coreCheckedType(coreTypeId("u8"))],
    resourceKind: concreteKind("Copy"),
  });

  const callExpression = lowerCallExpression({
    view: callView,
    context: contextWithConstructor,
    expectedType,
  });

  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind === "call") {
    expect(callExpression.kind.call.ownerTypeArgumentSource).toBe("constructorExpectedType");
    expect(callExpression.kind.call.ownerTypeArguments).toEqual([
      coreCheckedType(coreTypeId("u8")),
    ]);
  }
});

test("member call lowers receiver and resolved method callee", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "class Device:",
        "    fn tick(self) -> u32:",
        "        return 1",
        "fn caller(device: Device) -> u32:",
        "    return device.tick()",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_CALL_CALLEE_NOT_FUNCTION",
  );
  const caller = result.program.functions
    .entries()
    .find((entry) => entry.signature.parameters.some((parameter) => parameter.name === "device"));
  const callExpressions =
    caller?.bodyIndex?.expressions
      .entries()
      .filter((expression) => expression.kind.kind === "call") ?? [];

  expect(callExpressions).toHaveLength(1);
  const callExpression = callExpressions[0]!;
  if (callExpression.kind.kind !== "call") throw new Error("expected call");
  expect(callExpression.kind.call.calleeFunctionId).toBeDefined();
  expect(callExpression.kind.call.receiver?.place).toBeDefined();
});

test("explicit generic type application call lowers type arguments", () => {
  const context = createHirUnitContext(
    "fn identity[T](value: T) -> T\nfn caller() -> u32:\n    identity[u32](1)\n",
  );
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;
  const callExpression = lowerCallExpression({ view: callView, context });

  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind !== "call") throw new Error("expected call expression");
  expect(callExpression.kind.call.typeArguments.map(checkedTypeFingerprint)).toEqual(["core:u32"]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_CALL_CALLEE_NOT_FUNCTION",
  );
});

test("explicit type arguments require checked type references", () => {
  const context = createHirUnitContext(
    "fn identity[T](value: T) -> T\nfn caller() -> u32:\n    identity[u32](1)\n",
  );
  const referenceLookup = context.referenceLookup;
  Object.assign(context, {
    referenceLookup: {
      referenceFor: referenceLookup.referenceFor,
      completedMemberFor: referenceLookup.completedMemberFor,
      requirementReferenceFor: referenceLookup.requirementReferenceFor,
      referenceEntryForSpan(input: Parameters<typeof referenceLookup.referenceEntryForSpan>[0]) {
        if (input.kind === "typeName" || input.kind === "typeParameter") return undefined;
        return referenceLookup.referenceEntryForSpan(input);
      },
      referenceForSpan(input: Parameters<typeof referenceLookup.referenceForSpan>[0]) {
        if (input.kind === "typeName" || input.kind === "typeParameter") return undefined;
        return referenceLookup.referenceEntryForSpan(input)?.reference;
      },
      completedMemberForSpan: referenceLookup.completedMemberForSpan,
    },
  });
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;
  const callExpression = lowerCallExpression({ view: callView, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_EXPLICIT_TYPE_ARGUMENT_NOT_TYPE",
  );
  expect(callExpression.kind.kind).toBe("call");
  if (callExpression.kind.kind !== "call") throw new Error("expected call expression");
  expect(callExpression.kind.call.recovered).toBe(true);
});

test("uncertified platform ensured facts emit diagnostic and mint no platform facts", () => {
  const context = createHirUnitContext(
    "fn target() -> Never\nfn caller() -> Never:\n    target()\n",
  );
  const targetFunctionId = context.index.functions().find((func) => func.name === "target")!.id;
  const builder = new CheckedPlatformEnsuredFactSurfaceTableBuilder();
  builder.add(platformEnsuredFactSurfaceFake({ sourceFunctionId: targetFunctionId }));
  Object.assign(context, {
    program: {
      ...context.program,
      proofSurface: checkedProofSurface({ platformEnsuredFacts: builder.build() }),
    },
  });
  const expression = firstExpressionView(context.graph);
  const callView = CallExpressionView.from(expression.node)!;

  lowerCallExpression({ view: callView, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_PLATFORM_ENSURE_NOT_CERTIFIED",
  );
  expect(context.proofMetadata.platformContractEdges.entries()).toEqual([]);
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
});
