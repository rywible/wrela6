import type { DeviceSurfaceId, FieldId, UniqueEdgeRootKey } from "../ids";
import type { FieldRecord } from "../item-index";
import type { ItemIndex } from "../item-index";
import type { CheckedImageRootSelection } from "./image-root-selection";
import type { SemanticTargetSurface, DeviceSurfaceSpec } from "./platform-surface";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import type { CoreTypeCatalog } from "../names/core-types";
import { checkTypeReference } from "./type-reference-checker";
import type { CheckedType } from "./type-model";
import type { ResourceKindContext } from "./resource-kind-checker";
import type { CheckedResourceKind } from "./resource-kind";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { duplicateUniqueEdgeRoot, targetUnavailableImageDevice } from "./diagnostics";
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
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly kindContext: ResourceKindContext;
}

export interface CheckImageDevicesResult {
  readonly devices: readonly CheckedImageDevice[];
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function findDeviceSurfaceForCheckedType(
  targetSurface: SemanticTargetSurface,
  checkedType: CheckedType,
  fieldTypeView: any,
): DeviceSurfaceSpec | undefined {
  if (checkedType.kind === "target") {
    const targetIdStr = String(checkedType.targetTypeId);
    return targetSurface.deviceSurfaces.find(
      (device) => String(device.deviceSurfaceId) === targetIdStr,
    );
  }
  if (checkedType.kind === "source") {
    const typeName = fieldTypeView?.qualifiedNameText?.() ?? String(checkedType.typeId);
    return targetSurface.deviceSurfaces.find((device) => device.name === typeName);
  }
  return undefined;
}

export function checkImageDevices(input: CheckImageDevicesInput): CheckImageDevicesResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const devices: CheckedImageDevice[] = [];
  const seenRoots = new Map<UniqueEdgeRootKey, FieldRecord>();

  const imageRecord = input.selection.image;

  for (const fieldId of imageRecord.deviceFieldIds) {
    const field = input.index.field(fieldId);
    if (field === undefined) continue;

    const checkedType = checkTypeReference({
      moduleId: imageRecord.moduleId,
      view: field.type,
      index: input.index,
      referenceLookup: input.referenceLookup,
      coreTypes: input.coreTypes,
    });
    diagnostics.push(...checkedType.diagnostics);

    const deviceSurface = findDeviceSurfaceForCheckedType(
      input.targetSurface,
      checkedType.type,
      field.type,
    );

    if (deviceSurface === undefined) {
      diagnostics.push(
        targetUnavailableImageDevice(
          field.name,
          "No matching device surface in target catalog",
          field.span,
          undefined as any,
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
          undefined as any,
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
          undefined as any,
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
          undefined as any,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
      continue;
    }
    for (const requiredFeature of deviceSurface.availability.features) {
      if (!input.selection.availability.features.includes(requiredFeature)) {
        diagnostics.push(
          targetUnavailableImageDevice(
            field.name,
            `Device surface requires feature '${requiredFeature}' which is not available`,
            field.span,
            undefined as any,
            { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
          ),
        );
        continue;
      }
    }

    const deviceResourceKind: CheckedResourceKind = {
      kind: "concrete",
      value: deviceSurface.resourceKind,
    };

    const checkedDevice: CheckedImageDevice = {
      fieldId: field.id,
      deviceSurfaceId: deviceSurface.deviceSurfaceId,
      type: checkedType.type,
      resourceKind: deviceResourceKind,
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
            undefined as any,
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
