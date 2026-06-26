import type { HirPlatformContractEdgeId } from "../hir/ids";
import type { FunctionId } from "../semantic/ids";
import type { MonoInstanceId } from "../mono/ids";
import type { MonoInstantiatedProofId, MonomorphizedHirProgram } from "../mono/mono-hir";
import type { SourceItemKind } from "../semantic/item-index/item-records";
import { compareCodeUnitStrings, layoutLengthDelimitedField } from "./deterministic-sort";
import {
  type LayoutBuilderContext,
  type LayoutBuilderDependency,
  type LayoutBuilderIssue,
  type LayoutBuilderResult,
} from "./builder-context";
import { enrichDependenciesForOwner, parseLayoutOwnerKey } from "./layout-owners";
import { buildLayoutTypeResolutionTable } from "./layout-type-resolution";
import type { LayoutCanonicalKeyString } from "./ids";
import type {
  LayoutFactProgram,
  LayoutFunctionAbiFact,
  LayoutImageDeviceFact,
  LayoutPlatformAbiFact,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
  LayoutValidatedBufferFact,
} from "./layout-program";
import {
  layoutDeterministicTable,
  layoutImageDeviceKeyString,
  layoutTypeKeyString,
} from "./type-key";
import type { ComputeSourceAggregateNestedType } from "./aggregate-layout";

export const AGGREGATE_SOURCE_KINDS = new Set<SourceItemKind>([
  "dataclass",
  "class",
  "edgeClass",
  "stream",
]);

export function sourceTypeCacheKey(key: LayoutTypeKey): string {
  switch (key.kind) {
    case "source":
      return `source:${String(key.instanceId)}`;
    case "core":
      return `core:${String(key.coreTypeId)}`;
    case "target":
      return `target:${String(key.targetTypeId)}`;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

export function buildSourceTypeKeys(
  program: MonomorphizedHirProgram,
): ReadonlyMap<string, LayoutTypeKey & { readonly kind: "source" }> {
  const sourceTypeKeys = new Map<string, LayoutTypeKey & { readonly kind: "source" }>();
  for (const resolution of buildLayoutTypeResolutionTable(program).table.entries()) {
    if (resolution.key.kind !== "source") {
      continue;
    }
    sourceTypeKeys.set(resolution.checkedTypeFingerprint, resolution.key);
  }
  return sourceTypeKeys;
}

export function buildNestedSourceTypes(
  program: MonomorphizedHirProgram,
): readonly ComputeSourceAggregateNestedType[] {
  return [...program.types.entries()]
    .filter((typeInstance) => typeInstance.sourceKind !== "validatedBuffer")
    .sort((left, right) =>
      compareCodeUnitStrings(String(left.instanceId), String(right.instanceId)),
    )
    .map((typeInstance) => ({
      instanceId: typeInstance.instanceId,
      sourceKind: typeInstance.sourceKind,
      fields: typeInstance.fields.map((field) => ({
        fieldId: field.fieldId,
        name: field.name,
        type: field.type,
        sourceOrigin: field.sourceOrigin,
      })),
      sourceOrigin: typeInstance.sourceOrigin,
    }));
}

export function enrichBuilderDependencies(
  result: LayoutBuilderResult<unknown>,
  targetId: string,
): readonly LayoutBuilderDependency[] {
  const owner = parseLayoutOwnerKey(String(result.ownerKey));
  if (owner === undefined) {
    return result.dependencies;
  }
  return enrichDependenciesForOwner(owner, result.dependencies, targetId);
}

export function recordBuilderResult(
  context: LayoutBuilderContext,
  result: LayoutBuilderResult<unknown>,
  targetId: string,
): void {
  context.reportIssue({
    ownerKey: result.ownerKey,
    dependencies: enrichBuilderDependencies(result, targetId),
    diagnostics: result.diagnostics,
  });
}

export function layoutEnumKeyString(
  key: LayoutTypeKey & { readonly kind: "source" },
): LayoutCanonicalKeyString {
  return layoutTypeKeyString(key);
}

export function layoutValidatedBufferKeyString(
  instanceId: MonoInstanceId,
): LayoutCanonicalKeyString {
  return layoutLengthDelimitedField(
    "validated-buffer",
    String(instanceId),
  ) as LayoutCanonicalKeyString;
}

export function layoutFunctionKeyString(instanceId: MonoInstanceId): LayoutCanonicalKeyString {
  return layoutLengthDelimitedField("function", String(instanceId)) as LayoutCanonicalKeyString;
}

export function layoutPlatformEdgeKeyString(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
): LayoutCanonicalKeyString {
  return layoutLengthDelimitedField(
    "platform-edge",
    `${String(edgeId.instanceId)}:${String(edgeId.hirId)}`,
  ) as LayoutCanonicalKeyString;
}

export function emptyImageDeviceTable(): LayoutFactProgram["imageDevices"] {
  return layoutDeterministicTable({
    entries: [] as readonly LayoutImageDeviceFact[],
    keyOf: (entry) => entry.key,
    keyString: layoutImageDeviceKeyString,
  });
}

export function emptyFunctionAbiTable(): LayoutFactProgram["functions"] {
  return layoutDeterministicTable({
    entries: [] as readonly LayoutFunctionAbiFact[],
    keyOf: (entry) => entry.functionInstanceId,
    keyString: layoutFunctionKeyString,
  });
}

export function emptyPlatformAbiTable(): LayoutFactProgram["platformEdges"] {
  return layoutDeterministicTable({
    entries: [] as readonly LayoutPlatformAbiFact[],
    keyOf: (entry) => entry.edgeId,
    keyString: layoutPlatformEdgeKeyString,
  });
}

export function emptyValidatedBufferTable(): LayoutFactProgram["validatedBuffers"] {
  return layoutDeterministicTable({
    entries: [] as readonly LayoutValidatedBufferFact[],
    keyOf: (entry) => entry.instanceId,
    keyString: layoutValidatedBufferKeyString,
  });
}

export function mergeTypeFacts(
  base: LayoutTypeFactTable,
  additions: readonly LayoutTypeFact[],
): LayoutTypeFactTable {
  const merged = new Map<string, LayoutTypeFact>();
  for (const entry of base.entries()) {
    merged.set(sourceTypeCacheKey(entry.key), entry);
  }
  for (const entry of additions) {
    merged.set(sourceTypeCacheKey(entry.key), entry);
  }
  return layoutDeterministicTable({
    entries: [...merged.values()],
    keyOf: (entry) => entry.key,
    keyString: layoutTypeKeyString,
  });
}

export function collectSourceFunctionAbiFailures(
  program: MonomorphizedHirProgram,
  issues: readonly LayoutBuilderIssue[],
): Set<FunctionId> {
  const failures = new Set<FunctionId>();

  const recordFunctionInstanceFailure = (functionInstanceId: string): void => {
    const functionInstance = program.functions.get(functionInstanceId as MonoInstanceId);
    if (functionInstance !== undefined) {
      failures.add(functionInstance.sourceFunctionId);
    }
  };

  for (const issue of issues) {
    const issueOwnerKey = String(issue.ownerKey);
    if (issueOwnerKey.startsWith("function:")) {
      if (issue.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        recordFunctionInstanceFailure(issueOwnerKey.slice("function:".length));
      }
    }
    for (const diagnostic of issue.diagnostics) {
      if (diagnostic.severity !== "error") {
        continue;
      }
      if (!diagnostic.ownerKey.startsWith("function:")) {
        continue;
      }
      recordFunctionInstanceFailure(diagnostic.ownerKey.slice("function:".length));
    }
  }
  return failures;
}
