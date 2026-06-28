import { monoInstanceId } from "../../../src/mono/ids";
import { hirOriginId } from "../../../src/hir/ids";
import type { MonoCheckedType, MonoFunctionInstance, MonoLocal } from "../../../src/mono/mono-hir";
import {
  computeFunctionAbiFact,
  type ComputeFunctionAbiFactInput,
} from "../../../src/layout/source-function-abi";
import type { LayoutBuilderResult } from "../../../src/layout/builder-context";
import type {
  LayoutAbiValueShape,
  LayoutEnumFact,
  LayoutEnumFactTable,
  LayoutFunctionAbiFact,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
} from "../../../src/layout/layout-program";
import type { LayoutTypeResolver } from "../../../src/layout/layout-type-resolver";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import { coreTypeId, functionId, itemId, parameterId, typeId } from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import type { FunctionAbiFixtureOptions } from "./layout-fixtures";
import { layoutTargetSurfaceFake, normalizeTargetFactsForTest } from "./layout-fixtures";

const FIXTURE_SOURCE_ORIGIN = "layout-fixture:0:0";
const FIXTURE_FUNCTION_INSTANCE_ID = monoInstanceId("fn:FunctionAbiFixture");
const FIXTURE_PACKET_TYPE_KEY = {
  kind: "source" as const,
  instanceId: monoInstanceId("type:Packet"),
};

function layoutTypeKeyString(key: LayoutTypeKey): LayoutCanonicalKeyString {
  switch (key.kind) {
    case "source":
      return `source:${String(key.instanceId)}` as LayoutCanonicalKeyString;
    case "core":
      return `core:${String(key.coreTypeId)}` as LayoutCanonicalKeyString;
    case "target":
      return `target:${String(key.targetTypeId)}` as LayoutCanonicalKeyString;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function largeAggregateLayoutFact(
  key: LayoutTypeKey & { readonly kind: "source" },
): LayoutTypeFact {
  return {
    key,
    sizeBytes: 24n,
    alignmentBytes: 8n,
    strideBytes: 24n,
    representation: { kind: "aggregate", sourceKind: "class" },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function zeroSizedCapabilityLayoutFact(
  key: LayoutTypeKey & { readonly kind: "source" },
): LayoutTypeFact {
  return {
    key,
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized", reason: "capabilityToken" },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function fixtureTypeKeyFromShape(
  classifierShape: LayoutAbiValueShape | undefined,
): LayoutTypeKey & { readonly kind: "source" } {
  if (classifierShape?.kind === "indirect" && classifierShape.pointee.kind === "source") {
    return classifierShape.pointee;
  }
  return FIXTURE_PACKET_TYPE_KEY;
}

function fixtureLayoutFactForTypeKey(
  typeKey: LayoutTypeKey & { readonly kind: "source" },
  classifierShape: LayoutAbiValueShape | undefined,
): LayoutTypeFact {
  if (classifierShape?.kind === "none" && classifierShape.reason === "zeroSizedCapability") {
    return zeroSizedCapabilityLayoutFact(typeKey);
  }
  return largeAggregateLayoutFact(typeKey);
}

function emptyEnumFactTable(): LayoutEnumFactTable {
  const entries: LayoutEnumFact[] = [];
  return layoutDeterministicTable({
    entries,
    keyOf: (entry) => entry.owner,
    keyString: layoutTypeKeyString,
  });
}

function fixtureTypesTable(typeKey: LayoutTypeKey, layout: LayoutTypeFact): LayoutTypeFactTable {
  return layoutDeterministicTable({
    entries: [layout],
    keyOf: (entry) => entry.key,
    keyString: layoutTypeKeyString,
  });
}

function fixtureResolverForTypeKey(typeKey: LayoutTypeKey): LayoutTypeResolver {
  return {
    get: () => typeKey,
    getByFingerprint: () => typeKey,
  };
}

function fixtureFunctionInstance(
  parameterMode: "observe" | "consume",
  parameterType: MonoCheckedType,
): MonoFunctionInstance {
  const neverReturn = coreCheckedType(coreTypeId("Never")) as MonoCheckedType;
  const sourceSpan = { start: 0, end: 0, length: 0 };
  return {
    instanceId: FIXTURE_FUNCTION_INSTANCE_ID,
    sourceFunctionId: functionId(0),
    sourceItemId: itemId(0),
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: functionId(0),
      itemId: itemId(0),
      parameters: [
        {
          parameterId: parameterId(0),
          name: "packet",
          type: parameterType,
          mode: parameterMode,
          resourceKind: "Copy",
          sourceSpan,
        },
      ],
      returnType: neverReturn,
      returnKind: "Never",
      modifiers: {
        isPlatform: false,
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan,
    },
    bodyStatus: "sourceBody",
    locals: layoutDeterministicTable({
      entries: [] as readonly MonoLocal[],
      keyOf: (entry) => entry.localId,
      keyString: (key) => String(key) as LayoutCanonicalKeyString,
    }),
    declaredRequirements: [],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    hirSourceOrigin: hirOriginId(0),
  };
}

export interface ComputeFunctionAbiFactForFixtureInput extends FunctionAbiFixtureOptions {}

export function computeFunctionAbiFactForFixture(
  options: ComputeFunctionAbiFactForFixtureInput = {},
): LayoutBuilderResult<{ readonly fact: LayoutFunctionAbiFact }> {
  const target = options.target ?? layoutTargetSurfaceFake();
  const targetFacts = normalizeTargetFactsForTest(target);
  const parameterMode = options.parameterMode ?? "observe";
  const typeKey = fixtureTypeKeyFromShape(options.classifierShape);
  const layout = fixtureLayoutFactForTypeKey(typeKey, options.classifierShape);
  const types = fixtureTypesTable(typeKey, layout);
  const parameterType = {
    kind: "source",
    itemId: itemId(1),
    typeId: typeId(1),
  } as MonoCheckedType;

  const input: ComputeFunctionAbiFactInput = {
    functionInstance: fixtureFunctionInstance(parameterMode, parameterType),
    target,
    targetFacts,
    types,
    enums: emptyEnumFactTable(),
    resolver: fixtureResolverForTypeKey(typeKey),
  };

  return computeFunctionAbiFact(input);
}
