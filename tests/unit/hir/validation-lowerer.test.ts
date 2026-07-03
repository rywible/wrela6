import { expect, test } from "bun:test";
import { lowerValidationCreation, lowerValidationMatch } from "../../../src/hir/validation-lowerer";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import {
  parameterPlace,
  successfulCallFake,
  validationContractForBuffer,
} from "../../support/hir/typed-hir-fakes";
import { functionId, typeId } from "../../../src/semantic/ids";
import { descendants } from "../../../src/frontend/ast/syntax-query";
import { SyntaxKind } from "../../../src/frontend";
import { MatchStatementView } from "../../../src/frontend/ast/statement-views";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { hirExpressionId } from "../../../src/hir/ids";

test("validation creation records source and pending result places", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const validation = lowerValidationCreation({
    call: {
      ...successfulCallFake({
        calleeFunctionId: functionId(0),
        arguments: [{ expression: {} as any, place: parameterPlace(0 as any) }],
      }),
    },
    context,
    sourceOrigin: 0 as any,
    contracts: [validationContractForBuffer(typeId(1))],
  });

  expect(validation?.sourcePlace.root?.kind).toBe("parameter");
  expect(context.proofMetadata.validations.entries()).toHaveLength(1);
});

test("direct validation call match links by scrutinee expression id", () => {
  const context = createHirUnitContext(
    "fn process():\n    match result:\n        case Ok(packet):\n            packet\n        case Err(status):\n            status\n",
  );
  const expressionId = hirExpressionId(7);
  const contract = validationContractForBuffer(typeId(1));
  const validation = lowerValidationCreation({
    call: {
      ...successfulCallFake({
        calleeFunctionId: functionId(0),
        arguments: [{ expression: {} as any, place: parameterPlace(0 as any) }],
      }),
    },
    validationExpressionId: expressionId,
    context,
    sourceOrigin: 0 as any,
    contracts: [contract],
  });
  const matchNode = descendants(
    context.graph.modules[0]!.tree.root(),
    SyntaxKind.MatchStatement,
  )[0]!;
  const matchView = MatchStatementView.from(matchNode)!;

  const match = lowerValidationMatch({
    view: matchView,
    scrutinee: {
      expressionId,
      kind: { kind: "name", name: "result" },
      type: contract.resultType,
      resourceKind: concreteKind("Copy"),
      sourceOrigin: 0 as any,
    },
    context,
    lowerBlock: ({ sourceOrigin }) => ({ statements: [], sourceOrigin }),
  });

  expect(match?.validation?.validationId).toEqual(validation?.validationId);
  expect(context.diagnostics.entries()).toEqual([]);
});
