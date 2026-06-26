import { expect, test } from "bun:test";
import { itemId, targetTypeId, typeId } from "../../../src/semantic/ids";
import { hirOriginId } from "../../../src/hir/ids";
import {
  concreteKind,
  derivedKind,
  errorKind,
  joinConcreteResourceKinds,
  parametricKind,
} from "../../../src/semantic/surface/resource-kind";
import { buildMonoSubstitution } from "../../../src/mono/substitution";
import { normalizeMonoCheckedType } from "../../../src/mono/instantiation-key";
import {
  appliedSourceTypeForMonoTest,
  monoConcretizationContextFake,
  monoCoreType,
  normalizeOk,
} from "../../support/mono/monomorphization-fixtures";
import {
  concretizeMonoCheckedTypeResourceKind,
  concretizeResourceKind,
} from "../../../src/mono/resource-kind-concretizer";
import { appliedType, sourceCheckedType } from "../../../src/semantic/surface/type-model";

test("applied constructor uses HIR constructor rule instead of ordinary join", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("appliedConstructor", [concreteKind("Copy")]),
    appliedType: appliedSourceTypeForMonoTest({
      sourceTypeId: typeId(7),
      argumentKinds: [concreteKind("Copy")],
    }),
    context: monoConcretizationContextFake({
      constructorRule: {
        constructor: { kind: "source", typeId: typeId(7) },
        rule: "appliedConstructor",
        resultKind: concreteKind("ValidatedBuffer"),
        sourceOrigin: hirOriginId(0),
      },
    }),
  });

  expect(result).toEqual({ kind: "ok", value: "ValidatedBuffer" });
});

test("target declared kind requires HIR target kind data", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("targetDeclared", []),
    targetTypeId: targetTypeId("mmio-register"),
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_MISSING_TARGET_TYPE_KIND");
  }
});

test("concrete kind passes through", () => {
  const result = concretizeResourceKind({
    kind: concreteKind("Linear"),
    context: monoConcretizationContextFake(),
  });

  expect(result).toEqual({ kind: "ok", value: "Linear" });
});

test("error kind produces closure diagnostic", () => {
  const result = concretizeResourceKind({
    kind: errorKind(),
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_UNRESOLVED_RESOURCE_KIND");
  }
});

test("join rule combines argument kinds", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("join", [concreteKind("Copy"), concreteKind("Affine")]),
    context: monoConcretizationContextFake(),
  });

  expect(result).toEqual({
    kind: "ok",
    value: joinConcreteResourceKinds(["Copy", "Affine"]),
  });
});

test("parametric kind resolves through substitution and uses the argument type's kind", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const result = buildMonoSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [monoCoreType("u8")],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });
  if (result.kind !== "ok") throw new Error("expected ok");

  const concretized = concretizeResourceKind({
    kind: parametricKind(ownerParameter),
    context: monoConcretizationContextFake({ substitution: result.substitution }),
  });

  expect(concretized).toEqual({ kind: "ok", value: "Copy" });
});

test("core Never type yields Never through parametric resolution", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(2) }, index: 0 };
  const substitutionResult = buildMonoSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [monoCoreType("Never")],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });
  if (substitutionResult.kind !== "ok") throw new Error("expected ok");

  const result = concretizeResourceKind({
    kind: parametricKind(ownerParameter),
    context: monoConcretizationContextFake({ substitution: substitutionResult.substitution }),
  });

  expect(result).toEqual({ kind: "ok", value: "Never" });
});

test("source type replacement resolves through contextual source kind table", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(3) }, index: 0 };
  const sourceType = normalizeOk(sourceCheckedType({ itemId: itemId(30), typeId: typeId(30) }));
  const substitutionResult = buildMonoSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [sourceType],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });
  if (substitutionResult.kind !== "ok") throw new Error("expected ok");

  const result = concretizeResourceKind({
    kind: parametricKind(ownerParameter),
    context: monoConcretizationContextFake({
      substitution: substitutionResult.substitution,
      sourceTypeKind: {
        typeId: typeId(30),
        kind: concreteKind("Affine"),
        sourceOrigin: hirOriginId(0),
      },
    }),
  });

  expect(result).toEqual({ kind: "ok", value: "Affine" });
});

test("field aggregation rule defers to the injected field kind provider", () => {
  const applied = appliedSourceTypeForMonoTest({
    sourceTypeId: typeId(11),
    argumentKinds: [concreteKind("Copy")],
  });

  const result = concretizeResourceKind({
    kind: derivedKind("fieldAggregation", []),
    appliedType: applied,
    context: monoConcretizationContextFake({
      fieldKindProvider: {
        fieldKindsForType: () => ({ kind: "ok", fieldKinds: ["Affine", "Stream"] }),
      },
    }),
  });

  expect(result).toEqual({
    kind: "ok",
    value: joinConcreteResourceKinds(["Affine", "Stream"]),
  });
});

test("field aggregation rule propagates provider diagnostics", () => {
  const applied = appliedSourceTypeForMonoTest({
    sourceTypeId: typeId(11),
    argumentKinds: [concreteKind("Copy")],
  });

  const result = concretizeResourceKind({
    kind: derivedKind("fieldAggregation", []),
    appliedType: applied,
    context: monoConcretizationContextFake({
      fieldKindProvider: {
        fieldKindsForType: () => ({
          kind: "error",
          diagnostics: [
            {
              code: "MONO_MISSING_REACHABLE_TYPE" as never,
              severity: "error",
              message: "missing",
              order: {
                moduleId: 0 as never,
                spanStart: 0,
                spanEnd: 0,
                ownerKey: "test",
                code: "MONO_MISSING_REACHABLE_TYPE" as never,
                rootCauseKey: "source-type",
                stableDetail: "missing",
                tieBreaker: "t",
              },
            },
          ],
        }),
      },
    }),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_MISSING_REACHABLE_TYPE");
  }
});

test("target declared rule reads from HIR target type kinds", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("targetDeclared", []),
    targetTypeId: targetTypeId("mmio-register"),
    context: monoConcretizationContextFake({
      targetTypeKind: {
        targetTypeId: targetTypeId("mmio-register"),
        kind: "Linear",
        sourceOrigin: hirOriginId(0),
      },
    }),
  });

  expect(result).toEqual({ kind: "ok", value: "Linear" });
});

test("target declared rule infers HIR target kind from applied target constructors", () => {
  const mmioRegister = targetTypeId("mmio-register");
  const result = concretizeResourceKind({
    kind: derivedKind("targetDeclared", []),
    appliedType: appliedType({
      constructor: { kind: "target", targetTypeId: mmioRegister },
      arguments: [],
      resourceKind: concreteKind("Linear"),
    }) as never,
    context: monoConcretizationContextFake({
      targetTypeKind: {
        targetTypeId: mmioRegister,
        kind: "Linear",
        sourceOrigin: hirOriginId(0),
      },
    }),
  });

  expect(result).toEqual({ kind: "ok", value: "Linear" });
});

test("malformed target declared kind fact is an unresolved resource kind error", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("targetDeclared", []),
    targetTypeId: targetTypeId("mmio-register"),
    context: monoConcretizationContextFake({
      targetTypeKind: {
        targetTypeId: targetTypeId("mmio-register"),
        kind: { kind: "derived", rule: "join", arguments: [concreteKind("Linear")] },
        sourceOrigin: hirOriginId(0),
      } as never,
    }),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_UNRESOLVED_RESOURCE_KIND");
    expect(result.diagnostic.order.rootCauseKey).toBe("resource-kind");
  }
});

test("missing constructor rule is an error", () => {
  const applied = appliedSourceTypeForMonoTest({
    sourceTypeId: typeId(99),
    argumentKinds: [concreteKind("Copy")],
  });

  const result = concretizeResourceKind({
    kind: derivedKind("appliedConstructor", []),
    appliedType: applied,
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_MISSING_CONSTRUCTOR_KIND_RULE");
  }
});

test("source type kind concretization requires HIR source kind data", () => {
  const sourceTypeId = typeId(123);
  const normalized = normalizeMonoCheckedType(
    sourceCheckedType({ itemId: itemId(123), typeId: sourceTypeId }),
    {
      targetTypeKinds: { get: () => undefined },
      constructorKindRules: {
        get: (constructor) =>
          constructor.kind === "source" && constructor.typeId === sourceTypeId
            ? {
                constructor,
                rule: "fieldAggregation",
                sourceOrigin: hirOriginId(0),
              }
            : undefined,
      },
      sourceOrigin: hirOriginId(0),
    },
  );
  if (normalized.kind === "error") throw new Error("expected normalized source type");

  const result = concretizeMonoCheckedTypeResourceKind({
    type: normalized.type,
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_MISSING_CONSTRUCTOR_KIND_RULE");
  }
});

test("unresolved parametric kind is an error", () => {
  const result = concretizeResourceKind({
    kind: parametricKind({ owner: { kind: "item", itemId: itemId(99) }, index: 0 }),
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(String(result.diagnostic.code)).toBe("MONO_UNRESOLVED_TYPE_PARAMETER");
  }
});
