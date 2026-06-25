import { expect, test } from "bun:test";
import { lowerValidationCreation } from "../../../src/hir/validation-lowerer";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import {
  parameterPlace,
  successfulCallFake,
  validationContractForBuffer,
} from "../../support/hir/typed-hir-fakes";
import { functionId, typeId } from "../../../src/semantic/ids";

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
