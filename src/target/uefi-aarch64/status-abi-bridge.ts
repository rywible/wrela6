import type { ItemIndex } from "../../semantic/item-index";
import { coreTypeId } from "../../semantic/ids";
import { concreteKind } from "../../semantic/surface/resource-kind";
import type { CheckedResourceKind } from "../../semantic/surface/resource-kind";
import { coreCheckedType, sourceCheckedType } from "../../semantic/surface/type-model";
import type { CheckedType } from "../../semantic/surface/type-model";

export const UEFI_AARCH64_STATUS_TARGET_TYPE_KEY = "uefi.Status";

export const UEFI_AARCH64_SOURCE_STATUS_BRIDGE = Object.freeze({
  sourceEnumName: "UefiStatus",
  targetTypeKey: UEFI_AARCH64_STATUS_TARGET_TYPE_KEY,
  cases: Object.freeze([
    "success",
    "load_error",
    "invalid_parameter",
    "unsupported",
    "bad_buffer_size",
    "buffer_too_small",
    "device_error",
    "not_found",
    "aborted",
    "security_violation",
  ]),
});

export interface UefiAArch64StatusBridgeType {
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
}

export function uefiAArch64SourceStatusBridgeType(
  index: ItemIndex,
): UefiAArch64StatusBridgeType | undefined {
  const statusType = index
    .types()
    .find((type) => type.name === UEFI_AARCH64_SOURCE_STATUS_BRIDGE.sourceEnumName);
  if (statusType === undefined) return undefined;

  const statusItem = index.item(statusType.itemId);
  if (statusItem?.kind !== "enum") return undefined;

  const caseNames = index
    .items()
    .filter((item) => item.kind === "enumCase" && item.parentItemId === statusItem.id)
    .map((item) => item.name);

  if (!sameStringSequence(caseNames, UEFI_AARCH64_SOURCE_STATUS_BRIDGE.cases)) {
    return undefined;
  }

  return Object.freeze({
    type: sourceCheckedType({ itemId: statusType.itemId, typeId: statusType.id }),
    resourceKind: concreteKind("Copy"),
  });
}

export function uefiAArch64DefaultEntryStatusBridgeType(): UefiAArch64StatusBridgeType {
  return Object.freeze({
    type: coreCheckedType(coreTypeId("Never")),
    resourceKind: concreteKind("Never"),
  });
}

function sameStringSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
