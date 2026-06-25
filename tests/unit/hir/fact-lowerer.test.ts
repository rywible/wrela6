import { expect, test } from "bun:test";
import { recordEnsureFact, recordPredicateFact } from "../../../src/hir/fact-lowerer";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import { parameterPlace, successfulCallFake } from "../../support/hir/typed-hir-fakes";
import { functionId, parameterId } from "../../../src/semantic/ids";

test("predicate call creates fact origin without private transition", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  recordPredicateFact({
    call: successfulCallFake({ calleeFunctionId: functionId(1) }),
    predicateFunctionId: functionId(1),
    statePlace: parameterPlace(parameterId(0)),
    context,
  });

  expect(context.proofMetadata.factOrigins.entries().map((fact) => fact.fact?.kind)).toEqual([
    "predicateCall",
  ]);
  expect(context.proofMetadata.privateStateTransitions.entries()).toEqual([]);
});

test("ensure statement creates source fact origin", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  recordEnsureFact({
    candidate: {
      statementId: 0 as any,
      expressionId: 0 as any,
      sourceStatementKind: "ensure",
      sourceOrigin: 0 as any,
    },
    expression: {
      expressionId: 0 as any,
      type: { kind: "core", coreTypeId: "bool" as any },
      sourceOrigin: 0 as any,
    } as any,
    context,
  });

  expect(context.proofMetadata.factOrigins.entries()[0]!.fact?.kind).toBe("ensure");
});
