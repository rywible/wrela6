import { canonicalTypeInstanceId } from "../mono/instantiation-key";
import type { MonoInstanceId } from "../mono/ids";
import type { MonoCheckedType, MonoTypeInstance, MonomorphizedHirProgram } from "../mono/mono-hir";
import { collectReachableMonoCheckedTypes } from "../mono/reachable-checked-types";
import { coreTypeId, type CoreTypeId } from "../semantic/ids";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { layoutTypeOwnerKey } from "./layout-owners";
import type { LayoutTypeKey } from "./layout-program";

const CORE_TYPES_WITHOUT_LAYOUT_REPRESENTATION: ReadonlySet<string> = new Set([
  String(coreTypeId("Function")),
  String(coreTypeId("string")),
]);

function coreTypeHasLayoutRepresentation(coreTypeIdValue: CoreTypeId): boolean {
  return !CORE_TYPES_WITHOUT_LAYOUT_REPRESENTATION.has(String(coreTypeIdValue));
}

export function checkedTypeRequiresLayoutResolution(type: MonoCheckedType): boolean {
  switch (type.kind) {
    case "genericParameter":
    case "error":
      return false;
    case "core":
      return coreTypeHasLayoutRepresentation(type.coreTypeId);
    case "target":
    case "source":
      return true;
    case "applied":
      switch (type.constructor.kind) {
        case "core":
          return coreTypeHasLayoutRepresentation(type.constructor.coreTypeId);
        case "target":
        case "source":
          return true;
        default: {
          const unreachable: never = type.constructor;
          return unreachable;
        }
      }
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export interface LayoutTypeResolution {
  readonly checkedTypeFingerprint: string;
  readonly type: MonoCheckedType;
  readonly key: LayoutTypeKey;
  readonly sourceOrigin: string;
}

export interface LayoutTypeResolutionTable {
  getByFingerprint(fingerprint: string): LayoutTypeResolution | undefined;
  entries(): readonly LayoutTypeResolution[];
}

export interface BuildLayoutTypeResolutionTableResult {
  readonly table: LayoutTypeResolutionTable;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export function buildLayoutTypeResolutionTable(
  program: MonomorphizedHirProgram,
): BuildLayoutTypeResolutionTableResult {
  const diagnostics: LayoutDiagnostic[] = [];
  const typeInstanceByCanonicalKey = buildTypeInstanceLookup(program);
  const resolutionByFingerprint = new Map<string, LayoutTypeResolution>();

  for (const type of collectReachableMonoCheckedTypes(program)) {
    if (type.kind === "genericParameter" || type.kind === "error") {
      continue;
    }
    const fingerprint = checkedTypeFingerprint(type);
    const key = publishedLayoutTypeKeyFor(type, typeInstanceByCanonicalKey);
    if (key === undefined) {
      continue;
    }
    const existing = resolutionByFingerprint.get(fingerprint);
    const sourceOrigin = layoutResolutionSourceOrigin(type, typeInstanceByCanonicalKey);
    if (existing !== undefined) {
      if (!layoutTypeKeysEqual(existing.key, key)) {
        diagnostics.push(
          layoutDiagnostic({
            severity: "error",
            code: "LAYOUT_DUPLICATE_TYPE_RESOLUTION",
            message: "Duplicate checked type fingerprint maps to conflicting layout type keys.",
            ownerKey: String(layoutTypeOwnerKey(fingerprint)),
            rootCauseKey: "layout-type-resolution",
            stableDetail: `${fingerprint}:${layoutTypeKeyStableDetail(existing.key)}:${layoutTypeKeyStableDetail(key)}`,
            sourceOrigin,
          }),
        );
      }
      continue;
    }
    resolutionByFingerprint.set(fingerprint, {
      checkedTypeFingerprint: fingerprint,
      type,
      key,
      sourceOrigin,
    });
  }

  const entries = [...resolutionByFingerprint.values()].sort((left, right) =>
    compareCodeUnitStrings(left.checkedTypeFingerprint, right.checkedTypeFingerprint),
  );
  const table: LayoutTypeResolutionTable = {
    getByFingerprint: (fingerprint) => resolutionByFingerprint.get(fingerprint),
    entries: () => entries,
  };
  return { table, diagnostics };
}

export function buildTypeInstanceLookup(
  program: MonomorphizedHirProgram,
): Map<string, MonoTypeInstance> {
  const typeInstanceByCanonicalKey = new Map<string, MonoTypeInstance>();
  for (const instance of program.types.entries()) {
    typeInstanceByCanonicalKey.set(String(instance.instanceId), instance);
    typeInstanceByCanonicalKey.set(
      String(
        canonicalTypeInstanceId({
          typeId: instance.sourceTypeId,
          typeArguments: instance.typeArguments,
        }),
      ),
      instance,
    );
  }
  return typeInstanceByCanonicalKey;
}

export function monoTypeInstanceIdForCheckedType(
  type: MonoCheckedType,
  typeInstanceByCanonicalKey: ReadonlyMap<string, MonoTypeInstance>,
): MonoInstanceId | undefined {
  switch (type.kind) {
    case "source": {
      const instance = typeInstanceByCanonicalKey.get(
        String(
          canonicalTypeInstanceId({
            typeId: type.typeId,
            typeArguments: [],
          }),
        ),
      );
      return instance?.instanceId;
    }
    case "applied":
      if (type.constructor.kind !== "source") {
        return undefined;
      }
      return typeInstanceByCanonicalKey.get(
        String(
          canonicalTypeInstanceId({
            typeId: type.constructor.typeId,
            typeArguments: type.arguments as readonly MonoCheckedType[],
          }),
        ),
      )?.instanceId;
    default:
      return undefined;
  }
}

export function publishedLayoutTypeKeyForCheckedType(
  type: MonoCheckedType,
  program: MonomorphizedHirProgram,
): LayoutTypeKey | undefined {
  if (type.kind === "genericParameter" || type.kind === "error") {
    return undefined;
  }
  const lookup = buildTypeInstanceLookup(program);
  return publishedLayoutTypeKeyFor(type, lookup);
}

function publishedLayoutTypeKeyFor(
  type: MonoCheckedType,
  typeInstanceByCanonicalKey: ReadonlyMap<string, MonoTypeInstance>,
): LayoutTypeKey | undefined {
  switch (type.kind) {
    case "core":
      if (!coreTypeHasLayoutRepresentation(type.coreTypeId)) {
        return undefined;
      }
      return { kind: "core", coreTypeId: type.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: type.targetTypeId };
    case "source": {
      const instance = typeInstanceByCanonicalKey.get(
        String(
          canonicalTypeInstanceId({
            typeId: type.typeId,
            typeArguments: [],
          }),
        ),
      );
      if (instance === undefined) return undefined;
      return { kind: "source", instanceId: instance.instanceId };
    }
    case "applied":
      if (type.constructor.kind === "core") {
        if (!coreTypeHasLayoutRepresentation(type.constructor.coreTypeId)) {
          return undefined;
        }
        return { kind: "core", coreTypeId: type.constructor.coreTypeId };
      }
      if (type.constructor.kind === "target") {
        return { kind: "target", targetTypeId: type.constructor.targetTypeId };
      }
      if (type.constructor.kind === "source") {
        const instance = typeInstanceByCanonicalKey.get(
          String(
            canonicalTypeInstanceId({
              typeId: type.constructor.typeId,
              typeArguments: type.arguments as readonly MonoCheckedType[],
            }),
          ),
        );
        if (instance === undefined) return undefined;
        return { kind: "source", instanceId: instance.instanceId };
      }
      return undefined;
    case "genericParameter":
    case "error":
      return undefined;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

function layoutResolutionSourceOrigin(
  type: MonoCheckedType,
  typeInstanceByCanonicalKey: ReadonlyMap<string, MonoTypeInstance>,
): string {
  if (type.kind === "source") {
    const instance = typeInstanceByCanonicalKey.get(
      String(
        canonicalTypeInstanceId({
          typeId: type.typeId,
          typeArguments: [],
        }),
      ),
    );
    return instance?.sourceOrigin ?? checkedTypeFingerprint(type);
  }
  if (type.kind === "applied" && type.constructor.kind === "source") {
    const instance = typeInstanceByCanonicalKey.get(
      String(
        canonicalTypeInstanceId({
          typeId: type.constructor.typeId,
          typeArguments: type.arguments as readonly MonoCheckedType[],
        }),
      ),
    );
    return instance?.sourceOrigin ?? checkedTypeFingerprint(type);
  }
  return checkedTypeFingerprint(type);
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
