import {
  normalizedProofMirRuntimeOperationContent,
  proofMirRuntimeOperationId,
  runtimeCatalog,
  type ProofMirRuntimeCatalog,
  type ProofMirRuntimeOperation,
  type ProofMirRuntimeOperationId,
} from "../../runtime/runtime-catalog";
import { targetId } from "../../semantic/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  finishCatalogAuthentication,
  isAsciiSymbolName,
  type UefiAArch64TargetResult,
} from "./result";

export interface UefiAArch64RuntimeMaterialization {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly runtimeOperationFingerprint: string;
  readonly linkageName: string;
  readonly convention: "wrela-private" | "aapcs64";
  readonly materialization: "backend-object" | "source-runtime" | "inline-only";
}

interface CanonicalRuntimeMaterializationTemplate {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly operation: ProofMirRuntimeOperation;
  readonly linkageName: string;
  readonly convention: UefiAArch64RuntimeMaterialization["convention"];
  readonly materialization: UefiAArch64RuntimeMaterialization["materialization"];
}

const UEFI_AARCH64_RUNTIME_TARGET_ID = targetId("wrela-uefi-aarch64-rpi5-v1");
export const UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME =
  "__wrela_uefi_status_from_boot_result";
export const UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME =
  "__wrela_uefi_entry_initialize_context";
export const UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME =
  "__wrela_uefi_exit_boot_services_with_fresh_map";

const CANONICAL_RUNTIME_MATERIALIZATION_TEMPLATES: readonly CanonicalRuntimeMaterializationTemplate[] =
  Object.freeze([
    {
      runtimeId: proofMirRuntimeOperationId(1000),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1000),
        "uefi.status.from-boot-result",
        "uefiStatusConversion",
        [{ kind: "pure" }],
      ),
      linkageName: UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
      convention: "wrela-private",
      materialization: "backend-object",
    },
    {
      runtimeId: proofMirRuntimeOperationId(1001),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1001),
        "uefi.panic.to-status",
        "uefiStatusConversion",
        [{ kind: "pure" }],
      ),
      linkageName: "__wrela_uefi_panic_to_status",
      convention: "wrela-private",
      materialization: "inline-only",
    },
    {
      runtimeId: proofMirRuntimeOperationId(1002),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1002),
        "uefi.entry.initialize-context",
        "uefiEntryContext",
        [{ kind: "pure" }],
      ),
      linkageName: UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
      convention: "wrela-private",
      materialization: "backend-object",
    },
    {
      runtimeId: proofMirRuntimeOperationId(1003),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1003),
        "uefi.console.write-ascii-debug",
        "uefiConsoleDiagnostic",
        [{ kind: "mayPanic" }],
      ),
      linkageName: "__wrela_uefi_console_write_ascii_debug",
      convention: "aapcs64",
      materialization: "source-runtime",
    },
    {
      runtimeId: proofMirRuntimeOperationId(1004),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1004),
        "uefi.string.utf16-static",
        "uefiFirmwareString",
        [{ kind: "pure" }],
      ),
      linkageName: "__wrela_uefi_string_utf16_static",
      convention: "wrela-private",
      materialization: "source-runtime",
    },
    {
      runtimeId: proofMirRuntimeOperationId(1005),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1005),
        "runtime.validated-buffer.read-slow",
        "validatedBufferHelper",
        [{ kind: "readsMemory", place: { kind: "argument", index: 0 } }],
      ),
      linkageName: "__wrela_runtime_validated_buffer_read_slow",
      convention: "wrela-private",
      materialization: "source-runtime",
    },
    {
      runtimeId: proofMirRuntimeOperationId(1006),
      operation: canonicalRuntimeOperation(
        proofMirRuntimeOperationId(1006),
        "uefi.boot.exit-boot-services-with-fresh-map",
        "uefiBootServices",
        [
          {
            kind: "advancesPrivateState",
            place: { kind: "synthetic", name: "uefi.boot-services" },
          },
        ],
      ),
      linkageName: UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME,
      convention: "wrela-private",
      materialization: "backend-object",
    },
  ]);

export function canonicalUefiAArch64ProofMirRuntimeCatalog(): ProofMirRuntimeCatalog {
  const result = runtimeCatalog({
    targetId: UEFI_AARCH64_RUNTIME_TARGET_ID,
    features: Object.freeze([]),
    entries: CANONICAL_RUNTIME_MATERIALIZATION_TEMPLATES.map((template) => template.operation),
  });
  if (result.kind === "error") {
    throw new Error(
      `failed to build canonical UEFI AArch64 runtime catalog: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }
  return result.catalog;
}

export function fingerprintUefiAArch64RuntimeOperation(
  operation: ProofMirRuntimeOperation,
): string {
  return `uefi-runtime-operation:${stableHash(normalizedProofMirRuntimeOperationContent(operation))}`;
}

export function fingerprintUefiAArch64ProofMirRuntimeCatalog(
  runtimeCatalog: ProofMirRuntimeCatalog,
): string {
  return `uefi-runtime-catalog:${stableHash(
    stableJson({
      targetId: runtimeCatalog.targetId,
      features: runtimeCatalog.features,
      entries: runtimeCatalog.entries().map((operation) => ({
        runtimeId: operation.runtimeId,
        fingerprint: fingerprintUefiAArch64RuntimeOperation(operation),
      })),
    }),
  )}`;
}

export function canonicalUefiAArch64RuntimeMaterializations(
  runtimeCatalog?: ProofMirRuntimeCatalog,
): readonly UefiAArch64RuntimeMaterialization[] {
  const materializations = CANONICAL_RUNTIME_MATERIALIZATION_TEMPLATES.map((template) =>
    Object.freeze({
      ...template,
      runtimeOperationFingerprint: fingerprintForCanonicalTemplate(template, runtimeCatalog),
    }),
  );

  return Object.freeze(
    materializations.sort((left, right) =>
      compareCodeUnitStrings(runtimeIdSortKey(left.runtimeId), runtimeIdSortKey(right.runtimeId)),
    ),
  );
}

export function authenticateUefiAArch64RuntimeMaterializations(input: {
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
  readonly runtimeCatalogFingerprint: string;
  readonly materializations: readonly UefiAArch64RuntimeMaterialization[];
}): UefiAArch64TargetResult<readonly UefiAArch64RuntimeMaterialization[]> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  if (
    input.runtimeCatalogFingerprint !==
    fingerprintUefiAArch64ProofMirRuntimeCatalog(input.runtimeCatalog)
  ) {
    diagnostics.push(
      runtimeCatalogDiagnostic("runtime-materialization:stale-runtime-catalog-fingerprint"),
    );
  }
  const operationsById = new Map<string, ProofMirRuntimeOperation>();
  for (const operation of input.runtimeCatalog.entries()) {
    operationsById.set(runtimeIdSortKey(operation.runtimeId), operation);
  }
  const canonicalMaterializationsByRuntimeId = new Map(
    canonicalUefiAArch64RuntimeMaterializations(input.runtimeCatalog).map((materialization) => [
      runtimeIdSortKey(materialization.runtimeId),
      materialization,
    ]),
  );

  const seenRuntimeIds = new Set<string>();
  for (const materialization of input.materializations) {
    const runtimeKey = runtimeIdSortKey(materialization.runtimeId);
    if (seenRuntimeIds.has(runtimeKey)) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:duplicate-runtime-id:${String(materialization.runtimeId)}`,
        ),
      );
    }
    seenRuntimeIds.add(runtimeKey);

    const operation = operationsById.get(runtimeKey);
    if (operation === undefined) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:missing-runtime-operation:${String(materialization.runtimeId)}`,
        ),
      );
      continue;
    }

    if (
      fingerprintUefiAArch64RuntimeOperation(operation) !==
      materialization.runtimeOperationFingerprint
    ) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:stale-runtime-fingerprint:${String(materialization.runtimeId)}`,
        ),
      );
    }

    if (!isAsciiSymbolName(materialization.linkageName)) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:invalid-linkage-name:${materialization.linkageName}`,
        ),
      );
    }

    const canonicalMaterialization = canonicalMaterializationsByRuntimeId.get(runtimeKey);
    if (canonicalMaterialization !== undefined) {
      diagnostics.push(
        ...canonicalMaterializationShapeDiagnostics(materialization, canonicalMaterialization),
      );
    }
  }

  for (const canonicalMaterialization of canonicalMaterializationsByRuntimeId.values()) {
    const runtimeKey = runtimeIdSortKey(canonicalMaterialization.runtimeId);
    if (seenRuntimeIds.has(runtimeKey)) continue;
    diagnostics.push(
      runtimeCatalogDiagnostic(
        `runtime-materialization:missing-required-runtime-id:${String(
          canonicalMaterialization.runtimeId,
        )}`,
      ),
    );
  }

  return finishCatalogAuthentication({
    verifierKey: "uefi-aarch64-runtime-catalog",
    runKey: `authenticate:${stableHash(stableJson(input.runtimeCatalogFingerprint))}`,
    diagnostics,
    values: input.materializations,
    sortKey: (materialization) => runtimeIdSortKey(materialization.runtimeId),
  });
}

function canonicalMaterializationShapeDiagnostics(
  materialization: UefiAArch64RuntimeMaterialization,
  canonicalMaterialization: UefiAArch64RuntimeMaterialization,
): readonly UefiAArch64TargetDiagnostic[] {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const runtimeId = String(materialization.runtimeId);
  if (materialization.linkageName !== canonicalMaterialization.linkageName) {
    diagnostics.push(
      runtimeCatalogDiagnostic(
        `runtime-materialization:linkage-mismatch:${runtimeId}:expected:${canonicalMaterialization.linkageName}:actual:${materialization.linkageName}`,
      ),
    );
  }
  if (materialization.convention !== canonicalMaterialization.convention) {
    diagnostics.push(
      runtimeCatalogDiagnostic(
        `runtime-materialization:convention-mismatch:${runtimeId}:expected:${canonicalMaterialization.convention}:actual:${materialization.convention}`,
      ),
    );
  }
  if (materialization.materialization !== canonicalMaterialization.materialization) {
    diagnostics.push(
      runtimeCatalogDiagnostic(
        `runtime-materialization:materialization-kind-mismatch:${runtimeId}:expected:${canonicalMaterialization.materialization}:actual:${materialization.materialization}`,
      ),
    );
  }
  return diagnostics;
}

function fingerprintForCanonicalTemplate(
  template: CanonicalRuntimeMaterializationTemplate,
  runtimeCatalog: ProofMirRuntimeCatalog | undefined,
): string {
  return fingerprintUefiAArch64RuntimeOperation(
    runtimeCatalog?.get(template.runtimeId) ?? template.operation,
  );
}

function runtimeIdSortKey(runtimeId: ProofMirRuntimeOperationId): string {
  return String(runtimeId).padStart(12, "0");
}

function canonicalRuntimeOperation(
  runtimeId: ProofMirRuntimeOperationId,
  name: string,
  loweringOwner: ProofMirRuntimeOperation["loweringOwner"],
  effectSchemas: ProofMirRuntimeOperation["effectSchemas"],
): ProofMirRuntimeOperation {
  return Object.freeze({
    runtimeId,
    name,
    authorityKey: name,
    targetAvailability: {
      kind: "target" as const,
      targetId: UEFI_AARCH64_RUNTIME_TARGET_ID,
    },
    requiredFactSchemas: Object.freeze([]),
    consumedCapabilitySchemas: Object.freeze([]),
    producedCapabilitySchemas: Object.freeze([]),
    effectSchemas,
    abi: { kind: "compilerRuntime" as const, symbol: `__wr_${name}` },
    loweringOwner,
  });
}

function runtimeCatalogDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: "runtime-catalog",
    stableDetail,
  });
}
