import type { ProofMirRuntimeOperationId } from "../../runtime/runtime-catalog-types";
import { proofMirRuntimeOperationId } from "../../runtime/runtime-catalog-types";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
import {
  imageProfileId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  targetTypeId,
  type PlatformPrimitiveId,
} from "../../semantic/ids";
import type {
  PlatformPrimitiveSpec,
  SemanticTargetSurface,
  TargetFunctionSignature,
  TargetParameterSpec,
  TargetProofContractSurface,
  TargetTypeKindSpec,
} from "../../semantic/surface/platform-surface";
import { concreteKind } from "../../semantic/surface/resource-kind";
import { targetCheckedType } from "../../semantic/surface/type-model";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import type { UefiAArch64FirmwareTableSurface, UefiFirmwareTablePath } from "./firmware-tables";
import type { UefiAArch64StaticChar16StringPointer } from "./firmware-strings";
import { lookupUefiFirmwareTableField } from "./firmware-tables";
import {
  failedVerification,
  isAsciiSymbolName,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import { UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME } from "./runtime-catalog";

export interface UefiAArch64PlatformPrimitiveLowering {
  readonly primitiveId: PlatformPrimitiveId;
  readonly semanticPrimitiveFingerprint: string;
  readonly lowering: UefiFirmwareLoweringRule;
}

export type UefiFirmwareArgumentRule =
  | {
      readonly kind: "source-argument";
      readonly index: number;
      readonly pointerRequirement?: UefiFirmwareStaticChar16PointerRequirement;
    }
  | { readonly kind: "image-handle" }
  | { readonly kind: "system-table" }
  | { readonly kind: "table-pointer"; readonly tableKey: string }
  | { readonly kind: "constant-u64"; readonly value: bigint }
  | {
      readonly kind: "static-char16-pointer";
      readonly pointer: UefiAArch64StaticChar16StringPointer;
    };

export interface UefiFirmwareStaticChar16PointerRequirement {
  readonly kind: "static-char16-pointer";
  readonly lifetime: "image-readonly";
  readonly nulTerminated: true;
}

export type UefiFirmwareResultRule =
  | { readonly kind: "efi-status" }
  | { readonly kind: "pointer-result"; readonly capabilityKey: string }
  | { readonly kind: "terminal-status" }
  | { readonly kind: "unit" };

export type UefiFirmwareLoweringRule =
  | {
      readonly kind: "firmware-call";
      readonly tablePath: UefiFirmwareTablePath;
      readonly arguments: readonly UefiFirmwareArgumentRule[];
      readonly result: UefiFirmwareResultRule;
    }
  | {
      readonly kind: "compiler-runtime-helper";
      readonly runtimeId: ProofMirRuntimeOperationId;
      readonly helperLinkageName: string;
      readonly arguments: readonly UefiFirmwareArgumentRule[];
      readonly result: UefiFirmwareResultRule;
    }
  | {
      readonly kind: "inline";
      readonly operationKey: string;
    };

export function canonicalUefiAArch64PlatformLowerings(
  semanticTarget: SemanticTargetSurface = canonicalUefiAArch64SemanticTargetSurface(),
): readonly UefiAArch64PlatformPrimitiveLowering[] {
  const primitiveById = new Map(
    semanticTarget.platformPrimitives
      .entries()
      .map((primitive) => [String(primitive.primitiveId), primitive] as const),
  );

  return Object.freeze(
    CANONICAL_UEFI_PLATFORM_LOWERING_RULES.map((entry) => {
      const primitive = primitiveById.get(entry.primitiveId);
      return Object.freeze({
        primitiveId: platformPrimitiveId(entry.primitiveId),
        semanticPrimitiveFingerprint:
          primitive === undefined ? "" : fingerprintUefiPlatformPrimitiveSpec(primitive),
        lowering: freezeLoweringRule(entry.lowering),
      });
    }).sort((left, right) =>
      compareCodeUnitStrings(String(left.primitiveId), String(right.primitiveId)),
    ),
  );
}

export function fingerprintUefiPlatformPrimitiveSpec(primitive: PlatformPrimitiveSpec): string {
  return `uefi-platform-primitive:${stableHash(
    stableJson({
      primitiveId: primitive.primitiveId,
      contractId: primitive.contractId,
      primitiveFamilyId: primitive.primitiveFamilyId,
      availability: primitive.availability,
      signature: primitive.signature,
      proofContract: primitive.proofContract,
    }),
  )}`;
}

export function fingerprintUefiSemanticPlatformCatalog(surface: SemanticTargetSurface): string {
  return `uefi-semantic-platform-catalog:${stableHash(
    stableJson({
      targetId: surface.targetId,
      primitives: surface.platformPrimitives
        .entries()
        .map((primitive) => ({
          primitiveId: primitive.primitiveId,
          fingerprint: fingerprintUefiPlatformPrimitiveSpec(primitive),
        }))
        .sort((left, right) =>
          compareCodeUnitStrings(String(left.primitiveId), String(right.primitiveId)),
        ),
    }),
  )}`;
}

export function authenticateUefiAArch64PlatformLowerings(input: {
  readonly semanticTarget: SemanticTargetSurface;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly lowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
}): UefiAArch64TargetResult<readonly UefiAArch64PlatformPrimitiveLowering[]> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const expectedCatalogFingerprint = fingerprintUefiSemanticPlatformCatalog(input.semanticTarget);
  if (input.semanticPlatformCatalogFingerprint !== expectedCatalogFingerprint) {
    diagnostics.push(
      platformCatalogDiagnostic("platform-catalog:stale-semantic-platform-fingerprint"),
    );
  }

  const semanticPrimitives = new Map(
    input.semanticTarget.platformPrimitives
      .entries()
      .map((primitive) => [String(primitive.primitiveId), primitive] as const),
  );
  const seenPrimitiveIds = new Set<string>();

  for (const lowering of input.lowerings) {
    const primitiveId = String(lowering.primitiveId);
    if (seenPrimitiveIds.has(primitiveId)) {
      diagnostics.push(
        platformCatalogDiagnostic(`platform-lowering:duplicate-primitive:${primitiveId}`),
      );
    }
    seenPrimitiveIds.add(primitiveId);

    const primitive = semanticPrimitives.get(primitiveId);
    if (primitive === undefined) {
      diagnostics.push(
        platformCatalogDiagnostic(`platform-lowering:missing-semantic-primitive:${primitiveId}`),
      );
    } else if (
      fingerprintUefiPlatformPrimitiveSpec(primitive) !== lowering.semanticPrimitiveFingerprint
    ) {
      diagnostics.push(
        platformCatalogDiagnostic(`platform-lowering:stale-semantic-fingerprint:${primitiveId}`),
      );
    }

    if (
      lowering.lowering.kind === "firmware-call" &&
      lookupUefiFirmwareTableField(input.firmwareTables, lowering.lowering.tablePath) === undefined
    ) {
      diagnostics.push(
        platformCatalogDiagnostic(`platform-lowering:unknown-table-path:${primitiveId}`),
      );
    }
    if (
      lowering.lowering.kind === "compiler-runtime-helper" &&
      !isAsciiSymbolName(lowering.lowering.helperLinkageName)
    ) {
      diagnostics.push(
        platformCatalogDiagnostic(`platform-lowering:invalid-helper-linkage:${primitiveId}`),
      );
    }
    diagnostics.push(...argumentDiagnostics(primitiveId, lowering.lowering));
  }

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification("uefi-aarch64-platform-catalog", "authenticate"),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze(
      input.lowerings
        .map((lowering) => freezePlatformLowering(lowering))
        .sort((left, right) =>
          compareCodeUnitStrings(String(left.primitiveId), String(right.primitiveId)),
        ),
    ),
    verification: passedVerification("uefi-aarch64-platform-catalog", "authenticate"),
  });
}

function platformCatalogDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: "platform-catalog",
    stableDetail,
  });
}

function freezePlatformLowering(
  lowering: UefiAArch64PlatformPrimitiveLowering,
): UefiAArch64PlatformPrimitiveLowering {
  return Object.freeze({
    primitiveId: lowering.primitiveId,
    semanticPrimitiveFingerprint: lowering.semanticPrimitiveFingerprint,
    lowering: freezeLoweringRule(lowering.lowering),
  });
}

function freezeLoweringRule(lowering: UefiFirmwareLoweringRule): UefiFirmwareLoweringRule {
  switch (lowering.kind) {
    case "firmware-call":
      return Object.freeze({
        kind: lowering.kind,
        tablePath: Object.freeze({ ...lowering.tablePath }) as UefiFirmwareTablePath,
        arguments: Object.freeze(
          lowering.arguments.map((argument) => freezeArgumentRule(argument)),
        ),
        result: Object.freeze({ ...lowering.result }),
      });
    case "compiler-runtime-helper":
      return Object.freeze({
        kind: lowering.kind,
        runtimeId: lowering.runtimeId,
        helperLinkageName: lowering.helperLinkageName,
        arguments: Object.freeze(
          lowering.arguments.map((argument) => freezeArgumentRule(argument)),
        ),
        result: Object.freeze({ ...lowering.result }),
      });
    case "inline":
      return Object.freeze({ ...lowering });
  }
}

export function canonicalUefiAArch64SemanticTargetSurface(): SemanticTargetSurface {
  const primitives = CANONICAL_UEFI_PLATFORM_LOWERING_RULES.map((entry) =>
    canonicalPrimitiveSpec(entry.primitiveId),
  );
  return {
    targetId: targetId("wrela-uefi-aarch64-rpi5-v1"),
    platformPrimitives: {
      get: (primitiveId) => primitives.find((primitive) => primitive.primitiveId === primitiveId),
      entries: () =>
        [...primitives].sort((left, right) =>
          compareCodeUnitStrings(String(left.primitiveId), String(right.primitiveId)),
        ),
    },
    imageProfiles: [],
    deviceSurfaces: [],
    targetTypeKinds: canonicalUefiTargetTypeKinds(),
  };
}

function canonicalPrimitiveSpec(name: CanonicalUefiPrimitiveName): PlatformPrimitiveSpec {
  return Object.freeze({
    primitiveId: platformPrimitiveId(name),
    contractId: platformContractId(`${name}_contract`),
    availability: Object.freeze({
      targetId: targetId("wrela-uefi-aarch64-rpi5-v1"),
      profiles: Object.freeze([imageProfileId("uefi")]),
      features: Object.freeze([]),
    }),
    signature: signatureForPrimitive(name),
    proofContract: emptyProofContract(),
  });
}

function emptyProofContract(): TargetProofContractSurface {
  return Object.freeze({
    requiredFacts: Object.freeze([]),
    ensuredFacts: Object.freeze([]),
  });
}

type CanonicalUefiPrimitiveName =
  | "uefi.console.outputString"
  | "uefi.boot.allocatePool"
  | "uefi.boot.freePool"
  | "uefi.boot.getMemoryMap"
  | "uefi.boot.exitBootServices"
  | "uefi.boot.setWatchdogTimer"
  | "uefi.boot.stall"
  | "uefi.boot.exit"
  | "uefi.protocol.locate";

function signatureForPrimitive(name: CanonicalUefiPrimitiveName): TargetFunctionSignature {
  switch (name) {
    case "uefi.console.outputString":
      return targetSignature([uefiParameter("uefi.Utf16Static")], "uefi.Status");
    case "uefi.boot.allocatePool":
      return targetSignature(
        [uefiParameter("uefi.U64"), uefiParameter("uefi.U64"), uefiParameter("uefi.Ptr")],
        "uefi.Status",
      );
    case "uefi.boot.freePool":
      return targetSignature([uefiParameter("uefi.Ptr")], "uefi.Status");
    case "uefi.boot.getMemoryMap":
      return targetSignature(
        [
          uefiParameter("uefi.Ptr"),
          uefiParameter("uefi.Ptr"),
          uefiParameter("uefi.Ptr"),
          uefiParameter("uefi.Ptr"),
          uefiParameter("uefi.Ptr"),
        ],
        "uefi.Status",
      );
    case "uefi.boot.exitBootServices":
      return targetSignature([], "uefi.Status");
    case "uefi.boot.setWatchdogTimer":
      return targetSignature(
        [
          uefiParameter("uefi.U64"),
          uefiParameter("uefi.U64"),
          uefiParameter("uefi.U64"),
          uefiParameter("uefi.Ptr"),
        ],
        "uefi.Status",
      );
    case "uefi.boot.stall":
      return targetSignature([uefiParameter("uefi.U64")], "uefi.Status");
    case "uefi.boot.exit":
      return targetSignature(
        [uefiParameter("uefi.Status"), uefiParameter("uefi.U64"), uefiParameter("uefi.Ptr")],
        "uefi.Status",
      );
    case "uefi.protocol.locate":
      return targetSignature(
        [uefiParameter("uefi.Ptr"), uefiParameter("uefi.Ptr"), uefiParameter("uefi.Ptr")],
        "uefi.Status",
      );
  }
}

function targetSignature(
  parameters: readonly TargetParameterSpec[],
  returnTypeKey: UefiSemanticTargetTypeKey,
): TargetFunctionSignature {
  return Object.freeze({
    genericArity: 0,
    receiver: undefined,
    parameters: Object.freeze([...parameters]),
    returnType: targetCheckedType(targetTypeId(returnTypeKey)),
    returnKind: concreteKind("Copy"),
    requiredModifiers: Object.freeze(["platform"]),
    forbiddenModifiers: Object.freeze([]),
  });
}

type UefiSemanticTargetTypeKey = "uefi.Status" | "uefi.Utf16Static" | "uefi.U64" | "uefi.Ptr";

function uefiParameter(typeKey: UefiSemanticTargetTypeKey): TargetParameterSpec {
  return Object.freeze({
    type: targetCheckedType(targetTypeId(typeKey)),
    mode: "observe" as const,
    resourceKind: concreteKind("Copy"),
  });
}

function canonicalUefiTargetTypeKinds(): readonly TargetTypeKindSpec[] {
  return Object.freeze(
    (["uefi.Ptr", "uefi.Status", "uefi.U64", "uefi.Utf16Static"] as const).map((typeKey) =>
      Object.freeze({
        targetTypeId: targetTypeId(typeKey),
        kind: "Copy" as const,
      }),
    ),
  );
}

const CANONICAL_UEFI_PLATFORM_LOWERING_RULES: readonly {
  readonly primitiveId: CanonicalUefiPrimitiveName;
  readonly lowering: UefiFirmwareLoweringRule;
}[] = Object.freeze([
  firmwareCall(
    "uefi.console.outputString",
    { kind: "simple-text-output", field: "output-string" },
    [
      {
        kind: "source-argument",
        index: 0,
        pointerRequirement: staticChar16PointerRequirement(),
      },
    ],
  ),
  firmwareCall("uefi.boot.allocatePool", { kind: "boot-services", field: "allocate-pool" }, [
    { kind: "source-argument", index: 0 },
    { kind: "source-argument", index: 1 },
    { kind: "source-argument", index: 2 },
  ]),
  firmwareCall("uefi.boot.freePool", { kind: "boot-services", field: "free-pool" }, [
    { kind: "source-argument", index: 0 },
  ]),
  firmwareCall("uefi.boot.getMemoryMap", { kind: "boot-services", field: "get-memory-map" }, [
    { kind: "source-argument", index: 0 },
    { kind: "source-argument", index: 1 },
    { kind: "source-argument", index: 2 },
    { kind: "source-argument", index: 3 },
    { kind: "source-argument", index: 4 },
  ]),
  compilerRuntimeHelper(
    "uefi.boot.exitBootServices",
    proofMirRuntimeOperationId(1006),
    UEFI_AARCH64_EXIT_BOOT_SERVICES_WITH_FRESH_MAP_LINKAGE_NAME,
    [{ kind: "image-handle" }, { kind: "system-table" }],
    { kind: "efi-status" },
  ),
  firmwareCall(
    "uefi.boot.setWatchdogTimer",
    { kind: "boot-services", field: "set-watchdog-timer" },
    [
      { kind: "source-argument", index: 0 },
      { kind: "source-argument", index: 1 },
      { kind: "source-argument", index: 2 },
      { kind: "source-argument", index: 3 },
    ],
  ),
  firmwareCall("uefi.boot.stall", { kind: "boot-services", field: "stall" }, [
    { kind: "source-argument", index: 0 },
  ]),
  firmwareCall("uefi.boot.exit", { kind: "boot-services", field: "exit" }, [
    { kind: "image-handle" },
    { kind: "source-argument", index: 0 },
    { kind: "source-argument", index: 1 },
    { kind: "source-argument", index: 2 },
  ]),
  firmwareCall("uefi.protocol.locate", { kind: "boot-services", field: "locate-protocol" }, [
    { kind: "source-argument", index: 0 },
    { kind: "source-argument", index: 1 },
    { kind: "source-argument", index: 2 },
  ]),
]);

function firmwareCall(
  primitiveId: CanonicalUefiPrimitiveName,
  tablePath: UefiFirmwareTablePath,
  argumentRules: readonly UefiFirmwareArgumentRule[],
): {
  readonly primitiveId: CanonicalUefiPrimitiveName;
  readonly lowering: UefiFirmwareLoweringRule;
} {
  return Object.freeze({
    primitiveId,
    lowering: Object.freeze({
      kind: "firmware-call" as const,
      tablePath: Object.freeze(tablePath),
      arguments: Object.freeze(argumentRules.map((argument) => Object.freeze(argument))),
      result: Object.freeze({ kind: "efi-status" as const }),
    }),
  });
}

function staticChar16PointerRequirement(): UefiFirmwareStaticChar16PointerRequirement {
  return Object.freeze({
    kind: "static-char16-pointer" as const,
    lifetime: "image-readonly" as const,
    nulTerminated: true as const,
  });
}

function freezeArgumentRule(argument: UefiFirmwareArgumentRule): UefiFirmwareArgumentRule {
  switch (argument.kind) {
    case "source-argument":
      return Object.freeze({
        kind: argument.kind,
        index: argument.index,
        ...(argument.pointerRequirement === undefined
          ? {}
          : { pointerRequirement: Object.freeze({ ...argument.pointerRequirement }) }),
      });
    case "static-char16-pointer":
      return Object.freeze({
        kind: argument.kind,
        pointer: Object.freeze({ ...argument.pointer }),
      });
    case "image-handle":
    case "system-table":
      return Object.freeze({ kind: argument.kind });
    case "table-pointer":
      return Object.freeze({ kind: argument.kind, tableKey: argument.tableKey });
    case "constant-u64":
      return Object.freeze({ ...argument });
  }
}

function argumentDiagnostics(
  primitiveId: string,
  lowering: UefiFirmwareLoweringRule,
): readonly UefiAArch64TargetDiagnostic[] {
  if (lowering.kind === "inline") return [];
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  for (const argument of lowering.arguments) {
    if (
      argument.kind === "source-argument" &&
      argument.pointerRequirement !== undefined &&
      !isStaticChar16PointerRequirement(argument.pointerRequirement)
    ) {
      diagnostics.push(
        platformCatalogDiagnostic(`platform-lowering:invalid-pointer-requirement:${primitiveId}`),
      );
    }
    if (argument.kind === "static-char16-pointer") {
      if (!isAsciiSymbolName(argument.pointer.symbolName)) {
        diagnostics.push(
          platformCatalogDiagnostic(
            `platform-lowering:invalid-static-char16-symbol:${primitiveId}`,
          ),
        );
      }
      if (
        argument.pointer.fingerprint.length === 0 ||
        argument.pointer.stableKey.length === 0 ||
        !isStaticChar16PointerRequirement(argument.pointer)
      ) {
        diagnostics.push(
          platformCatalogDiagnostic(
            `platform-lowering:invalid-static-char16-pointer:${primitiveId}`,
          ),
        );
      }
    }
  }
  return diagnostics;
}

function isStaticChar16PointerRequirement(
  value: UefiFirmwareStaticChar16PointerRequirement,
): boolean {
  return (
    value.kind === "static-char16-pointer" &&
    value.lifetime === "image-readonly" &&
    value.nulTerminated === true
  );
}

function compilerRuntimeHelper(
  primitiveId: CanonicalUefiPrimitiveName,
  runtimeId: ProofMirRuntimeOperationId,
  helperLinkageName: string,
  argumentRules: readonly UefiFirmwareArgumentRule[],
  result: UefiFirmwareResultRule,
): {
  readonly primitiveId: CanonicalUefiPrimitiveName;
  readonly lowering: UefiFirmwareLoweringRule;
} {
  return Object.freeze({
    primitiveId,
    lowering: Object.freeze({
      kind: "compiler-runtime-helper" as const,
      runtimeId,
      helperLinkageName,
      arguments: Object.freeze(argumentRules.map((argument) => Object.freeze(argument))),
      result: Object.freeze(result),
    }),
  });
}
