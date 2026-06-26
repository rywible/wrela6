import type { LayoutTypeKey, TargetLayoutFacts } from "./layout-program";
import type { LayoutPrimitiveTypeRef, LayoutTargetSurface } from "./target-layout";

export function layoutTypeKeyFromPrimitiveRef(ref: LayoutPrimitiveTypeRef): LayoutTypeKey {
  switch (ref.kind) {
    case "core":
      return { kind: "core", coreTypeId: ref.coreTypeId };
    case "target":
      return { kind: "target", targetTypeId: ref.targetTypeId };
    default: {
      const unreachable: never = ref;
      return unreachable;
    }
  }
}

export function normalizeTargetFactsFromSurface(target: LayoutTargetSurface): TargetLayoutFacts {
  return {
    targetId: target.targetId,
    endian: target.dataModel.endian,
    addressableUnit: target.dataModel.addressableUnit,
    pointerWidthBits: target.dataModel.pointerWidthBits,
    pointerSizeBytes: target.dataModel.pointerSizeBytes,
    pointerAlignmentBytes: target.dataModel.pointerAlignmentBytes,
    sizeType: layoutTypeKeyFromPrimitiveRef(target.dataModel.sizeType),
    maximumObjectSizeBytes: target.dataModel.maximumObjectSizeBytes,
    maximumAlignmentBytes: target.dataModel.maximumAlignmentBytes,
  };
}
