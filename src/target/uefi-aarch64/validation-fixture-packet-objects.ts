import type { AArch64LinkInputModule } from "../../linker";
import {
  AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
  aarch64ObjectByteProvenance,
  aarch64ObjectFragment,
  aarch64ObjectModule,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  type AArch64BackendTargetSurface,
} from "../aarch64";
import { stableHash, stableJson } from "../../shared/stable-json";
import type { UefiAArch64ValidationFixturePacketSource } from "./package-input";
import {
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_MODULE_KEY,
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_OBJECT_FINGERPRINT,
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SECTION_KEY,
  UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SYMBOL_NAME,
} from "./validation-fixture-packet-rule";
import { passedVerification, uefiAArch64Ok, type UefiAArch64TargetResult } from "./result";

const VALIDATION_FIXTURE_PACKET_OBJECT_VERIFIER_KEY =
  "uefi-aarch64-validation-fixture-packet-objects";

export interface UefiAArch64ValidationFixturePacketPointer {
  readonly symbolName: string;
  readonly stableKey: string;
  readonly fingerprint: string;
}

export interface MaterializeUefiAArch64ValidationFixturePacketObjectModuleInput {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly validationFixturePacketSources: readonly UefiAArch64ValidationFixturePacketSource[];
}

export interface MaterializeUefiAArch64ValidationFixturePacketObjectModuleOutput {
  readonly modules: readonly AArch64LinkInputModule[];
}

export function uefiAArch64ValidationFixturePacketPointer(
  source: UefiAArch64ValidationFixturePacketSource,
): UefiAArch64ValidationFixturePacketPointer {
  return Object.freeze({
    symbolName: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SYMBOL_NAME,
    stableKey: source.stableKey,
    fingerprint: validationFixturePacketFingerprint(source),
  });
}

export function materializeUefiAArch64ValidationFixturePacketObjectModule(
  input: MaterializeUefiAArch64ValidationFixturePacketObjectModuleInput,
): UefiAArch64TargetResult<MaterializeUefiAArch64ValidationFixturePacketObjectModuleOutput> {
  const source = input.validationFixturePacketSources[0];
  if (source === undefined) {
    return uefiAArch64Ok({
      value: Object.freeze({ modules: Object.freeze([]) }),
      verification: passedVerification(
        VALIDATION_FIXTURE_PACKET_OBJECT_VERIFIER_KEY,
        "materialize",
      ),
    });
  }

  const pointer = uefiAArch64ValidationFixturePacketPointer(source);
  const bytes = Object.freeze([...source.bytes]);
  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.backendTarget.backendSurfaceFingerprint,
    closedImagePlanFingerprint: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_OBJECT_FINGERPRINT,
    sections: [
      aarch64ObjectSection({
        stableKey: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SECTION_KEY,
        classKey: AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA,
        alignmentBytes: 1,
        bytes,
        fragments: [
          aarch64ObjectFragment({
            stableKey: `fragment:validation-fixture-packet:${source.stableKey}`,
            sectionKey: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SECTION_KEY,
            startOffsetBytes: 0,
            sizeBytes: bytes.length,
          }),
        ],
      }),
    ],
    symbols: [
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: `symbol:${pointer.symbolName}`,
        linkageName: pointer.symbolName,
        sectionKey: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SECTION_KEY,
        offsetBytes: 0,
      }),
    ],
    byteProvenance: [
      aarch64ObjectByteProvenance({
        stableKey: `byte:validation-fixture-packet:${source.stableKey}`,
        sectionKey: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_SECTION_KEY,
        startOffsetBytes: 0,
        byteLength: bytes.length,
        source: `uefi.validation.fixture-packet:${source.stableKey}:${pointer.fingerprint}`,
        factFamilies: ["uefi-validation-fixture-packet-source"],
      }),
    ],
  });

  return uefiAArch64Ok({
    value: Object.freeze({
      modules: Object.freeze([
        Object.freeze({
          moduleKey: UEFI_AARCH64_VALIDATION_FIXTURE_PACKET_MODULE_KEY,
          objectModule,
        }),
      ]),
    }),
    verification: passedVerification(VALIDATION_FIXTURE_PACKET_OBJECT_VERIFIER_KEY, "materialize"),
  });
}

function validationFixturePacketFingerprint(
  source: UefiAArch64ValidationFixturePacketSource,
): string {
  return `uefi-validation-fixture-packet:${stableHash(
    stableJson({
      primitiveId: source.primitiveId,
      feature: source.feature,
      stableKey: source.stableKey,
      bytes: source.bytes,
    }),
  )}`;
}
