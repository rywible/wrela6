import { publishedLayoutTypeKeyForCheckedType } from "./layout-type-resolution";
import type { MonoImageDevice, MonomorphizedHirProgram } from "../mono/mono-hir";
import type { MonoCheckedType } from "../mono/mono-hir";
import type { DeviceSurfaceId, FieldId, TargetTypeId } from "../semantic/ids";
import { targetTypeId } from "../semantic/ids";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import { compareCodeUnitStrings } from "./deterministic-sort";
import type { LayoutBuilderResult } from "./builder-context";
import { layoutDiagnostic, type LayoutDiagnostic } from "./diagnostics";
import { imageDeviceOwnerKey, imageOwnerKey } from "./layout-owners";
import type { LayoutTypeResolver } from "./layout-type-resolver";
import type {
  LayoutImageDeviceFact,
  LayoutImageDeviceFactTable,
  LayoutImageDeviceKey,
  LayoutTypeFactTable,
  LayoutTypeKey,
} from "./layout-program";
import { seedPrimitiveTypeFacts } from "./primitive-layout";
import type {
  LayoutDeviceSurfaceCatalog,
  LayoutDeviceSurfaceSpec,
  LayoutPrimitiveTypeRef,
  LayoutTargetSurface,
} from "./target-layout";
import { layoutDeterministicTable, layoutImageDeviceKeyString } from "./type-key";

export interface ComputeImageDeviceFactsInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
  readonly representation?:
    | { readonly kind: "zeroSizedCapability" }
    | { readonly kind: "targetHandle"; readonly targetTypeId?: TargetTypeId };
  readonly types?: LayoutTypeFactTable;
  readonly resolver?: LayoutTypeResolver;
}

export interface ComputeImageDeviceFactsValue {
  readonly devices: LayoutImageDeviceFactTable;
}

function layoutTypeKeyFromRef(ref: LayoutPrimitiveTypeRef): LayoutTypeKey {
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

function deviceSurfaceRepresentation(
  representation: NonNullable<ComputeImageDeviceFactsInput["representation"]>,
): LayoutDeviceSurfaceSpec["representation"] {
  switch (representation.kind) {
    case "zeroSizedCapability":
      return { kind: "zeroSizedCapability" };
    case "targetHandle":
      return {
        kind: "targetHandle",
        type: {
          kind: "target",
          targetTypeId: representation.targetTypeId ?? targetTypeId("Ptr"),
        },
      };
    default: {
      const unreachable: never = representation;
      return unreachable;
    }
  }
}

function buildDeviceSurfaceCatalog(
  entries: readonly LayoutDeviceSurfaceSpec[],
): LayoutDeviceSurfaceCatalog {
  const sorted = [...entries].sort((left, right) =>
    compareCodeUnitStrings(String(left.deviceSurfaceId), String(right.deviceSurfaceId)),
  );
  const byId = new Map<DeviceSurfaceId, LayoutDeviceSurfaceSpec>(
    sorted.map((entry) => [entry.deviceSurfaceId, entry]),
  );
  return {
    get(deviceSurfaceId) {
      return byId.get(deviceSurfaceId);
    },
    entries() {
      return sorted.slice();
    },
  };
}

function targetWithConfiguredDeviceSurfaces(
  target: LayoutTargetSurface,
  devices: readonly MonoImageDevice[],
  representation: ComputeImageDeviceFactsInput["representation"],
): LayoutTargetSurface {
  if (representation === undefined) {
    return target;
  }

  const byId = new Map<DeviceSurfaceId, LayoutDeviceSurfaceSpec>(
    target.deviceSurfaces.entries().map((entry) => [entry.deviceSurfaceId, entry]),
  );
  for (const device of devices) {
    if (byId.has(device.deviceSurfaceId)) {
      continue;
    }
    byId.set(device.deviceSurfaceId, {
      deviceSurfaceId: device.deviceSurfaceId,
      representation: deviceSurfaceRepresentation(representation),
    });
  }

  return {
    ...target,
    deviceSurfaces: buildDeviceSurfaceCatalog([...byId.values()]),
  };
}

function missingDeviceSurfaceDiagnostic(input: {
  readonly target: LayoutTargetSurface;
  readonly imageInstanceId: ComputeImageDeviceFactsInput["program"]["image"]["instanceId"];
  readonly fieldId: FieldId;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly sourceOrigin: string;
}): LayoutDiagnostic {
  return layoutDiagnostic({
    severity: "error",
    code: "LAYOUT_MISSING_DEVICE_SURFACE",
    message: "Missing target device surface layout for image device.",
    sourceOrigin: input.sourceOrigin,
    ownerKey: String(imageDeviceOwnerKey(input.imageInstanceId, input.fieldId)),
    rootCauseKey: `device-surface:${String(input.deviceSurfaceId)}`,
    stableDetail: `${String(input.target.targetId)}:${String(input.deviceSurfaceId)}`,
  });
}

function resolveDeviceType(
  program: MonomorphizedHirProgram,
  type: MonoCheckedType,
  resolver: LayoutTypeResolver | undefined,
): LayoutTypeKey | undefined {
  if (resolver !== undefined) {
    const resolved = resolver.get(type);
    if (resolved !== undefined) {
      return resolved;
    }
  }

  return publishedLayoutTypeKeyForCheckedType(type, program);
}

function imageDeviceKey(left: {
  readonly imageInstanceId: LayoutImageDeviceKey["imageInstanceId"];
  readonly fieldId: FieldId;
}): string {
  return `${String(left.imageInstanceId)}:${String(left.fieldId)}`;
}

function sortImageDevices(
  imageInstanceId: ComputeImageDeviceFactsInput["program"]["image"]["instanceId"],
  devices: readonly MonoImageDevice[],
): readonly MonoImageDevice[] {
  return [...devices].sort((left, right) =>
    compareCodeUnitStrings(
      imageDeviceKey({ imageInstanceId, fieldId: left.fieldId }),
      imageDeviceKey({ imageInstanceId, fieldId: right.fieldId }),
    ),
  );
}

function buildImageDeviceFact(input: {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
  readonly device: MonoImageDevice;
  readonly types: LayoutTypeFactTable;
  readonly resolver: LayoutTypeResolver | undefined;
}): { readonly fact?: LayoutImageDeviceFact; readonly diagnostics: readonly LayoutDiagnostic[] } {
  const diagnostics: LayoutDiagnostic[] = [];
  const imageInstanceId = input.program.image.instanceId;
  const deviceSurface = input.target.deviceSurfaces.get(input.device.deviceSurfaceId);
  if (deviceSurface === undefined) {
    diagnostics.push(
      missingDeviceSurfaceDiagnostic({
        target: input.target,
        imageInstanceId,
        fieldId: input.device.fieldId,
        deviceSurfaceId: input.device.deviceSurfaceId,
        sourceOrigin: input.device.sourceOrigin,
      }),
    );
    return { diagnostics };
  }

  const deviceType = resolveDeviceType(input.program, input.device.place.type, input.resolver);
  if (deviceType === undefined) {
    diagnostics.push(
      layoutDiagnostic({
        severity: "error",
        code: "LAYOUT_MISSING_TYPE_RESOLUTION",
        message: "Missing layout type key for image device source type.",
        sourceOrigin: input.device.sourceOrigin,
        ownerKey: String(imageDeviceOwnerKey(imageInstanceId, input.device.fieldId)),
        rootCauseKey: String(imageDeviceOwnerKey(imageInstanceId, input.device.fieldId)),
        stableDetail: checkedTypeFingerprint(input.device.place.type),
      }),
    );
    return { diagnostics };
  }

  const representation = buildDeviceRepresentation({
    deviceSurface,
    types: input.types,
    device: input.device,
    imageInstanceId,
  });
  if (representation.diagnostics.length > 0) {
    return { diagnostics: representation.diagnostics };
  }

  return {
    fact: {
      key: {
        imageInstanceId,
        fieldId: input.device.fieldId,
      },
      deviceSurfaceId: input.device.deviceSurfaceId,
      deviceType,
      representation: representation.value!,
      brandIds: input.device.brandIds,
      sourceOrigin: input.device.sourceOrigin,
    },
    diagnostics,
  };
}

function buildDeviceRepresentation(input: {
  readonly deviceSurface: LayoutDeviceSurfaceSpec;
  readonly types: LayoutTypeFactTable;
  readonly device: MonoImageDevice;
  readonly imageInstanceId: ComputeImageDeviceFactsInput["program"]["image"]["instanceId"];
}):
  | {
      readonly value: LayoutImageDeviceFact["representation"];
      readonly diagnostics: readonly [];
    }
  | {
      readonly value?: undefined;
      readonly diagnostics: readonly LayoutDiagnostic[];
    } {
  switch (input.deviceSurface.representation.kind) {
    case "zeroSizedCapability":
      return {
        value: { kind: "zeroSizedCapability" },
        diagnostics: [],
      };
    case "targetHandle": {
      const handleType = layoutTypeKeyFromRef(input.deviceSurface.representation.type);
      const handleLayout = input.types.get(handleType);
      if (handleLayout === undefined) {
        return {
          diagnostics: [
            layoutDiagnostic({
              severity: "error",
              code: "LAYOUT_MISSING_PRIMITIVE_TYPE",
              message: "Missing primitive layout fact for target device handle type.",
              sourceOrigin: input.device.sourceOrigin,
              ownerKey: String(imageDeviceOwnerKey(input.imageInstanceId, input.device.fieldId)),
              rootCauseKey: String(
                imageDeviceOwnerKey(input.imageInstanceId, input.device.fieldId),
              ),
              stableDetail: layoutTypeKeyStableDetail(handleType),
            }),
          ],
        };
      }
      return {
        value: {
          kind: "targetHandle",
          type: handleType,
          layout: handleLayout,
        },
        diagnostics: [],
      };
    }
    default: {
      const unreachable: never = input.deviceSurface.representation;
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

export function computeImageDeviceFacts(
  input: ComputeImageDeviceFactsInput,
): LayoutBuilderResult<ComputeImageDeviceFactsValue> {
  const ownerKey = imageOwnerKey(input.program.image.instanceId);
  const configuredTarget = targetWithConfiguredDeviceSurfaces(
    input.target,
    input.program.image.devices,
    input.representation,
  );
  const primitiveFacts =
    input.types === undefined ? seedPrimitiveTypeFacts(configuredTarget) : undefined;
  const types =
    input.types ?? (primitiveFacts?.kind === "ok" ? primitiveFacts.value.types : undefined);
  const diagnostics: LayoutDiagnostic[] = [];

  if (types === undefined) {
    if (primitiveFacts?.kind === "error") {
      diagnostics.push(...primitiveFacts.diagnostics);
    }
    return {
      kind: "error",
      ownerKey,
      dependencies: [],
      diagnostics,
    };
  }

  if (primitiveFacts?.kind === "error") {
    diagnostics.push(
      ...primitiveFacts.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    );
  }

  const facts: LayoutImageDeviceFact[] = [];
  for (const device of sortImageDevices(
    input.program.image.instanceId,
    input.program.image.devices,
  )) {
    const result = buildImageDeviceFact({
      program: input.program,
      target: configuredTarget,
      device,
      types,
      resolver: input.resolver,
    });
    diagnostics.push(...result.diagnostics);
    if (result.fact !== undefined) {
      facts.push(result.fact);
    }
  }

  const devices = layoutDeterministicTable({
    entries: facts,
    keyOf: (entry) => entry.key,
    keyString: layoutImageDeviceKeyString,
  });

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
    value: { devices },
    diagnostics,
  };
}
