import type { HirBrand, HirImage, HirImageDevice } from "./hir";
import type { HirBrandCanonicalKey, HirResourcePlace } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { moduleId } from "../semantic/ids";
import type { DeviceSurfaceId, FieldId } from "../semantic/ids";
import type { FieldRecord, ImageRecord } from "../semantic/item-index";
import { ownedHirImageOriginId } from "./ids";
import { hirDiagnostic } from "./lowering-context";
import { HirResourcePlaceInterner } from "./place";

interface PendingImageDeviceRoot {
  readonly place: HirResourcePlace;
  readonly brandKey: HirBrandCanonicalKey;
}

interface PendingImageDevice {
  readonly fieldId: FieldId;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly place: HirResourcePlace;
  readonly roots: readonly PendingImageDeviceRoot[];
  readonly sourceOrigin: import("./ids").HirOriginId;
}

export interface LowerSelectedImageResult {
  readonly images: readonly HirImage[];
  readonly context: HirLoweringContext;
}

function reservePlatformBrands(context: HirLoweringContext): void {
  for (const binding of context.program.certifiedPlatformBindings.entries()) {
    context.brands.reservePlatformContractBrand({
      sourceFunctionId: binding.functionId,
      primitiveId: binding.primitiveId,
      contractId: binding.contractId,
      targetId: binding.targetId,
    });
  }
}

function allocateReservedBrands(context: HirLoweringContext): readonly HirBrand[] {
  const allocatedBrands = context.brands.allocateBrands();
  for (const brand of allocatedBrands) {
    context.proofMetadata.addBrand(brand);
  }
  return allocatedBrands;
}

function reportMissingDeviceSurface(input: {
  readonly context: HirLoweringContext;
  readonly image: ImageRecord;
  readonly field: FieldRecord;
}): void {
  const sourceOrigin = input.context.origins.forSynthetic({
    moduleId: input.image.moduleId,
    span: input.field.span,
    stableDetail: `image-device-missing:${input.field.id}`,
  });
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_IMAGE_DEVICE_SURFACE_MISSING",
      message: "Checked image device surface data is missing for an image device field.",
      moduleId: input.image.moduleId,
      spanStart: input.field.span.start,
      spanEnd: input.field.span.end,
      originId: sourceOrigin,
      ownerKey: `image:${input.image.id}`,
      originKey: `field:${input.field.id}`,
      stableDetail: `missing-device-surface:${input.field.id}`,
    }),
  );
}

export function lowerSelectedImage(input: {
  readonly context: HirLoweringContext;
}): LowerSelectedImageResult {
  reservePlatformBrands(input.context);
  const seed = input.context.image;
  if (seed === undefined) {
    allocateReservedBrands(input.context);
    return { images: [], context: input.context };
  }
  const imageRecord = input.context.index.image(seed.imageId);
  if (imageRecord === undefined) {
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_IMAGE_ENTRY_SURFACE_MISSING",
        message: "Checked image seed does not correspond to an indexed image declaration.",
        moduleId: moduleId(0),
        spanStart: seed.sourceSpan.start,
        spanEnd: seed.sourceSpan.end,
        ownerKey: `image:${seed.imageId}`,
        originKey: `image:${seed.imageId}`,
        stableDetail: "missing-image-entry",
      }),
    );
    allocateReservedBrands(input.context);
    return { images: [], context: input.context };
  }
  if (seed.entryFunctionId === undefined) {
    const sourceOrigin = input.context.origins.forSynthetic({
      moduleId: imageRecord.moduleId,
      span: seed.sourceSpan,
      stableDetail: `image-entry-missing:${seed.imageId}`,
    });
    input.context.diagnostics.report(
      hirDiagnostic({
        code: "HIR_IMAGE_ENTRY_SURFACE_MISSING",
        message: "Checked image seed is missing an entry function.",
        moduleId: imageRecord.moduleId,
        spanStart: seed.sourceSpan.start,
        spanEnd: seed.sourceSpan.end,
        originId: sourceOrigin,
        ownerKey: `image:${seed.imageId}`,
        originKey: `origin:${sourceOrigin}`,
        stableDetail: "missing-entry-function",
      }),
    );
    allocateReservedBrands(input.context);
    return { images: [], context: input.context };
  }

  const imageOriginId = ownedHirImageOriginId({ kind: "image", imageId: seed.imageId }, 0);
  const sourceOrigin = input.context.origins.forSynthetic({
    moduleId: imageRecord.moduleId,
    span: seed.sourceSpan,
    stableDetail: `image:${seed.imageId}`,
  });
  input.context.proofMetadata.addImageOrigin({
    imageOriginId,
    imageId: seed.imageId,
    sourceOrigin,
  });

  const imagePlaces = new HirResourcePlaceInterner({ kind: "image", imageId: seed.imageId });
  const checkedDeviceFieldIds = new Set(seed.devices.map((device) => device.fieldId));
  for (const fieldId of imageRecord.deviceFieldIds) {
    if (checkedDeviceFieldIds.has(fieldId)) continue;
    const field = input.context.index.field(fieldId);
    if (field === undefined) continue;
    reportMissingDeviceSurface({ context: input.context, image: imageRecord, field });
  }

  const pendingDevices: PendingImageDevice[] = [];
  for (const device of seed.devices) {
    const deviceOrigin = input.context.origins.forSynthetic({
      moduleId: imageRecord.moduleId,
      span: device.span,
      stableDetail: `image-device:${device.fieldId}`,
    });
    const place = imagePlaces.placeForProjection({
      root: { kind: "imageDevice", imageId: seed.imageId, fieldId: device.fieldId },
      projection: [],
      type: device.type,
      resourceKind: device.resourceKind,
      sourceOrigin: deviceOrigin,
    });
    input.context.proofMetadata.addResourcePlace(place);
    const roots = device.uniqueEdgeRoots.map((rootKey) => {
      const rootOrigin = input.context.origins.forSynthetic({
        moduleId: imageRecord.moduleId,
        span: device.span,
        stableDetail: `image-device-root:${device.fieldId}:${rootKey}`,
      });
      const rootPlace = imagePlaces.placeForProjection({
        root: { kind: "imageDevice", imageId: seed.imageId, fieldId: device.fieldId },
        projection: [{ kind: "variant", name: `uniqueEdgeRoot:${rootKey}` }],
        type: device.type,
        resourceKind: device.resourceKind,
        sourceOrigin: rootOrigin,
      });
      input.context.proofMetadata.addResourcePlace(rootPlace);
      return {
        place: rootPlace,
        brandKey: input.context.brands.reserveImageFieldRootBrand({
          imageId: seed.imageId,
          fieldId: device.fieldId,
          uniqueEdgeRootKey: rootKey,
        }),
      };
    });
    input.context.proofMetadata.addImageOrigin({
      imageOriginId: ownedHirImageOriginId(
        { kind: "image", imageId: seed.imageId },
        input.context.proofMetadata.count("imageOrigin"),
      ),
      imageId: seed.imageId,
      fieldId: device.fieldId,
      deviceSurfaceId: device.deviceSurfaceId,
      sourceOrigin: deviceOrigin,
    });
    pendingDevices.push({
      fieldId: device.fieldId,
      deviceSurfaceId: device.deviceSurfaceId,
      place,
      roots,
      sourceOrigin: deviceOrigin,
    });
  }
  const allocatedBrands = allocateReservedBrands(input.context);
  const brandIdsByKey = new Map(
    allocatedBrands.map((brand) => [brand.canonicalKey, brand.brandId]),
  );
  const devices: HirImageDevice[] = pendingDevices.map((device) => ({
    fieldId: device.fieldId,
    deviceSurfaceId: device.deviceSurfaceId,
    place: device.place,
    rootPlaces: device.roots.map((root) => root.place),
    brandIds: device.roots
      .map((root) => brandIdsByKey.get(root.brandKey))
      .filter((brandId): brandId is NonNullable<typeof brandId> => brandId !== undefined),
    sourceOrigin: device.sourceOrigin,
  }));

  return {
    images: [
      {
        imageId: seed.imageId,
        itemId: imageRecord.itemId,
        entryFunctionId: seed.entryFunctionId,
        devices,
        sourceOrigin,
      },
    ],
    context: input.context,
  };
}
