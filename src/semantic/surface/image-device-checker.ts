import type { DeviceSurfaceId, FieldId, UniqueEdgeRootKey } from "../ids";
import type { FieldRecord } from "../item-index";
import type { ItemIndex } from "../item-index";
import type { CheckedImageRootSelection } from "./image-root-selection";
import type { SemanticTargetSurface, DeviceSurfaceSpec } from "./platform-surface";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import type { CoreTypeCatalog } from "../names/core-types";
import { checkTypeReference } from "./type-reference-checker";
import type { ResourceKindContext } from "./resource-kind-checker";
import { resourceKindForType } from "./resource-kind-checker";
import type { CheckedType } from "./type-model";
import type { CheckedResourceKind } from "./resource-kind";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import {
  duplicateUniqueEdgeRoot,
  targetUnavailableImageDevice,
  invalidImageDeviceType,
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

    const profileDeviceNames = (input.selection as any).profile?.availableDeviceSurfaces ?? [];
    if (
      profileDeviceNames.length > 0 &&
      !profileDeviceNames.includes(deviceSurface.deviceSurfaceId)
    ) {
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

    const resourceKind = resourceKindForType({
      type: checkedType.type,
      context: input.kindContext,
    });

    if (resourceKind.kind !== "error" && resourceKind.kind !== "concrete") {
      diagnostics.push(
        invalidImageDeviceType(
          field.name,
          "Device field resource kind must be concrete",
          field.span,
          undefined as any,
          { moduleId: imageRecord.moduleId, span: field.span, codeTieBreaker: "device" },
        ),
      );
    }

    const checkedDevice: CheckedImageDevice = {
      fieldId: field.id,
      deviceSurfaceId: deviceSurface.deviceSurfaceId,
      type: checkedType.type,
      resourceKind,
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
