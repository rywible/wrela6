import { expect, test } from "bun:test";
import { checkInterfaceConstraint } from "../../../../src/semantic/surface/interface-checker";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { coreTypeId } from "../../../../src/semantic/ids";

test("interface constraint preserves checked type", () => {
  const type = coreCheckedType(coreTypeId("bool"));
  const result = checkInterfaceConstraint({
    interfaceType: type,
    arguments: [],
  });

  expect(result.constraint.interfaceType).toEqual(type);
  expect(result.diagnostics).toEqual([]);
});
