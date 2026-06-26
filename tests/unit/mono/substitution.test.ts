import { expect, test } from "bun:test";
import {
  buildMonoSubstitution,
  ownerKeyString,
  parameterKeyString,
  substituteCheckedType,
  substituteProofExpression,
  substituteRequirementExpression,
  substituteResourceKind,
  type BuildMonoSubstitutionInput,
  type MonoSubstitution,
} from "../../../src/mono/substitution";
import { hirOriginId } from "../../../src/hir/ids";
import { functionId, itemId, typeId } from "../../../src/semantic/ids";
import { monoCoreType, normalizeOk } from "../../support/mono/monomorphization-fixtures";
import {
  appliedType,
  coreCheckedType,
  genericParameterCheckedType,
  sourceCheckedType,
} from "../../../src/semantic/surface/type-model";
import {
  concreteKind,
  derivedKind,
  parametricKind,
} from "../../../src/semantic/surface/resource-kind";
import type {
  MonoProofExpression,
  MonoProofExpressionId,
  MonoRequirementExpression,
} from "../../../src/mono/mono-hir";

function proofExpressionId(value: number): MonoProofExpressionId {
  return value as MonoProofExpressionId;
}

function monoProofExpressionLiteral(): MonoProofExpression {
  return {
    proofExpressionId: proofExpressionId(0),
    kind: "literal",
    value: true,
    sourceOrigin: "origin-literal",
  };
}

function monoProofExpressionReferenceWithFunction(): MonoProofExpression {
  return {
    proofExpressionId: proofExpressionId(1),
    kind: "reference",
    name: "predicate",
    functionId: functionId(7),
    sourceOrigin: "origin-ref",
  };
}

function monoProofExpressionUnresolvedReference(): MonoProofExpression {
  return {
    proofExpressionId: proofExpressionId(2),
    kind: "reference",
    name: "missing",
    sourceOrigin: "origin-unresolved-ref",
  };
}

function monoProofExpressionCall(): MonoProofExpression {
  return {
    proofExpressionId: proofExpressionId(3),
    kind: "call",
    calleeFunctionId: functionId(8),
    arguments: [
      monoProofExpressionReferenceWithFunction(),
      monoProofExpressionUnresolvedReference(),
    ],
    sourceOrigin: "origin-call",
  };
}

function monoProofExpressionBinary(): MonoProofExpression {
  return {
    proofExpressionId: proofExpressionId(4),
    kind: "binary",
    operator: "&&",
    left: monoProofExpressionReferenceWithFunction(),
    right: monoProofExpressionCall(),
    sourceOrigin: "origin-binary",
  };
}

function okSubstitution(overrides?: Partial<BuildMonoSubstitutionInput>): MonoSubstitution {
  const result = buildMonoSubstitution({
    ownerParameters: [],
    ownerArguments: [],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
    ...overrides,
  });
  if (result.kind !== "ok") {
    throw new Error("expected ok substitution");
  }
  return result.substitution;
}

test("owner and function type parameters do not collide", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const functionParameter = {
    owner: { kind: "function" as const, itemId: itemId(2), functionId: functionId(3) },
    index: 0,
  };
  const context = buildMonoSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [monoCoreType("u8")],
    functionParameters: [functionParameter],
    functionArguments: [monoCoreType("bool")],
    sourceOrigin: hirOriginId(0),
  });

  if (context.kind !== "ok") throw new Error("expected ok");
  expect(
    substituteCheckedType(genericParameterCheckedType(ownerParameter), context.substitution).type,
  ).toEqual(monoCoreType("u8"));
  expect(
    substituteCheckedType(genericParameterCheckedType(functionParameter), context.substitution)
      .type,
  ).toEqual(monoCoreType("bool"));
});

test("resource kind substitution rewrites parametric kinds from concrete arguments", () => {
  const parameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const substitution = okSubstitution({
    ownerParameters: [parameter],
    ownerArguments: [monoCoreType("Never")],
  });

  expect(substituteResourceKind(parametricKind(parameter), substitution)).toEqual(
    concreteKind("Never"),
  );
});

test("resource kind substitution rewrites nested derived kind arguments", () => {
  const parameter = { owner: { kind: "item" as const, itemId: itemId(2) }, index: 0 };
  const substitution = okSubstitution({
    ownerParameters: [parameter],
    ownerArguments: [monoCoreType("u8")],
  });

  expect(
    substituteResourceKind(derivedKind("join", [parametricKind(parameter)]), substitution),
  ).toEqual(derivedKind("join", [concreteKind("Copy")]));
});

test("resource kind substitution leaves bare source types for contextual concretization", () => {
  const parameter = { owner: { kind: "item" as const, itemId: itemId(3) }, index: 0 };
  const substitution = okSubstitution({
    ownerParameters: [parameter],
    ownerArguments: [normalizeOk(sourceCheckedType({ itemId: itemId(30), typeId: typeId(30) }))],
  });

  expect(substituteResourceKind(parametricKind(parameter), substitution)).toEqual(
    parametricKind(parameter),
  );
});

test("parameter key string encodes the full owner to disambiguate item and function owners", () => {
  const itemOwner = { kind: "item" as const, itemId: itemId(1) };
  const functionOwner = {
    kind: "function" as const,
    itemId: itemId(1),
    functionId: functionId(2),
  };

  expect(ownerKeyString(itemOwner)).toBe("item:1");
  expect(ownerKeyString(functionOwner)).toBe("function:1:2");
  expect(parameterKeyString({ owner: itemOwner, index: 0 })).toBe("item:1:0");
  expect(parameterKeyString({ owner: functionOwner, index: 0 })).toBe("function:1:2:0");
  expect(
    new Set([
      parameterKeyString({ owner: itemOwner, index: 0 }),
      parameterKeyString({ owner: functionOwner, index: 0 }),
    ]).size,
  ).toBe(2);
});

test("builder rejects owner arity mismatch", () => {
  const result = buildMonoSubstitution({
    ownerParameters: [{ owner: { kind: "item", itemId: itemId(1) }, index: 0 }],
    ownerArguments: [],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_OWNER_TYPE_ARGUMENT_ARITY_MISMATCH",
  );
});

test("builder rejects function arity mismatch", () => {
  const result = buildMonoSubstitution({
    ownerParameters: [],
    ownerArguments: [],
    functionParameters: [
      { owner: { kind: "function", itemId: itemId(1), functionId: functionId(1) }, index: 0 },
    ],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_GENERIC_ARITY_MISMATCH",
  );
});

test("builder rejects duplicate owner and function keys", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const functionParameter = {
    owner: { kind: "function" as const, itemId: itemId(1), functionId: functionId(1) },
    index: 0,
  };
  const result = buildMonoSubstitution({
    ownerParameters: [ownerParameter, functionParameter],
    ownerArguments: [monoCoreType("u8"), monoCoreType("bool")],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });

  expect(result.kind).toBe("ok");

  const duplicate = buildMonoSubstitution({
    ownerParameters: [ownerParameter, ownerParameter],
    ownerArguments: [monoCoreType("u8"), monoCoreType("bool")],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });
  expect(duplicate.kind).toBe("error");
  if (duplicate.kind !== "error") return;
  expect(duplicate.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_DUPLICATE_CANONICAL_INSTANCE_KEY",
  );
});

test("builder rejects out-of-order owner keys", () => {
  const result = buildMonoSubstitution({
    ownerParameters: [
      { owner: { kind: "item", itemId: itemId(1) }, index: 1 },
      { owner: { kind: "item", itemId: itemId(1) }, index: 0 },
    ],
    ownerArguments: [monoCoreType("u8"), monoCoreType("bool")],
    functionParameters: [],
    functionArguments: [],
    sourceOrigin: hirOriginId(0),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID",
  );
});

test("builder rejects out-of-order function keys", () => {
  const result = buildMonoSubstitution({
    ownerParameters: [],
    ownerArguments: [],
    functionParameters: [
      { owner: { kind: "function", itemId: itemId(1), functionId: functionId(1) }, index: 1 },
      { owner: { kind: "function", itemId: itemId(1), functionId: functionId(1) }, index: 0 },
    ],
    functionArguments: [monoCoreType("u8"), monoCoreType("bool")],
    sourceOrigin: hirOriginId(0),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID",
  );
});

test("substituteCheckedType recurses into applied arguments and rewrites generic parameters", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const context = okSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [monoCoreType("u32")],
  });

  const applied = appliedType({
    constructor: { kind: "core", coreTypeId: "u8" as any },
    arguments: [genericParameterCheckedType(ownerParameter)],
    resourceKind: concreteKind("Copy"),
  });

  const result = substituteCheckedType(applied, context);
  expect(result.type).toEqual(
    appliedType({
      constructor: { kind: "core", coreTypeId: "u8" as any },
      arguments: [monoCoreType("u32")],
      resourceKind: concreteKind("Copy"),
    }),
  );
  expect(result.diagnostics).toEqual([]);
});

test("substituteCheckedType rewrites applied resource kinds with the same substitution", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const context = okSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [monoCoreType("u8")],
  });
  const applied = appliedType({
    constructor: { kind: "source", typeId: typeId(1) },
    arguments: [genericParameterCheckedType(ownerParameter)],
    resourceKind: parametricKind(ownerParameter),
  });

  const result = substituteCheckedType(applied, context);

  expect(result.type).toEqual(
    appliedType({
      constructor: { kind: "source", typeId: typeId(1) },
      arguments: [monoCoreType("u8")],
      resourceKind: concreteKind("Copy"),
    }),
  );
  expect(result.diagnostics).toEqual([]);
});

test("substituteCheckedType emits diagnostic for unresolved generic parameter", () => {
  const context = okSubstitution();
  const result = substituteCheckedType(
    genericParameterCheckedType({ owner: { kind: "item", itemId: itemId(9) }, index: 0 }),
    context,
  );

  expect(result.type).toEqual({ kind: "error" });
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_UNRESOLVED_TYPE_PARAMETER",
  );
});

test("substituteCheckedType leaves core, source, target, and error types unchanged", () => {
  const context = okSubstitution();
  const cases = [
    coreCheckedType("u8" as any),
    sourceCheckedType({ itemId: itemId(1), typeId: 0 as any }),
    { kind: "target", targetTypeId: "mmio-register" as any } as const,
    { kind: "error" } as const,
  ];

  for (const type of cases) {
    const result = substituteCheckedType(type, context);
    expect(result.type).toEqual(type);
    expect(result.diagnostics).toEqual([]);
  }
});

test("substituteResourceKind recurses into derived arguments without concretizing them", () => {
  const context = okSubstitution();
  const kind = derivedKind("join", [concreteKind("Copy"), concreteKind("Affine")]);
  const result = substituteResourceKind(kind, context);
  expect(result).toEqual(kind);
});

test("substituteResourceKind passes concrete kinds through", () => {
  const context = okSubstitution();
  const result = substituteResourceKind(concreteKind("Linear"), context);
  expect(result).toEqual(concreteKind("Linear"));
});

test("substituteResourceKind preserves unmapped parametric kinds", () => {
  const context = okSubstitution();
  const parametric = parametricKind({
    owner: { kind: "item", itemId: itemId(1) },
    index: 0,
  });

  const result = substituteResourceKind(parametric, context);
  expect(result).toEqual(parametric);
});

test("substituteResourceKind recurses into nested derived kinds", () => {
  const context = okSubstitution();
  const nested = derivedKind("fieldAggregation", [
    derivedKind("join", [concreteKind("Copy"), concreteKind("Affine")]),
  ]);
  const result = substituteResourceKind(nested, context);
  expect(result).toEqual(nested);
});

test("substituteProofExpression preserves source origin on literal expressions", () => {
  const context = okSubstitution();
  const literal = monoProofExpressionLiteral();
  const result = substituteProofExpression(literal, context);
  expect(result.expression).toEqual(literal);
  expect(result.diagnostics).toEqual([]);
});

test("substituteProofExpression emits diagnostic for unresolved references and preserves source origin", () => {
  const context = okSubstitution();
  const reference = monoProofExpressionUnresolvedReference();
  const result = substituteProofExpression(reference, context);
  expect(result.expression).toEqual(reference);
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_UNRESOLVED_TYPE_PARAMETER",
  );
  expect(result.diagnostics[0]?.sourceOrigin).toBe("origin-unresolved-ref");
});

test("substituteProofExpression recurses into call arguments and preserves source origin", () => {
  const context = okSubstitution();
  const call = monoProofExpressionCall();
  const result = substituteProofExpression(call, context);
  if (result.expression.kind !== "call") {
    throw new Error("expected call");
  }
  expect(result.expression.sourceOrigin).toBe("origin-call");
  expect(result.expression.arguments).toHaveLength(2);
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_UNRESOLVED_TYPE_PARAMETER",
  );
});

test("substituteProofExpression recurses into binary operands and preserves source origin", () => {
  const context = okSubstitution();
  const binary = monoProofExpressionBinary();
  const result = substituteProofExpression(binary, context);
  if (result.expression.kind !== "binary") {
    throw new Error("expected binary");
  }
  expect(result.expression.sourceOrigin).toBe("origin-binary");
  expect(result.expression.left).toBeDefined();
  expect(result.expression.right).toBeDefined();
});

test("substituteRequirementExpression recurses into structured expressions and emits diagnostics", () => {
  const context = okSubstitution();
  const structured: MonoRequirementExpression = {
    kind: "structured",
    expression: monoProofExpressionCall(),
  };
  const result = substituteRequirementExpression(structured, context);
  expect(result.expression.kind).toBe("structured");
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_UNRESOLVED_TYPE_PARAMETER",
  );
});

test("substituteRequirementExpression passes opaque and error expressions through", () => {
  const context = okSubstitution();
  const opaque: MonoRequirementExpression = { kind: "opaque", text: "external" };
  const errored: MonoRequirementExpression = { kind: "error", reason: "lowering failed" };

  expect(substituteRequirementExpression(opaque, context).expression).toEqual(opaque);
  expect(substituteRequirementExpression(errored, context).expression).toEqual(errored);
});
