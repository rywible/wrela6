import { expect, test } from "bun:test";
import { lowerAttemptExpression } from "../../../src/hir/attempt-lowerer";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import { attemptContractForParameter, parameterPlace } from "../../support/hir/typed-hir-fakes";
import { parameterId } from "../../../src/semantic/ids";

test("attempt preserves declared input places from contract", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const expression = lowerAttemptExpression({
    view: undefined,
    fallibleExpression: {
      expressionId: 0 as any,
      place: parameterPlace(parameterId(0)),
      sourceOrigin: 0 as any,
    } as any,
    context,
    contracts: [attemptContractForParameter(parameterId(0))],
  });

  expect(expression.kind.kind).toBe("attempt");
  expect(expression.resourceKind).toEqual({ kind: "concrete", value: "Copy" });
  expect(context.proofMetadata.attempts.entries()).toHaveLength(1);
});

test("attempt without a checked contract lowers fail-closed without metadata", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const expression = lowerAttemptExpression({
    view: undefined,
    fallibleExpression: {
      expressionId: 0 as any,
      place: parameterPlace(parameterId(0)),
      sourceOrigin: 0 as any,
    } as any,
    context,
    contracts: [],
  });

  expect(expression.kind).toEqual({ kind: "error", reason: "attempt-contract-missing" });
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_UNLINKED_ATTEMPT_CONTRACT",
  );
  expect(context.proofMetadata.attempts.entries()).toEqual([]);
});
