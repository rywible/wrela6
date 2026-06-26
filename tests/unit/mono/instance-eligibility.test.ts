import { expect, test } from "bun:test";
import { checkInstanceEligibility } from "../../../src/mono/instance-eligibility";
import {
  eligibilityRuleTableFake,
  monoConcretizationContextFake,
  monoSourceTypeWithKind,
  normalizeOk,
} from "../../support/mono/monomorphization-fixtures";
import { functionId, itemId, typeId } from "../../../src/semantic/ids";
import { hirOriginId } from "../../../src/hir/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { sourceCheckedType } from "../../../src/semantic/surface/type-model";

test("explicit eligibility rule rejects disallowed concrete resource kind", () => {
  const result = checkInstanceEligibility({
    owner: { kind: "function", functionId: functionId(4) },
    parameters: [
      { owner: { kind: "function", itemId: itemId(4), functionId: functionId(4) }, index: 0 },
    ],
    arguments: [monoSourceTypeWithKind("Linear")],
    rules: eligibilityRuleTableFake([
      {
        owner: { kind: "function", functionId: functionId(4) },
        parameter: {
          owner: { kind: "function", itemId: itemId(4), functionId: functionId(4) },
          index: 0,
        },
        allowedConcreteKinds: ["Copy"],
        sourceOrigin: hirOriginId(0),
      },
    ]),
    canonicalInstanceKey: "fn:4|owner:<>|fn:<linear>",
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "MONO_INSTANCE_KIND_ELIGIBILITY_FAILED",
    ]);
  }
});

test("eligibility uses mono closure source type kind instead of defaulting to Copy", () => {
  const result = checkInstanceEligibility({
    owner: { kind: "function", functionId: functionId(4) },
    parameters: [
      { owner: { kind: "function", itemId: itemId(4), functionId: functionId(4) }, index: 0 },
    ],
    arguments: [normalizeOk(sourceCheckedType({ itemId: itemId(50), typeId: typeId(50) }))],
    rules: eligibilityRuleTableFake([
      {
        owner: { kind: "function", functionId: functionId(4) },
        parameter: {
          owner: { kind: "function", itemId: itemId(4), functionId: functionId(4) },
          index: 0,
        },
        allowedConcreteKinds: ["Copy"],
        sourceOrigin: hirOriginId(0),
      },
    ]),
    canonicalInstanceKey: "fn:4|owner:<>|fn:<source-unique>",
    context: monoConcretizationContextFake({
      sourceTypeKind: {
        typeId: typeId(50),
        kind: concreteKind("UniqueEdgeRoot"),
        sourceOrigin: hirOriginId(0),
      },
    }),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics[0]?.order.stableDetail).toContain("got:UniqueEdgeRoot");
  }
});
