import { hirPlatformContractEdgeId, type HirPlatformContractEdgeId } from "../hir/ids";
import type { MonoInstanceId } from "../mono/ids";
import type { MonoInstantiatedProofId } from "../mono/mono-hir";
import type { FieldId } from "../semantic/ids";
import { layoutOwnerKey, type LayoutOwnerKey } from "./builder-context";

export type LayoutOwner =
  | { readonly kind: "target"; readonly targetId: string }
  | { readonly kind: "type"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "enum"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "validatedBuffer"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "validatedBufferValueStorage"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferField";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "validatedBufferDerived";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "validatedBufferTerm";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | { readonly kind: "wire"; readonly fieldId: FieldId }
  | { readonly kind: "function"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "functions"; readonly targetId: string }
  | {
      readonly kind: "platformEdge";
      readonly edgeInstanceId: MonoInstanceId;
      readonly hirEdgeId: HirPlatformContractEdgeId;
    }
  | { readonly kind: "platformEdges"; readonly targetId: string }
  | { readonly kind: "image"; readonly imageInstanceId: MonoInstanceId }
  | {
      readonly kind: "imageDevice";
      readonly imageInstanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | { readonly kind: "layoutType"; readonly fingerprint: string }
  | { readonly kind: "imageEntryFacet"; readonly facet: "physical" | "source" };

const VALIDATED_BUFFER_SUBOWNER_PATTERN = /:(?:field|derived|term):|:value-storage(?::|$)/;

export function layoutOwnerToKey(owner: LayoutOwner): LayoutOwnerKey {
  switch (owner.kind) {
    case "target":
      return layoutOwnerKey(`target:${owner.targetId}`);
    case "type":
      return layoutOwnerKey(`type:${String(owner.instanceId)}`);
    case "enum":
      return layoutOwnerKey(`enum:${String(owner.instanceId)}`);
    case "validatedBuffer":
      return layoutOwnerKey(`validated-buffer:${String(owner.instanceId)}`);
    case "validatedBufferValueStorage":
      return layoutOwnerKey(`validated-buffer:${String(owner.instanceId)}:value-storage`);
    case "validatedBufferField":
      return layoutOwnerKey(
        `validated-buffer:${String(owner.instanceId)}:field:${String(owner.fieldId)}`,
      );
    case "validatedBufferDerived":
      return layoutOwnerKey(
        `validated-buffer:${String(owner.instanceId)}:derived:${String(owner.fieldId)}`,
      );
    case "validatedBufferTerm":
      return layoutOwnerKey(
        `validated-buffer:${String(owner.instanceId)}:term:${String(owner.fieldId)}`,
      );
    case "wire":
      return layoutOwnerKey(`wire:${String(owner.fieldId)}`);
    case "function":
      return layoutOwnerKey(`function:${String(owner.instanceId)}`);
    case "functions":
      return layoutOwnerKey(`functions:${owner.targetId}`);
    case "platformEdge":
      return layoutOwnerKey(
        `platform-edge:${String(owner.edgeInstanceId)}:${String(owner.hirEdgeId)}`,
      );
    case "platformEdges":
      return layoutOwnerKey(`platform-edges:${owner.targetId}`);
    case "image":
      return layoutOwnerKey(`image:${String(owner.imageInstanceId)}`);
    case "imageDevice":
      return layoutOwnerKey(
        `image-device:${String(owner.imageInstanceId)}:${String(owner.fieldId)}`,
      );
    case "layoutType":
      return layoutOwnerKey(`layout-type:${owner.fingerprint}`);
    case "imageEntryFacet":
      return layoutOwnerKey(`image-entry:${owner.facet}`);
    default: {
      const unreachable: never = owner;
      return unreachable;
    }
  }
}

export function parseLayoutOwnerKey(ownerKey: string): LayoutOwner | undefined {
  if (ownerKey.startsWith("target:")) {
    const targetId = ownerKey.slice("target:".length);
    return targetId.length > 0 ? { kind: "target", targetId } : undefined;
  }
  if (ownerKey.startsWith("type:")) {
    const instanceId = ownerKey.slice("type:".length) as MonoInstanceId;
    return instanceId.length > 0 ? { kind: "type", instanceId } : undefined;
  }
  if (ownerKey.startsWith("enum:")) {
    const instanceId = ownerKey.slice("enum:".length) as MonoInstanceId;
    return instanceId.length > 0 ? { kind: "enum", instanceId } : undefined;
  }
  if (ownerKey.startsWith("function:")) {
    const instanceId = ownerKey.slice("function:".length) as MonoInstanceId;
    return instanceId.length > 0 ? { kind: "function", instanceId } : undefined;
  }
  if (ownerKey.startsWith("functions:")) {
    const targetId = ownerKey.slice("functions:".length);
    return targetId.length > 0 ? { kind: "functions", targetId } : undefined;
  }
  if (ownerKey.startsWith("platform-edges:")) {
    const targetId = ownerKey.slice("platform-edges:".length);
    return targetId.length > 0 ? { kind: "platformEdges", targetId } : undefined;
  }
  if (ownerKey.startsWith("platform-edge:")) {
    const remainder = ownerKey.slice("platform-edge:".length);
    const separator = remainder.lastIndexOf(":");
    if (separator === -1) {
      return undefined;
    }
    return {
      kind: "platformEdge",
      edgeInstanceId: remainder.slice(0, separator) as MonoInstanceId,
      hirEdgeId: hirPlatformContractEdgeId(Number(remainder.slice(separator + 1))),
    };
  }
  if (ownerKey.startsWith("wire:")) {
    const fieldIdValue = ownerKey.slice("wire:".length);
    return fieldIdValue.length > 0
      ? { kind: "wire", fieldId: Number(fieldIdValue) as FieldId }
      : undefined;
  }
  if (ownerKey.startsWith("layout-type:")) {
    const fingerprint = ownerKey.slice("layout-type:".length);
    return fingerprint.length > 0 ? { kind: "layoutType", fingerprint } : undefined;
  }
  if (ownerKey.startsWith("image-entry:")) {
    const facet = ownerKey.slice("image-entry:".length);
    if (facet === "physical" || facet === "source") {
      return { kind: "imageEntryFacet", facet };
    }
    return undefined;
  }
  if (ownerKey.startsWith("image-device:")) {
    const remainder = ownerKey.slice("image-device:".length);
    const separator = remainder.lastIndexOf(":");
    if (separator === -1) {
      return undefined;
    }
    return {
      kind: "imageDevice",
      imageInstanceId: remainder.slice(0, separator) as MonoInstanceId,
      fieldId: Number(remainder.slice(separator + 1)) as FieldId,
    };
  }
  if (ownerKey.startsWith("image:")) {
    const remainder = ownerKey.slice("image:".length);
    return remainder.length > 0
      ? { kind: "image", imageInstanceId: remainder as MonoInstanceId }
      : undefined;
  }
  if (!ownerKey.startsWith("validated-buffer:")) {
    return undefined;
  }
  const remainder = ownerKey.slice("validated-buffer:".length);
  if (remainder.length === 0) {
    return undefined;
  }
  const suffixMatch = remainder.match(VALIDATED_BUFFER_SUBOWNER_PATTERN);
  if (suffixMatch === null || suffixMatch.index === undefined) {
    return { kind: "validatedBuffer", instanceId: remainder as MonoInstanceId };
  }
  const instanceId = remainder.slice(0, suffixMatch.index) as MonoInstanceId;
  const suffix = remainder.slice(suffixMatch.index);
  if (suffix.startsWith(":value-storage")) {
    return { kind: "validatedBufferValueStorage", instanceId };
  }
  if (suffix.startsWith(":field:")) {
    return {
      kind: "validatedBufferField",
      instanceId,
      fieldId: Number(suffix.slice(":field:".length)) as FieldId,
    };
  }
  if (suffix.startsWith(":derived:")) {
    return {
      kind: "validatedBufferDerived",
      instanceId,
      fieldId: Number(suffix.slice(":derived:".length)) as FieldId,
    };
  }
  if (suffix.startsWith(":term:")) {
    return {
      kind: "validatedBufferTerm",
      instanceId,
      fieldId: Number(suffix.slice(":term:".length)) as FieldId,
    };
  }
  return undefined;
}

export function validatedBufferRootOwner(instanceId: MonoInstanceId): LayoutOwner {
  return { kind: "validatedBuffer", instanceId };
}

export function validatedBufferRootOwnerKey(instanceId: MonoInstanceId): LayoutOwnerKey {
  return layoutOwnerToKey(validatedBufferRootOwner(instanceId));
}

export function typeLayoutOwner(instanceId: MonoInstanceId): LayoutOwner {
  return { kind: "type", instanceId };
}

export function typeLayoutOwnerKey(instanceId: MonoInstanceId): LayoutOwnerKey {
  return layoutOwnerToKey(typeLayoutOwner(instanceId));
}

export function enumLayoutOwner(instanceId: MonoInstanceId): LayoutOwner {
  return { kind: "enum", instanceId };
}

export function enumLayoutOwnerKey(instanceId: MonoInstanceId): LayoutOwnerKey {
  return layoutOwnerToKey(enumLayoutOwner(instanceId));
}

export function targetLayoutOwner(targetId: string): LayoutOwner {
  return { kind: "target", targetId };
}

export function targetLayoutOwnerKey(targetId: string): LayoutOwnerKey {
  return layoutOwnerToKey(targetLayoutOwner(targetId));
}

export function functionAbiOwner(functionInstanceId: MonoInstanceId): LayoutOwner {
  return { kind: "function", instanceId: functionInstanceId };
}

export function functionAbiOwnerKey(functionInstanceId: MonoInstanceId): LayoutOwnerKey {
  return layoutOwnerToKey(functionAbiOwner(functionInstanceId));
}

export function validatedBufferFieldOwner(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwner {
  return { kind: "validatedBufferField", instanceId, fieldId: fieldIdValue };
}

export function validatedBufferDerivedOwner(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwner {
  return { kind: "validatedBufferDerived", instanceId, fieldId: fieldIdValue };
}

export function validatedBufferTermOwner(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwner {
  return { kind: "validatedBufferTerm", instanceId, fieldId: fieldIdValue };
}

export function validatedBufferTermOwnerKey(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwnerKey {
  return layoutOwnerToKey(validatedBufferTermOwner(instanceId, fieldIdValue));
}

export function validatedBufferFieldOwnerKey(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwnerKey {
  return layoutOwnerToKey(validatedBufferFieldOwner(instanceId, fieldIdValue));
}

export function validatedBufferDerivedOwnerKey(
  instanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwnerKey {
  return layoutOwnerToKey(validatedBufferDerivedOwner(instanceId, fieldIdValue));
}

export function validatedBufferRootCauseKey(instanceId: MonoInstanceId): string {
  return String(validatedBufferRootOwnerKey(instanceId));
}

export function derivedFieldFactsOwnerKey(
  instanceId: MonoInstanceId,
  derivedFieldId: FieldId,
): LayoutOwnerKey {
  return validatedBufferDerivedOwnerKey(instanceId, derivedFieldId);
}

export function validatedBufferValueStorageOwner(instanceId: MonoInstanceId): LayoutOwner {
  return { kind: "validatedBufferValueStorage", instanceId };
}

export function validatedBufferValueStorageOwnerKey(instanceId: MonoInstanceId): LayoutOwnerKey {
  return layoutOwnerToKey(validatedBufferValueStorageOwner(instanceId));
}

export function wireOwner(fieldIdValue: FieldId): LayoutOwner {
  return { kind: "wire", fieldId: fieldIdValue };
}

export function wireOwnerKey(fieldIdValue: FieldId): LayoutOwnerKey {
  return layoutOwnerToKey(wireOwner(fieldIdValue));
}

export function platformEdgeOwner(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
): LayoutOwner {
  return {
    kind: "platformEdge",
    edgeInstanceId: edgeId.instanceId,
    hirEdgeId: edgeId.hirId,
  };
}

export function platformEdgeOwnerKey(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
): LayoutOwnerKey {
  return layoutOwnerToKey(platformEdgeOwner(edgeId));
}

export function platformEdgesOwner(targetId: string): LayoutOwner {
  return { kind: "platformEdges", targetId };
}

export function platformEdgesOwnerKey(targetId: string): LayoutOwnerKey {
  return layoutOwnerToKey(platformEdgesOwner(targetId));
}

export function functionsAbiOwner(targetId: string): LayoutOwner {
  return { kind: "functions", targetId };
}

export function functionsAbiOwnerKey(targetId: string): LayoutOwnerKey {
  return layoutOwnerToKey(functionsAbiOwner(targetId));
}

export function imageOwner(imageInstanceId: MonoInstanceId): LayoutOwner {
  return { kind: "image", imageInstanceId };
}

export function imageOwnerKey(imageInstanceId: MonoInstanceId): LayoutOwnerKey {
  return layoutOwnerToKey(imageOwner(imageInstanceId));
}

export function imageDeviceOwner(
  imageInstanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwner {
  return { kind: "imageDevice", imageInstanceId, fieldId: fieldIdValue };
}

export function imageDeviceOwnerKey(
  imageInstanceId: MonoInstanceId,
  fieldIdValue: FieldId,
): LayoutOwnerKey {
  return layoutOwnerToKey(imageDeviceOwner(imageInstanceId, fieldIdValue));
}

export function layoutTypeOwner(fingerprint: string): LayoutOwner {
  return { kind: "layoutType", fingerprint };
}

export function layoutTypeOwnerKey(fingerprint: string): LayoutOwnerKey {
  return layoutOwnerToKey(layoutTypeOwner(fingerprint));
}

export function imageEntryFacetOwner(facet: "physical" | "source"): LayoutOwner {
  return { kind: "imageEntryFacet", facet };
}

export function imageEntryFacetOwnerKey(facet: "physical" | "source"): LayoutOwnerKey {
  return layoutOwnerToKey(imageEntryFacetOwner(facet));
}

export function enrichDependenciesForOwner(
  owner: LayoutOwner,
  declared: readonly {
    readonly ownerKey: LayoutOwnerKey;
    readonly reason: import("./builder-context").LayoutBuilderDependency["reason"];
  }[],
  targetId: string,
): readonly import("./builder-context").LayoutBuilderDependency[] {
  const dependenciesByOwnerKey = new Map<
    string,
    import("./builder-context").LayoutBuilderDependency
  >();
  for (const dependency of declared) {
    dependenciesByOwnerKey.set(String(dependency.ownerKey), dependency);
  }

  const targetOwnerKey = targetLayoutOwnerKey(targetId);
  if (owner.kind !== "target") {
    dependenciesByOwnerKey.set(String(targetOwnerKey), {
      ownerKey: targetOwnerKey,
      reason: "target",
    });
  }

  switch (owner.kind) {
    case "validatedBufferValueStorage":
    case "validatedBufferField":
    case "validatedBufferDerived":
    case "validatedBufferTerm": {
      const bufferOwnerKey = validatedBufferRootOwnerKey(owner.instanceId);
      if (layoutOwnerToKey(owner) !== String(bufferOwnerKey)) {
        dependenciesByOwnerKey.set(String(bufferOwnerKey), {
          ownerKey: bufferOwnerKey,
          reason: "validatedBuffer",
        });
      }
      break;
    }
    case "enum": {
      dependenciesByOwnerKey.set(String(typeLayoutOwnerKey(owner.instanceId)), {
        ownerKey: typeLayoutOwnerKey(owner.instanceId),
        reason: "type",
      });
      break;
    }
    default:
      break;
  }

  return [...dependenciesByOwnerKey.values()].sort((left, right) =>
    String(left.ownerKey).localeCompare(String(right.ownerKey)),
  );
}
