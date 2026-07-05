import { expect, test } from "bun:test";
import { coreTypeId } from "../../../src/semantic/ids";
import { lowerExpression } from "../../../src/hir/expression-lowerer";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { createHirUnitContext, firstExpressionView } from "../../support/hir/typed-hir-fixtures";

test("unconstrained integer literals default to u64", () => {
  const context = createHirUnitContext("fn value() -> u64:\n    return 4294967296\n");
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    context,
  });

  expect(expression.type).toEqual(coreCheckedType(coreTypeId("u64")));
  expect(context.diagnostics.sorted().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
  );
});

test("annotated u32 integer overflow still emits a range diagnostic", () => {
  const context = createHirUnitContext("fn value() -> u32:\n    return 4294967296\n");
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    context,
    expectedType: coreCheckedType(coreTypeId("u32")),
  });

  expect(expression.kind.kind).toBe("error");
  expect(context.diagnostics.sorted().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
  );
});
