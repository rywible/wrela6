import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  canonicalFunctionInstanceId,
  normalizeMonoCheckedType,
  type MonoTypeNormalizationContext,
} from "../../../src/mono/instantiation-key";
import { hirOriginId } from "../../../src/hir/ids";
import {
  type CheckedType,
  appliedType,
  checkedTypeFingerprint,
  coreCheckedType,
  genericParameterCheckedType,
  sourceCheckedType,
} from "../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreTypeId, functionId, itemId, targetTypeId, typeId } from "../../../src/semantic/ids";
import { type MonoCheckedType } from "../../../src/mono/mono-hir";

function normalizationContextForTask10Test(): MonoTypeNormalizationContext {
  const emptyTable = {
    get: () => undefined,
    has: () => false,
    entries: () => [],
  };
  return {
    targetTypeKinds: emptyTable,
    constructorKindRules: emptyTable,
    sourceOrigin: hirOriginId(0),
  };
}

function normalizeOkForTask10Test(type: CheckedType): MonoCheckedType {
  const result = normalizeMonoCheckedType(type, normalizationContextForTask10Test());
  if (result.kind === "error") {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.code).join(","));
  }
  return result.type;
}

test("normalization rejects source type without constructor kind rule", () => {
  const result = normalizeMonoCheckedType(
    sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
    normalizationContextForTask10Test(),
  );

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "MONO_MISSING_CONSTRUCTOR_KIND_RULE",
    );
  }
});

test("normalization rejects nested generic parameter", () => {
  const result = normalizeMonoCheckedType(
    appliedType({
      constructor: { kind: "source", typeId: typeId(1) },
      arguments: [
        genericParameterCheckedType({ owner: { kind: "item", itemId: itemId(1) }, index: 0 }),
      ],
      resourceKind: concreteKind("Copy"),
    }),
    normalizationContextForTask10Test(),
  );

  if (result.kind !== "error") {
    throw new Error("Expected error result");
  }
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "MONO_UNRESOLVED_TYPE_PARAMETER",
  );
});

test("normalization reports missing target kind for applied target constructors", () => {
  const missingTargetId = targetTypeId("MissingTargetKind");
  const result = normalizeMonoCheckedType(
    appliedType({
      constructor: { kind: "target", targetTypeId: missingTargetId },
      arguments: [coreCheckedType(coreTypeId("u8"))],
      resourceKind: concreteKind("Copy"),
    }),
    {
      targetTypeKinds: {
        get: () => undefined,
      },
      constructorKindRules: {
        get: (constructor) =>
          constructor.kind === "target" && constructor.targetTypeId === missingTargetId
            ? { constructor, rule: "targetDeclared" }
            : undefined,
      },
      sourceOrigin: hirOriginId(0),
    },
  );

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
      "MONO_MISSING_TARGET_TYPE_KIND",
    );
  }
});

test("canonical key length-delimits type fingerprints", () => {
  const u8Checked = normalizeOkForTask10Test(coreCheckedType(coreTypeId("u8")));
  const key = canonicalFunctionInstanceId({
    functionId: functionId(12),
    ownerTypeId: undefined,
    ownerTypeArguments: [],
    functionTypeArguments: [u8Checked],
  });

  expect(String(key)).toBe("fn:12|ownerType:none|owner:<>|fn:<7:core:u8>");
});

test("checked type fingerprints used by mono fixture types are distinct", () => {
  const u8Fingerprint = checkedTypeFingerprint(coreCheckedType(coreTypeId("u8")));
  const boolFingerprint = checkedTypeFingerprint(coreCheckedType(coreTypeId("bool")));
  const sourceFingerprint = checkedTypeFingerprint(
    sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
  );

  expect(new Set([u8Fingerprint, boolFingerprint, sourceFingerprint]).size).toBe(3);
});

test("MonoCheckedType casts exist only in the normalization factory", () => {
  const files = readdirSync("src/mono", { recursive: true })
    .filter((file) => typeof file === "string" && file.endsWith(".ts"))
    .map((file) => `src/mono/${file}`);
  const offenders = files.filter((file) => {
    const source = readFileSync(file, "utf8");
    return file !== "src/mono/instantiation-key.ts" && source.includes("as MonoCheckedType");
  });

  expect(offenders).toEqual([]);
});
