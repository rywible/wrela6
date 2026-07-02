import type { AArch64BackendTargetSurface } from "../aarch64/backend/api/backend-target-surface";
import type { AArch64LinkInputModule } from "../../linker";
import {
  aarch64ObjectFragment,
  aarch64ObjectModule,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  verifierRun,
  type AArch64ObjectModule,
} from "../aarch64/backend/object/object-module";
import { aarch64BackendVerificationSummary } from "../aarch64/backend/api/verification-summary";
import { verifyAArch64ObjectModule } from "../aarch64/backend/verify/encoding-object-verifier";
import { stableHash, stableJson } from "../../shared/stable-json";
import type { UefiAArch64FirmwareTableSurface } from "./firmware-tables";
import { lookupUefiFirmwareTableField } from "./firmware-tables";
import type { UefiAArch64ExitBootServicesPolicy } from "./exit-boot-services";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import type { UefiAArch64StatusPolicy } from "./status-conversion";
import type { UefiAArch64EntryWatchdogPolicy } from "./watchdog-policy";
import {
  HELPER_VERIFIER_KEY,
  TEXT_SECTION_KEY,
  byteProvenanceForInstructions,
  encodeEntryInitializeContextInstructions,
  encodeExitBootServicesWithFreshMapInstructions,
  encodeStatusFromBootResultInstructions,
  runtimeHelperDiagnostic,
} from "./runtime-helper-instructions";
import {
  UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
  UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME,
  UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
} from "./runtime-catalog";

export function materializeUefiAArch64EntryInitializeContextHelper(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
}): UefiAArch64TargetResult<AArch64ObjectModule> {
  const bootServicesPointer = lookupUefiFirmwareTableField(input.firmwareTables, {
    kind: "system-table",
    field: "boot-services",
  });
  const setWatchdogTimer = lookupUefiFirmwareTableField(input.firmwareTables, {
    kind: "boot-services",
    field: "set-watchdog-timer",
  });
  if (bootServicesPointer === undefined || setWatchdogTimer === undefined) {
    return uefiAArch64Error({
      diagnostics: [
        runtimeHelperDiagnostic(
          bootServicesPointer === undefined
            ? "entry-initialize-context:missing-boot-services-offset"
            : "entry-initialize-context:missing-set-watchdog-timer-offset",
        ),
      ],
      verification: failedVerification(HELPER_VERIFIER_KEY, "entry-initialize-context"),
    });
  }

  const encoded = encodeEntryInitializeContextInstructions({
    backendTarget: input.backendTarget,
    bootServicesPointer,
    setWatchdogTimer,
    statusPolicy: input.statusPolicy,
    watchdogPolicy: input.watchdogPolicy,
  });
  if (encoded.kind === "error") return encoded;

  const codeBytes = encoded.value.flatMap((instruction) => [...instruction.bytes]);
  const section = aarch64ObjectSection({
    stableKey: TEXT_SECTION_KEY,
    classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    alignmentBytes: 4,
    bytes: codeBytes,
    fragments: [
      aarch64ObjectFragment({
        stableKey: "fragment:entry-initialize-context",
        sectionKey: TEXT_SECTION_KEY,
        startOffsetBytes: 0,
        sizeBytes: codeBytes.length,
      }),
    ],
  });
  const module = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.backendTarget.backendSurfaceFingerprint,
    closedImagePlanFingerprint: `uefi-entry-initialize-context:${stableHash(
      stableJson({
        firmwareTables: input.firmwareTables,
        statusPolicy: input.statusPolicy,
        watchdogPolicy: input.watchdogPolicy,
      }),
    )}`,
    sections: [section],
    symbols: [
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: "symbol:__wrela_uefi_entry_initialize_context",
        linkageName: UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
        sectionKey: TEXT_SECTION_KEY,
        offsetBytes: 0,
      }),
    ],
    byteProvenance: byteProvenanceForInstructions({
      helperKey: "uefi.entry.initialize-context",
      factFamilies: ["uefi-entry-context", "uefi-watchdog-policy"],
      instructions: encoded.value,
    }),
    verification: aarch64BackendVerificationSummary({
      runs: [
        verifierRun({
          verifierKey: HELPER_VERIFIER_KEY,
          runKey: "entry-initialize-context-object",
          status: "passed",
        }),
      ],
    }),
  });

  const verification = verifyAArch64ObjectModule({ objectModule: module });
  if (verification.kind === "error") {
    return uefiAArch64Error({
      diagnostics: verification.diagnostics.map((diagnostic) =>
        runtimeHelperDiagnostic(diagnostic.stableDetail),
      ),
      verification: failedVerification(HELPER_VERIFIER_KEY, "entry-initialize-context-verify"),
    });
  }

  return uefiAArch64Ok({
    value: module,
    verification: passedVerification(HELPER_VERIFIER_KEY, "entry-initialize-context"),
  });
}

export function materializeUefiAArch64ExitBootServicesWithFreshMapHelper(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly exitBootServicesPolicy: UefiAArch64ExitBootServicesPolicy;
}): UefiAArch64TargetResult<AArch64ObjectModule> {
  const bootServicesPointer = lookupUefiFirmwareTableField(input.firmwareTables, {
    kind: "system-table",
    field: "boot-services",
  });
  const getMemoryMap = lookupUefiFirmwareTableField(input.firmwareTables, {
    kind: "boot-services",
    field: "get-memory-map",
  });
  const allocatePool = lookupUefiFirmwareTableField(input.firmwareTables, {
    kind: "boot-services",
    field: "allocate-pool",
  });
  const exitBootServices = lookupUefiFirmwareTableField(input.firmwareTables, {
    kind: "boot-services",
    field: "exit-boot-services",
  });
  if (
    bootServicesPointer === undefined ||
    getMemoryMap === undefined ||
    allocatePool === undefined ||
    exitBootServices === undefined
  ) {
    return uefiAArch64Error({
      diagnostics: [
        runtimeHelperDiagnostic(
          bootServicesPointer === undefined
            ? "exit-boot-services:missing-boot-services-offset"
            : getMemoryMap === undefined
              ? "exit-boot-services:missing-get-memory-map-offset"
              : allocatePool === undefined
                ? "exit-boot-services:missing-allocate-pool-offset"
                : "exit-boot-services:missing-exit-boot-services-offset",
        ),
      ],
      verification: failedVerification(HELPER_VERIFIER_KEY, "exit-boot-services"),
    });
  }

  const encoded = encodeExitBootServicesWithFreshMapInstructions({
    backendTarget: input.backendTarget,
    bootServicesPointer,
    getMemoryMap,
    allocatePool,
    exitBootServices,
    statusPolicy: input.statusPolicy,
    exitBootServicesPolicy: input.exitBootServicesPolicy,
  });
  if (encoded.kind === "error") return encoded;

  const codeBytes = encoded.value.flatMap((instruction) => [...instruction.bytes]);
  const section = aarch64ObjectSection({
    stableKey: TEXT_SECTION_KEY,
    classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    alignmentBytes: 4,
    bytes: codeBytes,
    fragments: [
      aarch64ObjectFragment({
        stableKey: "fragment:exit-boot-services-with-fresh-map",
        sectionKey: TEXT_SECTION_KEY,
        startOffsetBytes: 0,
        sizeBytes: codeBytes.length,
      }),
    ],
  });
  const module = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.backendTarget.backendSurfaceFingerprint,
    closedImagePlanFingerprint: `uefi-exit-boot-services-with-fresh-map:${stableHash(
      stableJson({
        firmwareTables: input.firmwareTables,
        statusPolicy: input.statusPolicy,
        exitBootServicesPolicy: input.exitBootServicesPolicy,
      }),
    )}`,
    sections: [section],
    symbols: [
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: "symbol:__wrela_uefi_exit_boot_services_with_fresh_map",
        linkageName: UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME,
        sectionKey: TEXT_SECTION_KEY,
        offsetBytes: 0,
      }),
    ],
    byteProvenance: byteProvenanceForInstructions({
      helperKey: "uefi.exit-boot-services",
      factFamilies: ["uefi-exit-boot-services", "uefi-fresh-memory-map"],
      instructions: encoded.value,
    }),
    verification: aarch64BackendVerificationSummary({
      runs: [
        verifierRun({
          verifierKey: HELPER_VERIFIER_KEY,
          runKey: "exit-boot-services-with-fresh-map-object",
          status: "passed",
        }),
      ],
    }),
  });

  const verification = verifyAArch64ObjectModule({ objectModule: module });
  if (verification.kind === "error") {
    return uefiAArch64Error({
      diagnostics: verification.diagnostics.map((diagnostic) =>
        runtimeHelperDiagnostic(diagnostic.stableDetail),
      ),
      verification: failedVerification(HELPER_VERIFIER_KEY, "exit-boot-services-verify"),
    });
  }

  return uefiAArch64Ok({
    value: module,
    verification: passedVerification(HELPER_VERIFIER_KEY, "exit-boot-services"),
  });
}

export function materializeUefiAArch64StatusFromBootResultHelper(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
}): UefiAArch64TargetResult<AArch64ObjectModule> {
  const encoded = encodeStatusFromBootResultInstructions(input);
  if (encoded.kind === "error") {
    return encoded;
  }

  const codeBytes = Object.freeze(
    encoded.value.flatMap((encodedInstruction) => [...encodedInstruction.bytes]),
  );
  const section = aarch64ObjectSection({
    stableKey: TEXT_SECTION_KEY,
    classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    alignmentBytes: 4,
    bytes: codeBytes,
    fragments: [
      aarch64ObjectFragment({
        stableKey: "fragment:status-from-boot-result",
        sectionKey: TEXT_SECTION_KEY,
        startOffsetBytes: 0,
        sizeBytes: codeBytes.length,
      }),
    ],
  });
  const module = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.backendTarget.backendSurfaceFingerprint,
    closedImagePlanFingerprint: `uefi-status-from-boot-result:${stableHash(
      stableJson({
        statusPolicy: input.statusPolicy,
      }),
    )}`,
    sections: [section],
    symbols: [
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: "symbol:__wrela_uefi_status_from_boot_result",
        linkageName: UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
        sectionKey: TEXT_SECTION_KEY,
        offsetBytes: 0,
      }),
    ],
    byteProvenance: byteProvenanceForInstructions({
      helperKey: "uefi.status.from-boot-result",
      factFamilies: ["uefi-status-conversion"],
      instructions: encoded.value,
    }),
    verification: aarch64BackendVerificationSummary({
      runs: [
        verifierRun({
          verifierKey: HELPER_VERIFIER_KEY,
          runKey: "status-from-boot-result-object",
          status: "passed",
        }),
      ],
    }),
  });

  const verification = verifyAArch64ObjectModule({ objectModule: module });
  if (verification.kind === "error") {
    return uefiAArch64Error({
      diagnostics: verification.diagnostics.map((diagnostic) =>
        runtimeHelperDiagnostic(diagnostic.stableDetail),
      ),
      verification: failedVerification(HELPER_VERIFIER_KEY, "status-from-boot-result-verify"),
    });
  }

  return uefiAArch64Ok({
    value: module,
    verification: passedVerification(HELPER_VERIFIER_KEY, "status-from-boot-result"),
  });
}

export function materializeUefiAArch64RuntimeHelperObjects(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
  readonly exitBootServicesPolicy: UefiAArch64ExitBootServicesPolicy;
}): UefiAArch64TargetResult<{ readonly modules: readonly AArch64LinkInputModule[] }> {
  const entryInitializeContext = materializeUefiAArch64EntryInitializeContextHelper(input);
  if (entryInitializeContext.kind === "error") return entryInitializeContext;

  const exitBootServices = materializeUefiAArch64ExitBootServicesWithFreshMapHelper(input);
  if (exitBootServices.kind === "error") return exitBootServices;

  const statusFromBootResult = materializeUefiAArch64StatusFromBootResultHelper(input);
  if (statusFromBootResult.kind === "error") return statusFromBootResult;

  return uefiAArch64Ok({
    value: Object.freeze({
      modules: Object.freeze([
        Object.freeze({
          moduleKey: "uefi-runtime-helper:entry-initialize-context",
          objectModule: entryInitializeContext.value,
        }),
        Object.freeze({
          moduleKey: "uefi-runtime-helper:exit-boot-services-with-fresh-map",
          objectModule: exitBootServices.value,
        }),
        Object.freeze({
          moduleKey: "uefi-runtime-helper:status-from-boot-result",
          objectModule: statusFromBootResult.value,
        }),
      ]),
    }),
    verification: passedVerification(HELPER_VERIFIER_KEY, "all-runtime-helper-objects"),
  });
}
