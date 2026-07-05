import { expect, test } from "bun:test";
import { recordEnsureFact, recordPredicateFact } from "../../../src/hir/fact-lowerer";
import {
  createHirUnitContext,
  createProgramHirUnitContext,
} from "../../support/hir/typed-hir-fixtures";
import { parameterPlace, successfulCallFake } from "../../support/hir/typed-hir-fakes";
import { coreTypeId, functionId, parameterId } from "../../../src/semantic/ids";
import { hirExpressionId, hirOriginId } from "../../../src/hir/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";

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

test("predicate call fact preserves argument identity", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const firstArgument = {
    expressionId: hirExpressionId(10),
    kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
  } as const;
  const secondArgument = {
    ...firstArgument,
    expressionId: hirExpressionId(11),
  };

  recordPredicateFact({
    call: successfulCallFake({
      calleeFunctionId: functionId(1),
      arguments: [
        {
          parameterId: parameterId(0),
          expression: firstArgument,
          place: parameterPlace(parameterId(0)),
        },
        {
          parameterId: parameterId(1),
          expression: secondArgument,
          place: parameterPlace(parameterId(1)),
        },
      ],
    }),
    predicateFunctionId: functionId(1),
    context,
  });

  const fact = context.proofMetadata.factOrigins.entries()[0]?.fact;
  expect(fact?.kind).toBe("predicateCall");
  if (fact?.kind !== "predicateCall") return;
  expect(fact.arguments?.map((argument) => argument.expressionId)).toEqual([
    hirExpressionId(10),
    hirExpressionId(11),
  ]);
});

test("predicate fact without a function owner reports and creates no sentinel metadata", () => {
  const context = createProgramHirUnitContext("fn process():\n    return\n");
  const fact = recordPredicateFact({
    call: successfulCallFake({ calleeFunctionId: functionId(1) }),
    predicateFunctionId: functionId(1),
    statePlace: parameterPlace(parameterId(0)),
    context,
  });

  expect(fact).toBeUndefined();
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_MISSING_OWNER_FUNCTION",
  );
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
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
