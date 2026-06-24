import type { DeviceSurfaceId, FieldId, UniqueEdgeRootKey } from "../ids";
import type { FieldRecord } from "../item-index";
import type { ItemIndex } from "../item-index";
import type { CheckedFieldTable } from "./checked-program";
import type { CheckedImageRootSelection } from "./image-root-selection";
import type { SemanticTargetSurface, DeviceSurfaceSpec } from "./platform-surface";
import type { CheckedType } from "./type-model";
import type { ResourceKindContext } from "./resource-kind-checker";
import { resourceKindForType } from "./resource-kind-checker";
import type { CheckedResourceKind, ConcreteResourceKind } from "./resource-kind";
import { concreteKind } from "./resource-kind";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import {
  duplicateUniqueEdgeRoot,
  invalidImageDeviceType,
  targetUnavailableImageDevice,
} from "./diagnostics";
import type { SourceSpan } from "../../frontend";

export interface CheckedImageDevice {
  readonly fieldId: FieldId;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly uniqueEdgeRoots: readonly UniqueEdgeRootKey[];
  readonly span: SourceSpan;
}

export interface CheckImageDevicesInput {
  readonly selection: CheckedImageRootSelection;
  readonly index: ItemIndex;
  readonly checkedFields: CheckedFieldTable;
  readonly targetSurface: SemanticTargetSurface;
  readonly kindContext: ResourceKindContext;
}

export interface CheckImageDevicesResult {
  readonly devices: readonly CheckedImageDevice[];
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function canonicalSourceTypeName(
  checkedType: CheckedType & { kind: "source" },
  index: ItemIndex,
): string | undefined {
  const typeRecord = index.type(checkedType.typeId);
  if (typeRecord === undefined) return undefined;
  const itemRecord = index.item(typeRecord.itemId);
  return itemRecord?.name;
}

function findDeviceSurfaceForCheckedType(
  targetSurface: SemanticTargetSurface,
  checkedType: CheckedType,
  index: ItemIndex,
): DeviceSurfaceSpec | undefined {
  if (checkedType.kind === "source") {
    const typeName = canonicalSourceTypeName(checkedType, index);
    if (typeName === undefined) return undefined;
    return targetSurface.deviceSurfaces.find((device) => device.sourceTypeName === typeName);
  }
  return undefined;
}

export function imageDeviceResourceKind(
  deviceSurfaceKind: ConcreteResourceKind,
): CheckedResourceKind {
  return concreteKind(deviceSurfaceKind);
}

export function canMintUniqueEdgeRoot(input: {
  readonly deviceSurfaceKind: ConcreteResourceKind;
  readonly loweredResourceKind: CheckedResourceKind;
}): boolean {
  return (
    input.deviceSurfaceKind === "UniqueEdgeRoot" ||
    (input.loweredResourceKind.kind === "concrete" &&
      input.loweredResourceKind.value === "UniqueEdgeRoot")
  );
}

export function checkImageDevices(input: CheckImageDevicesInput): CheckImageDevicesResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const devices: CheckedImageDevice[] = [];
  const seenRoots = new Map<UniqueEdgeRootKey, FieldRecord>();

  const imageRecord = input.selection.image;

  for (const fieldId of imageRecord.deviceFieldIds) {
    const field = input.index.field(fieldId);
    if (field === undefined) continue;

    const checkedField = input.checkedFields.get(field.id);
    if (checkedField === undefined) continue;

    const deviceSurface = findDeviceSurfaceForCheckedType(
      input.targetSurface,
      checkedField.type,
      input.index,
    );

    if (deviceSurface === undefined) {
      diagnostics.push(
        targetUnavailableImageDevice(
          field.name,
          "No matching device surface in target catalog",
          field.span,
          undefined,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
      continue;
    }

    const profileDevices = input.selection.profile.availableDeviceSurfaces;
    if (profileDevices.length > 0 && !profileDevices.includes(deviceSurface.deviceSurfaceId)) {
      diagnostics.push(
        targetUnavailableImageDevice(
          field.name,
          "Device surface not available for selected image profile",
          field.span,
          undefined,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
      continue;
    }

    if (deviceSurface.availability.targetId !== input.selection.availability.targetId) {
      diagnostics.push(
        targetUnavailableImageDevice(
          field.name,
          "Device surface not available for selected target",
          field.span,
          undefined,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
      continue;
    }
    if (!deviceSurface.availability.profiles.includes(input.selection.availability.profileId)) {
      diagnostics.push(
        targetUnavailableImageDevice(
          field.name,
          "Device surface not available for selected profile",
          field.span,
          undefined,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
      continue;
    }
    let missingFeature = false;
    for (const requiredFeature of deviceSurface.availability.features) {
      if (!input.selection.availability.features.includes(requiredFeature)) {
        diagnostics.push(
          targetUnavailableImageDevice(
            field.name,
            `Device surface requires feature '${requiredFeature}' which is not available`,
            field.span,
            undefined,
            { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
          ),
        );
        missingFeature = true;
      }
    }
    if (missingFeature) continue;

    const deviceResourceKind = imageDeviceResourceKind(deviceSurface.resourceKind);
    const loweredResourceKind = resourceKindForType({
      type: checkedField.type,
      context: input.kindContext,
    });

    if (
      !canMintUniqueEdgeRoot({
        deviceSurfaceKind: deviceSurface.resourceKind,
        loweredResourceKind,
      })
    ) {
      diagnostics.push(
        invalidImageDeviceType(
          field.name,
          `Resource kind '${deviceSurface.resourceKind}' does not lower to 'UniqueEdgeRoot'`,
          field.span,
          undefined,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
      continue;
    }

    const checkedDevice: CheckedImageDevice = {
      fieldId: field.id,
      deviceSurfaceId: deviceSurface.deviceSurfaceId,
      type: checkedField.type,
      resourceKind:
        loweredResourceKind.kind === "concrete" && loweredResourceKind.value === "UniqueEdgeRoot"
          ? loweredResourceKind
          : deviceResourceKind,
      uniqueEdgeRoots: deviceSurface.uniqueEdgeRoots,
      span: field.span,
    };

    for (const rootKey of deviceSurface.uniqueEdgeRoots) {
      const previous = seenRoots.get(rootKey);
      if (previous !== undefined) {
        diagnostics.push(
          duplicateUniqueEdgeRoot(
            rootKey,
            field.name,
            previous.name,
            field.span,
            previous.span,
            undefined,
            { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
          ),
        );
      }
      seenRoots.set(rootKey, field);
    }

    devices.push(checkedDevice);
  }

  return { devices, diagnostics };
}
