import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { checkConstructibility } from "../../../src/hir/constructibility";
import { typeId, itemId } from "../../../src/semantic/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import {
  appliedType,
  coreCheckedType,
  sourceCheckedType,
} from "../../../src/semantic/surface/type-model";
import { emptyCheckedConstructibilitySurfaceTable } from "../../../src/semantic/surface/proof-contracts";
import { coreTypeId } from "../../../src/semantic/ids";

test("constructibility rejects private state object literal without authorization", () => {
  const result = checkConstructibility({
    targetType: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
    targetKind: concreteKind("PrivateState"),
    constructorFunctionId: undefined,
    surfaces: emptyCheckedConstructibilitySurfaceTable(),
    sourceOrigin: SourceSpan.from(0, 5),
  });

  expect(result.allowed).toBe(false);
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_FORGED_SEALED_CONSTRUCTION",
  );
});

test("constructibility allows ordinary copy types without explicit surface", () => {
  const result = checkConstructibility({
    targetType: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
    targetKind: concreteKind("Copy"),
    constructorFunctionId: undefined,
    surfaces: emptyCheckedConstructibilitySurfaceTable(),
    sourceOrigin: SourceSpan.from(0, 5),
  });

  expect(result.allowed).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("constructibility rejects applied private source types without authorization", () => {
  const result = checkConstructibility({
    targetType: appliedType({
      constructor: { kind: "source", typeId: typeId(1) },
      arguments: [coreCheckedType(coreTypeId("u32"))],
      resourceKind: concreteKind("PrivateState"),
    }),
    targetKind: concreteKind("PrivateState"),
    constructorFunctionId: undefined,
    surfaces: emptyCheckedConstructibilitySurfaceTable(),
    sourceOrigin: SourceSpan.from(0, 5),
  });

  expect(result.allowed).toBe(false);
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_FORGED_SEALED_CONSTRUCTION",
  );
});
