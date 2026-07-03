import { coreTypeId, imageProfileId } from "../../semantic/ids";
import type { ItemIndex } from "../../semantic/item-index";
import {
  platformPrimitiveCatalog,
  type PlatformPrimitiveSpec,
  type SemanticTargetSurface,
  type TargetFunctionSignature,
} from "../../semantic/surface/platform-surface";
import { concreteKind } from "../../semantic/surface/resource-kind";
import { coreCheckedType } from "../../semantic/surface/type-model";
import type { CheckedType } from "../../semantic/surface/type-model";
import { canonicalUefiAArch64SemanticTargetSurface } from "./platform-catalog";
import {
  uefiAArch64DefaultEntryStatusBridgeType,
  uefiAArch64SourceStatusBridgeType,
  type UefiAArch64StatusBridgeType,
} from "./status-abi-bridge";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

export function packageSemanticTargetSurface(
  _target: UefiAArch64TargetDriverSurface,
  index: ItemIndex,
): SemanticTargetSurface {
  const canonical = canonicalUefiAArch64SemanticTargetSurface();
  const sourceStatusBridge = uefiAArch64SourceStatusBridgeType(index);
  const entryStatusBridge = sourceStatusBridge ?? uefiAArch64DefaultEntryStatusBridgeType();
  return Object.freeze({
    ...canonical,
    platformPrimitives:
      sourceStatusBridge === undefined
        ? canonical.platformPrimitives
        : platformPrimitiveCatalog(
            canonical.platformPrimitives
              .entries()
              .map((primitive) =>
                primitiveWithSourceStatusSignature(primitive, sourceStatusBridge),
              ),
          ),
    imageProfiles: Object.freeze([
      Object.freeze({
        profileId: imageProfileId("uefi"),
        name: "uefi",
        declarationKind: "uefi" as const,
        entryFunctionName: "boot",
        entrySignature: Object.freeze({
          genericArity: 0,
          receiver: undefined,
          parameters: Object.freeze([]),
          returnType: entryStatusBridge.type,
          returnKind: entryStatusBridge.resourceKind,
          requiredModifiers: Object.freeze([]),
          forbiddenModifiers: Object.freeze([]),
        }),
        availableDeviceSurfaces: Object.freeze([]),
        availablePlatformFamilies: Object.freeze([]),
      }),
    ]),
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
