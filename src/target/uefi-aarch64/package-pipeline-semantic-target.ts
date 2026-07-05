import {
  coreTypeId,
  deviceSurfaceId,
  imageProfileId,
  targetTypeId,
  uniqueEdgeRootKey,
} from "../../semantic/ids";
import type { ItemIndex } from "../../semantic/item-index";
import {
  platformPrimitiveCatalog,
  type DeviceSurfaceSpec,
  type PlatformPrimitiveSpec,
  type SemanticTargetSurface,
  type TargetFunctionSignature,
  type TargetParameterSpec,
} from "../../semantic/surface/platform-surface";
import { concreteKind, joinResourceKinds } from "../../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../../semantic/surface/resource-kind";
import {
  coreCheckedType,
  sourceCheckedType,
  targetCheckedType,
} from "../../semantic/surface/type-model";
import type { CheckedType } from "../../semantic/surface/type-model";
import { canonicalUefiAArch64SemanticTargetSurface } from "./platform-catalog";
import { UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_STREAM_PRIMITIVE_ID } from "./validation-fixture-packet-rule";
import {
  uefiAArch64DefaultEntryStatusBridgeType,
  uefiAArch64SourceStatusBridgeType,
  type UefiAArch64StatusBridgeType,
} from "./status-abi-bridge";
import { uefiAArch64SourceApiBridge } from "./source-api-bridge";
import type { UefiAArch64SourceApiBridge, UefiAArch64SourceApiTypeName } from "./source-api-bridge";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

export function packageSemanticTargetSurface(
  _target: UefiAArch64TargetDriverSurface,
  index: ItemIndex,
): SemanticTargetSurface {
  const canonical = canonicalUefiAArch64SemanticTargetSurface();
  const sourceStatusBridge = uefiAArch64SourceStatusBridgeType(index);
  const sourceApiBridge = uefiAArch64SourceApiBridge(index);
  const validationFixturePacketStreamType = validationFixturePacketStreamSourceType(index);
  const entryStatusBridge = sourceStatusBridge ?? uefiAArch64DefaultEntryStatusBridgeType();
  const entrySignature =
    sourceApiBridge === undefined || !uefiBootDeclaresSourceVisibleParameters(index)
      ? statusEntrySignature(entryStatusBridge)
      : sourceFirmwareEntrySignature({
          firmwareType: sourceApiBridge.firmwareType,
          firmwareResourceKind: sourceApiBridge.firmwareResourceKind,
          resultType: sourceApiBridge.resultType,
        });
  const platformPrimitives = canonical.platformPrimitives.entries().map((primitive) => {
    const statusPrimitive =
      sourceStatusBridge === undefined
        ? primitive
        : primitiveWithSourceStatusSignature(primitive, sourceStatusBridge);
    const sourceApiPrimitive =
      sourceApiBridge === undefined
        ? statusPrimitive
        : primitiveWithSourceApiSignature(statusPrimitive, sourceApiBridge);
    return validationFixturePacketStreamType === undefined
      ? sourceApiPrimitive
      : primitiveWithValidationFixturePacketStreamSignature(
          sourceApiPrimitive,
          validationFixturePacketStreamType,
        );
  });
  const networkDeviceSurface = sourceApiBridgeNetworkDeviceSurface(
    canonical.targetId,
    sourceApiBridge,
  );
  const availableDeviceSurfaces =
    networkDeviceSurface === undefined
      ? Object.freeze([])
      : Object.freeze([networkDeviceSurface.deviceSurfaceId]);

  return Object.freeze({
    ...canonical,
    platformPrimitives: platformPrimitiveCatalog(platformPrimitives),
    deviceSurfaces:
      networkDeviceSurface === undefined
        ? canonical.deviceSurfaces
        : Object.freeze([...canonical.deviceSurfaces, networkDeviceSurface]),
    imageProfiles: Object.freeze([
      Object.freeze({
        profileId: imageProfileId("uefi"),
        name: "uefi",
        declarationKind: "uefi" as const,
        entryFunctionName: "boot",
        entrySignature,
        availableDeviceSurfaces,
        availablePlatformFamilies: Object.freeze([]),
      }),
    ]),
  });
}

function uefiBootDeclaresSourceVisibleParameters(index: ItemIndex): boolean {
  for (const image of index.images()) {
    const bootFunction = index
      .functions()
      .find((function_) => function_.parentItemId === image.itemId && function_.name === "boot");
    if (bootFunction !== undefined && index.parametersForFunction(bootFunction.id).length > 0) {
      return true;
    }
  }
  return false;
}

function statusEntrySignature(statusBridge: UefiAArch64StatusBridgeType): TargetFunctionSignature {
  return Object.freeze({
    genericArity: 0,
    receiver: undefined,
    parameters: Object.freeze([]),
    returnType: statusBridge.type,
    returnKind: statusBridge.resourceKind,
    requiredModifiers: Object.freeze([]),
    forbiddenModifiers: Object.freeze([]),
  });
}

function sourceFirmwareEntrySignature(input: {
  readonly firmwareType: CheckedType;
  readonly firmwareResourceKind: import("../../semantic/surface/resource-kind").CheckedResourceKind;
  readonly resultType: CheckedType;
}): TargetFunctionSignature {
  return Object.freeze({
    genericArity: 0,
    receiver: undefined,
    parameters: Object.freeze([
      Object.freeze({
        type: input.firmwareType,
        mode: "observe" as const,
        resourceKind: input.firmwareResourceKind,
      }),
    ]),
    returnType: input.resultType,
    returnKind: concreteKind("Copy"),
    requiredModifiers: Object.freeze([]),
    forbiddenModifiers: Object.freeze([]),
  });
}

function primitiveWithSourceStatusSignature(
  primitive: PlatformPrimitiveSpec,
  statusBridge: UefiAArch64StatusBridgeType,
): PlatformPrimitiveSpec {
  const primitiveId = String(primitive.primitiveId);
  if (
    primitiveId !== "uefi.console.outputString" &&
    primitiveId !== "uefi.boot.exitBootServices" &&
    primitiveId !== "uefi.boot.setWatchdogTimer"
  ) {
    return primitive;
  }

  const signature =
    primitiveId === "uefi.boot.setWatchdogTimer"
      ? sourceWatchdogSignature(statusBridge.type)
      : sourceStatusReturnSignature(primitive.signature, statusBridge.type);

  return Object.freeze({ ...primitive, signature });
}

function sourceStatusReturnSignature(
  signature: TargetFunctionSignature,
  statusType: CheckedType,
): TargetFunctionSignature {
  return Object.freeze({
    ...signature,
    returnType: statusType,
    returnKind: concreteKind("Copy"),
  });
}

function primitiveWithSourceApiSignature(
  primitive: PlatformPrimitiveSpec,
  bridge: UefiAArch64SourceApiBridge,
): PlatformPrimitiveSpec {
  const signature = sourceApiSignatureForPrimitive(String(primitive.primitiveId), bridge);
  return signature === undefined ? primitive : Object.freeze({ ...primitive, signature });
}

function primitiveWithValidationFixturePacketStreamSignature(
  primitive: PlatformPrimitiveSpec,
  streamType: CheckedType,
): PlatformPrimitiveSpec {
  if (
    String(primitive.primitiveId) !== UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_STREAM_PRIMITIVE_ID
  ) {
    return primitive;
  }
  return Object.freeze({
    ...primitive,
    signature: Object.freeze({
      ...primitive.signature,
      returnType: streamType,
      returnKind: concreteKind("Stream"),
    }),
    proofContract: Object.freeze({
      ...primitive.proofContract,
      takeModeContracts: Object.freeze([
        Object.freeze({
          kind: "stream" as const,
          itemType: targetCheckedType(targetTypeId("uefi.Ptr")),
          itemResourceKind: concreteKind("Affine"),
        }),
      ]),
    }),
  });
}

function sourceApiSignatureForPrimitive(
  primitiveId: string,
  bridge: UefiAArch64SourceApiBridge,
): TargetFunctionSignature | undefined {
  switch (primitiveId) {
    case "uefi.source.reserveRestrictedMemory":
      return sourceApiResultSignature(bridge, ["UefiFirmware"], "UefiMemoryReserved");
    case "uefi.source.discoverVirtio":
      return sourceApiResultSignature(bridge, ["UefiMemoryReserved"], "VirtioDiscovery");
    case "uefi.source.bindVirtioNet":
      return sourceApiResultSignature(
        bridge,
        ["UefiVirtioBinder", "VirtioDevice", "UefiDeviceName"],
        "NetworkBinding",
      );
    case "uefi.source.planMachine":
      return sourceApiResultSignature(
        bridge,
        ["MachinePlanner", "MachineDeviceBindings"],
        "MachinePlan",
      );
    case "uefi.source.exitBootServices":
      return sourceApiResultSignature(bridge, ["MachinePlan"], "Machine");
    case "uefi.source.splitNetworkDevice":
      return sourceApiPlainSignature(bridge, ["NetworkDevice"], "NetworkPaths");
    default:
      return undefined;
  }
}

function sourceApiResultSignature(
  bridge: UefiAArch64SourceApiBridge,
  parameterTypeNames: readonly UefiAArch64SourceApiTypeName[],
  okTypeName: UefiAArch64SourceApiTypeName,
): TargetFunctionSignature | undefined {
  const okType = bridge.typeByName.get(okTypeName);
  if (okType === undefined) return undefined;
  return sourceApiSignature({
    bridge,
    parameterTypeNames,
    returnType: bridge.resultOf(okType.type),
    returnKind: sourceApiResultResourceKind(bridge, okTypeName, okType.resourceKind),
  });
}

function validationFixturePacketStreamSourceType(index: ItemIndex): CheckedType | undefined {
  const typeRecord = index.types().find((type) => {
    if (type.name !== "ValidationFixturePacketStream") return false;
    const item = index.item(type.itemId);
    return item?.kind === "stream";
  });
  return typeRecord === undefined
    ? undefined
    : sourceCheckedType({ itemId: typeRecord.itemId, typeId: typeRecord.id });
}

function sourceApiPlainSignature(
  bridge: UefiAArch64SourceApiBridge,
  parameterTypeNames: readonly UefiAArch64SourceApiTypeName[],
  returnTypeName: UefiAArch64SourceApiTypeName,
): TargetFunctionSignature | undefined {
  const returnSourceType = bridge.typeByName.get(returnTypeName);
  if (returnSourceType === undefined) return undefined;
  return sourceApiSignature({
    bridge,
    parameterTypeNames,
    returnType: returnSourceType.type,
    returnKind: sourceApiEffectiveResourceKind(returnTypeName, returnSourceType.resourceKind),
  });
}

function sourceApiSignature(input: {
  readonly bridge: UefiAArch64SourceApiBridge;
  readonly parameterTypeNames: readonly UefiAArch64SourceApiTypeName[];
  readonly returnType: CheckedType;
  readonly returnKind: CheckedResourceKind;
}): TargetFunctionSignature | undefined {
  const parameters: TargetParameterSpec[] = [];
  for (const typeName of input.parameterTypeNames) {
    const sourceType = input.bridge.typeByName.get(typeName);
    if (sourceType === undefined) return undefined;
    parameters.push(
      Object.freeze({
        type: sourceType.type,
        mode: "observe" as const,
        resourceKind: sourceApiEffectiveResourceKind(typeName, sourceType.resourceKind),
      }),
    );
  }
  return Object.freeze({
    genericArity: 0,
    receiver: undefined,
    parameters: Object.freeze(parameters),
    returnType: input.returnType,
    returnKind: input.returnKind,
    requiredModifiers: Object.freeze(["private", "platform"]),
    forbiddenModifiers: Object.freeze([]),
  });
}

function sourceApiEffectiveResourceKind(
  typeName: UefiAArch64SourceApiTypeName,
  declaredKind: CheckedResourceKind,
): CheckedResourceKind {
  return SOURCE_API_LINEAR_AGGREGATES.has(typeName) ? concreteKind("Linear") : declaredKind;
}

function sourceApiResultResourceKind(
  bridge: UefiAArch64SourceApiBridge,
  okTypeName: UefiAArch64SourceApiTypeName,
  okDeclaredKind: CheckedResourceKind,
): CheckedResourceKind {
  const okKind = sourceApiEffectiveResourceKind(okTypeName, okDeclaredKind);
  const errKind = bridge.typeByName.get("BootError")?.resourceKind ?? concreteKind("Copy");
  return joinResourceKinds([okKind, errKind]);
}

const SOURCE_API_LINEAR_AGGREGATES = new Set<UefiAArch64SourceApiTypeName>([
  "Machine",
  "MachineDeviceBindings",
  "MachineDevices",
  "NetworkBinding",
  "NetworkPaths",
  "VirtioDevices",
  "VirtioDiscovery",
]);

function sourceApiBridgeNetworkDeviceSurface(
  target: ReturnType<typeof canonicalUefiAArch64SemanticTargetSurface>["targetId"],
  bridge: UefiAArch64SourceApiBridge | undefined,
): DeviceSurfaceSpec | undefined {
  if (bridge?.typeByName.get("NetworkDevice") === undefined) return undefined;
  return Object.freeze({
    deviceSurfaceId: deviceSurfaceId("uefi.net0"),
    name: "net0",
    sourceTypeName: "NetworkDevice",
    availability: Object.freeze({
      targetId: target,
      profiles: Object.freeze([imageProfileId("uefi")]),
      features: Object.freeze([]),
    }),
    resourceKind: "UniqueEdgeRoot" as const,
    uniqueEdgeRoots: Object.freeze([uniqueEdgeRootKey("uefi.net0")]),
  });
}

function sourceWatchdogSignature(statusType: CheckedType): TargetFunctionSignature {
  return Object.freeze({
    genericArity: 0,
    receiver: undefined,
    parameters: Object.freeze([
      Object.freeze({
        type: coreCheckedType(coreTypeId("u64")),
        mode: "observe" as const,
        resourceKind: concreteKind("Copy"),
      }),
    ]),
    returnType: statusType,
    returnKind: concreteKind("Copy"),
    requiredModifiers: Object.freeze(["platform"]),
    forbiddenModifiers: Object.freeze([]),
  });
}
