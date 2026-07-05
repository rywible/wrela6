import { expect, test } from "bun:test";
import { hirExpressionId, hirLocalId, hirStatementId } from "../../../src/hir/ids";
import {
  createMonoTransformContext,
  monoTransformExpressionId,
  monoTransformLocalId,
  monoTransformRemap,
  monoTransformStatementId,
} from "../../../src/mono/mono-transform-context";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionRemap } from "../../../src/mono/function-instantiator-shell";
import type { MonoResourceKindConcretizationContext } from "../../../src/mono/resource-kind-concretizer";

test("mono transform context owns mutable remap storage and snapshots immutable remaps", () => {
  const instanceId = monoInstanceId("function:1<u8>");
  const sourceLocalId = hirLocalId(1);
  const sourceExpressionId = hirExpressionId(2);
  const originalLocalId = instantiatedHirId(instanceId, sourceLocalId);
  const remap: MonoFunctionRemap = {
    instanceId,
    localRemap: new Map([[sourceLocalId, originalLocalId]]),
    expressionRemap: new Map(),
    statementRemap: new Map(),
    requirementIdRemap: new Map(),
    proofExpressionIdRemap: new Map(),
  };

  const context = createMonoTransformContext({
    remap,
    resourceKinds: {} as MonoResourceKindConcretizationContext,
  });
  const clonedExpressionId = instantiatedHirId(instanceId, sourceExpressionId);
  context.remap.expressionRemap.set(sourceExpressionId, clonedExpressionId);

  expect(context.remap.localRemap).not.toBe(remap.localRemap);
  expect(remap.expressionRemap.get(sourceExpressionId)).toBeUndefined();
  expect(monoTransformRemap(context).expressionRemap.get(sourceExpressionId)).toEqual(
    clonedExpressionId,
  );
});

test("mono transform context allocates local expression and statement ids through one facade", () => {
  const instanceId = monoInstanceId("function:context<u8>");
  const remap: MonoFunctionRemap = {
    instanceId,
    localRemap: new Map(),
    expressionRemap: new Map(),
    statementRemap: new Map(),
    requirementIdRemap: new Map(),
    proofExpressionIdRemap: new Map(),
  };
  const context = createMonoTransformContext({
    remap,
    resourceKinds: {} as MonoResourceKindConcretizationContext,
  });

  const localId = monoTransformLocalId(context, hirLocalId(5));
  const expressionId = monoTransformExpressionId(context, hirExpressionId(7));
  const statementId = monoTransformStatementId(context, hirStatementId(9));

  expect(context.remap.localRemap.get(hirLocalId(5))).toEqual(localId);
  expect(context.remap.expressionRemap.get(hirExpressionId(7))).toEqual(expressionId);
  expect(context.remap.statementRemap.get(hirStatementId(9))).toEqual(statementId);
});
