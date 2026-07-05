import { coreTypeId, type TypeId } from "../../semantic/ids";
import type { ItemIndex } from "../../semantic/item-index";
import { concreteKind } from "../../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../../semantic/surface/resource-kind";
import { appliedType, coreCheckedType, sourceCheckedType } from "../../semantic/surface/type-model";
import type { CheckedType } from "../../semantic/surface/type-model";

export type UefiAArch64SourceApiTypeName =
  | "BootError"
  | "Machine"
  | "MachineDevices"
  | "MachineDeviceBindings"
  | "MachinePlan"
  | "MachinePlanner"
  | "NetworkBinding"
  | "NetworkDevice"
  | "NetworkPaths"
  | "UefiDeviceName"
  | "UefiFirmware"
  | "UefiMemoryReserved"
  | "UefiVirtioBinder"
  | "VirtioDevices"
  | "VirtioDevice"
  | "VirtioDiscovery";

export interface UefiAArch64SourceApiType {
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly typeId: TypeId;
}

const SOURCE_API_PATHS = Object.freeze({
  result: Object.freeze([
    "wrela-std/core/result.wr",
    "wrela_std/core/result.wr",
    "wrela_abi/core/result.wr",
  ]),
  firmware: Object.freeze([
    "wrela-std/target/uefi/firmware.wr",
    "wrela_std/target/uefi/firmware.wr",
    "wrela_abi/target/uefi/firmware.wr",
  ]),
  bootError: Object.freeze([
    "wrela-std/target/uefi/boot.wr",
    "wrela-std/target/uefi/firmware.wr",
    "wrela_std/target/uefi/boot.wr",
    "wrela_std/target/uefi/firmware.wr",
    "wrela_abi/target/uefi/boot.wr",
    "wrela_abi/target/uefi/firmware.wr",
  ]),
});

export interface UefiAArch64SourceApiBridge {
  readonly resultType: CheckedType;
  readonly firmwareType: CheckedType;
  readonly firmwareResourceKind: CheckedResourceKind;
  readonly bootErrorType: CheckedType;
  readonly typeByName: ReadonlyMap<UefiAArch64SourceApiTypeName, UefiAArch64SourceApiType>;
  resultOf(okType: CheckedType): CheckedType;
}

export function uefiAArch64SourceApiBridge(
  index: ItemIndex,
): UefiAArch64SourceApiBridge | undefined {
  const resultConstructor = findCanonicalSourceType(index, SOURCE_API_PATHS.result, "Result");
  const sourceTypes = canonicalSourceApiTypes(index);
  const firmwareType = sourceTypes.get("UefiFirmware");
  const bootErrorType = sourceTypes.get("BootError");
  if (
    resultConstructor === undefined ||
    firmwareType === undefined ||
    bootErrorType === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    resultType: sourceResultType(
      resultConstructor.typeId,
      coreCheckedType(coreTypeId("Never")),
      bootErrorType.type,
    ),
    firmwareType: firmwareType.type,
    firmwareResourceKind: firmwareType.resourceKind,
    bootErrorType: bootErrorType.type,
    typeByName: sourceTypes,
    resultOf(okType: CheckedType): CheckedType {
      return sourceResultType(resultConstructor.typeId, okType, bootErrorType.type);
    },
  });
}

function canonicalSourceApiTypes(
  index: ItemIndex,
): ReadonlyMap<UefiAArch64SourceApiTypeName, UefiAArch64SourceApiType> {
  const entries = new Map<UefiAArch64SourceApiTypeName, UefiAArch64SourceApiType>();
  for (const name of SOURCE_API_TYPE_NAMES) {
    const type = findCanonicalSourceType(index, SOURCE_API_PATHS.firmware, name);
    if (type !== undefined) {
      entries.set(name, type);
    }
  }
  return entries;
}

function sourceResultType(
  resultConstructorTypeId: TypeId,
  okType: CheckedType,
  bootErrorType: CheckedType,
): CheckedType {
  return appliedType({
    constructor: { kind: "source", typeId: resultConstructorTypeId },
    arguments: Object.freeze([okType, bootErrorType]),
    resourceKind: concreteKind("Copy"),
  });
}

const SOURCE_API_TYPE_NAMES = Object.freeze([
  "BootError",
  "Machine",
  "MachineDevices",
  "MachineDeviceBindings",
  "MachinePlan",
  "MachinePlanner",
  "NetworkBinding",
  "NetworkDevice",
  "NetworkPaths",
  "UefiDeviceName",
  "UefiFirmware",
  "UefiMemoryReserved",
  "UefiVirtioBinder",
  "VirtioDevices",
  "VirtioDevice",
  "VirtioDiscovery",
] as const satisfies readonly UefiAArch64SourceApiTypeName[]);

function findCanonicalSourceType(
  index: ItemIndex,
  modulePathKeys: readonly string[],
  name: string,
):
  | {
      readonly type: CheckedType;
      readonly resourceKind: CheckedResourceKind;
      readonly typeId: TypeId;
    }
  | undefined {
  const typeRecord = index.types().find((type) => {
    if (type.name !== name) return false;
    const modulePathKey = index.module(type.moduleId)?.pathKey;
    return modulePathKey !== undefined && modulePathKeys.includes(modulePathKey);
  });
  if (typeRecord === undefined) return undefined;

  const item = index.item(typeRecord.itemId);
  return {
    type: sourceCheckedType({ itemId: typeRecord.itemId, typeId: typeRecord.id }),
    resourceKind:
      item?.kind === "edgeClass"
        ? concreteKind(item.modifiers.includes("unique") ? "UniqueEdgeRoot" : "EdgePath")
        : item?.kind === "class" && item.modifiers.includes("private")
          ? concreteKind("PrivateState")
          : concreteKind("Copy"),
    typeId: typeRecord.id,
  };
}
