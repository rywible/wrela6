import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import type { LayoutTypeFactTable, LayoutTypeKey, TargetLayoutFacts } from "./layout-program";
import { layoutTypeFingerprintTable } from "./type-key";
import { layoutTypeOwnerKey, targetLayoutOwnerKey } from "./layout-owners";
import type { MonomorphizedHirProgram } from "../mono/mono-hir";
import type { MonoCheckedType } from "../mono/mono-hir";
import { collectReachableMonoCheckedTypes } from "../mono/reachable-checked-types";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import {
  buildLayoutTypeResolutionTable,
  checkedTypeRequiresLayoutResolution,
  type LayoutTypeResolution,
} from "./layout-type-resolution";

export interface LayoutTypeResolver {
  get(type: MonoCheckedType): LayoutTypeKey | undefined;
  getByFingerprint(fingerprint: string): LayoutTypeKey | undefined;
}

export interface BuildLayoutTypeResolverInput {
  readonly program: MonomorphizedHirProgram;
  readonly targetFacts: TargetLayoutFacts;
  readonly primitiveTypes?: LayoutTypeFactTable;
}

export interface LayoutTypeResolverValue {
  readonly resolver: LayoutTypeResolver;
}

export function buildLayoutTypeResolver(
  input: BuildLayoutTypeResolverInput,
): LayoutBuilderResult<LayoutTypeResolverValue> {
  const resolutionResult = buildLayoutTypeResolutionTable(input.program);
  return finalizeLayoutTypeResolver(input, resolutionResult.table.entries(), [
    ...resolutionResult.diagnostics,
  ]);
}

export function buildLayoutTypeResolverWithResolutions(
  input: BuildLayoutTypeResolverInput & {
    readonly resolutions: readonly LayoutTypeResolution[];
    readonly resolutionDiagnostics?: readonly LayoutDiagnostic[];
  },
): LayoutBuilderResult<LayoutTypeResolverValue> {
  return finalizeLayoutTypeResolver(input, input.resolutions, [
    ...(input.resolutionDiagnostics ?? []),
  ]);
}

function finalizeLayoutTypeResolver(
  input: BuildLayoutTypeResolverInput,
  resolutions: readonly LayoutTypeResolution[],
  initialDiagnostics: readonly LayoutDiagnostic[],
): LayoutBuilderResult<LayoutTypeResolverValue> {
  const ownerKey = targetLayoutOwnerKey(String(input.targetFacts.targetId));
  const diagnostics: LayoutDiagnostic[] = [...initialDiagnostics];
  const fingerprintToKey = new Map<string, LayoutTypeKey>();

  for (const resolution of resolutions) {
    const fingerprint = resolution.checkedTypeFingerprint;
    const layoutKey = resolution.key;
    const existing = fingerprintToKey.get(fingerprint);
    if (existing !== undefined && !layoutTypeKeysEqual(existing, layoutKey)) {
      diagnostics.push(
        layoutDiagnostic({
          severity: "error",
          code: "LAYOUT_DUPLICATE_TYPE_RESOLUTION",
          message: "Duplicate checked type fingerprint maps to conflicting layout type keys.",
          ownerKey: String(layoutTypeOwnerKey(fingerprint)),
          rootCauseKey: "layout-type-resolution",
          stableDetail: `${fingerprint}:${layoutTypeKeyStableDetail(existing)}:${layoutTypeKeyStableDetail(layoutKey)}`,
          sourceOrigin: resolution.sourceOrigin,
        }),
      );
      continue;
    }

    const publishedKeyDiagnostic = validatePublishedLayoutTypeKey(input, resolution);
    if (publishedKeyDiagnostic !== undefined) {
      diagnostics.push(publishedKeyDiagnostic);
      continue;
    }

    fingerprintToKey.set(fingerprint, layoutKey);
  }

  for (const type of collectReachableMonoCheckedTypes(input.program)) {
    const fingerprint = checkedTypeFingerprint(type);
    if (fingerprintToKey.has(fingerprint)) {
      continue;
    }
    if (type.kind === "genericParameter" || type.kind === "error") {
      continue;
    }
    if (!checkedTypeRequiresLayoutResolution(type)) {
      continue;
    }
    diagnostics.push(
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_MISSING_TYPE_RESOLUTION",
        message: "Missing layout type resolution for reachable checked type.",
        ownerKey: String(layoutTypeOwnerKey(fingerprint)),
        rootCauseKey: "layout-type-resolution",
        stableDetail: fingerprint,
      }),
    );
  }

  const table = layoutTypeFingerprintTable({
    entries: [...fingerprintToKey.entries()].map(([fingerprint, key]) => ({
      fingerprint,
      key,
    })),
  });
  const resolver: LayoutTypeResolver = {
    get(type: MonoCheckedType): LayoutTypeKey | undefined {
      if (type.kind === "genericParameter" || type.kind === "error") {
        return undefined;
      }
      return table.getByFingerprint(checkedTypeFingerprint(type));
    },
    getByFingerprint(fingerprint: string): LayoutTypeKey | undefined {
      return table.getByFingerprint(fingerprint);
    },
  };
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");

  if (hasErrors) {
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: { resolver },
    diagnostics,
  };
}

function validatePublishedLayoutTypeKey(
  input: BuildLayoutTypeResolverInput,
  resolution: LayoutTypeResolution,
): LayoutDiagnostic | undefined {
  const key = resolution.key;
  switch (key.kind) {
    case "source":
      if (input.program.types.get(key.instanceId) === undefined) {
        return invalidPublishedTypeKeyDiagnostic(resolution, `source:${String(key.instanceId)}`);
      }
      return undefined;
    case "core":
    case "target": {
      if (input.primitiveTypes !== undefined && input.primitiveTypes.get(key) === undefined) {
        return invalidPublishedTypeKeyDiagnostic(resolution, layoutTypeKeyStableDetail(key));
      }
      return undefined;
    }
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function invalidPublishedTypeKeyDiagnostic(
  resolution: LayoutTypeResolution,
  detail: string,
): LayoutDiagnostic {
  return layoutDiagnostic({
    severity: "error",
    code: "LAYOUT_INVALID_PUBLISHED_TYPE_KEY",
    message: "Layout type resolution key does not reference a reachable layout target.",
    ownerKey: String(layoutTypeOwnerKey(resolution.checkedTypeFingerprint)),
    rootCauseKey: "layout-type-resolution",
    stableDetail: detail,
    sourceOrigin: resolution.sourceOrigin,
  });
}

function layoutTypeKeysEqual(left: LayoutTypeKey, right: LayoutTypeKey): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "source":
      return right.kind === "source" && String(left.instanceId) === String(right.instanceId);
    case "core":
      return right.kind === "core" && left.coreTypeId === right.coreTypeId;
    case "target":
      return right.kind === "target" && left.targetTypeId === right.targetTypeId;
    default: {
      const unreachable: never = left;
      return unreachable;
    }
  }
}

function layoutTypeKeyStableDetail(key: LayoutTypeKey): string {
  switch (key.kind) {
    case "source":
      return `source:${String(key.instanceId)}`;
    case "core":
      return `core:${key.coreTypeId}`;
    case "target":
      return `target:${key.targetTypeId}`;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}
