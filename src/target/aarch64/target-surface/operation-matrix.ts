import { type OptIrOperationKind } from "../../../opt-ir/operation-kinds";
import type { AArch64TargetDiagnostic } from "./target-surface";

export type AArch64OperationSupportStatus =
  | "required"
  | "fact-gated"
  | "helper-lowered"
  | "profile-rejected"
  | "unsupported-until-layout-lowering"
  | "unreachable-after-optir";

export type AArch64OperationSupport =
  | { readonly operationKind: string; readonly status: "required" }
  | {
      readonly operationKind: string;
      readonly status: "fact-gated";
      readonly fallback: "scalar-addressing" | "scalar-helper" | "architectural-scalar";
    }
  | {
      readonly operationKind: string;
      readonly status: "helper-lowered";
      readonly catalogRequirement:
        | "source-call-lowering"
        | "runtime-helper-symbol"
        | "platform-abi-symbol"
        | "intrinsic-helper-symbol";
    }
  | {
      readonly operationKind: string;
      readonly status: "profile-rejected";
      readonly diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH";
    }
  | {
      readonly operationKind: string;
      readonly status: "unsupported-until-layout-lowering";
      readonly diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH";
    }
  | {
      readonly operationKind: string;
      readonly status: "unreachable-after-optir";
      readonly diagnosticCode: "AARCH64_PROOF_ERASURE_HANDOFF_FAILED";
    };

export type AArch64OperationMatrix = ReadonlyMap<string, AArch64OperationSupport>;

const REQUIRED_OPERATION_KINDS = [
  "constant",
  "integerUnary",
  "integerBinary",
  "integerCompare",
  "booleanNot",
  "booleanBinary",
  "layoutOffset",
  "layoutByteRange",
  "layoutEndianDecode",
] as const satisfies readonly OptIrOperationKind[];

const AGGREGATE_OPERATION_KINDS = [
  "aggregateConstruct",
  "aggregateExtract",
  "aggregateInsert",
] as const satisfies readonly OptIrOperationKind[];

const MEMORY_OPERATION_KINDS = [
  "memoryLoad",
  "memoryStore",
] as const satisfies readonly OptIrOperationKind[];

const VECTOR_OPERATION_KINDS = [
  "vectorLoad",
  "vectorStore",
  "vectorMaskedLoad",
  "vectorMaskedStore",
  "vectorShuffle",
  "vectorCompare",
  "vectorSelect",
  "vectorByteSwap",
] as const satisfies readonly OptIrOperationKind[];

const FACT_GATED_SEMANTIC_OPERATION_KINDS = [
  "semanticAtomic",
  "semanticFence",
  "semanticRegionMarker",
  "fpNumeric",
] as const satisfies readonly OptIrOperationKind[];

const HELPER_OPERATION_REQUIREMENTS = {
  sourceCall: "source-call-lowering",
  runtimeCall: "runtime-helper-symbol",
  platformCall: "platform-abi-symbol",
  intrinsicCall: "intrinsic-helper-symbol",
  semanticChecksum: "intrinsic-helper-symbol",
  semanticPolynomial: "intrinsic-helper-symbol",
  semanticCryptoMix: "intrinsic-helper-symbol",
  semanticClassifier: "intrinsic-helper-symbol",
} as const satisfies Record<
  OptIrOperationKind &
    (
      | "sourceCall"
      | "runtimeCall"
      | "platformCall"
      | "intrinsicCall"
      | "semanticChecksum"
      | "semanticPolynomial"
      | "semanticCryptoMix"
      | "semanticClassifier"
    ),
  | "source-call-lowering"
  | "runtime-helper-symbol"
  | "platform-abi-symbol"
  | "intrinsic-helper-symbol"
>;

export const WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX: AArch64OperationMatrix =
  buildOperationMatrix();

export function aarch64OperationSupportForKind(operationKind: string): AArch64OperationSupport {
  const support = WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX.get(operationKind);
  if (support !== undefined) {
    return support;
  }
  return {
    operationKind,
    status: "profile-rejected",
    diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH",
  };
}

export function verifyAArch64OperationMatrixCoverage(input: {
  readonly operationKinds: readonly string[];
  readonly matrix: AArch64OperationMatrix;
}):
  | { readonly kind: "ok"; readonly missing: readonly [] }
  | {
      readonly kind: "error";
      readonly missing: readonly string[];
      readonly diagnostics: readonly AArch64TargetDiagnostic[];
    } {
  const missing = input.operationKinds
    .filter((operationKind) => !input.matrix.has(operationKind))
    .sort();
  if (missing.length === 0) {
    return { kind: "ok", missing: [] };
  }
  return {
    kind: "error",
    missing,
    diagnostics: missing.map((operationKind) => ({
      code: "AARCH64_OPERATION_MATRIX_MISSING_KIND",
      stableDetail: `operation-matrix:wrela-uefi-aarch64-rpi5-v1:missing-kind:${operationKind}`,
    })),
  };
}

function buildOperationMatrix(): AArch64OperationMatrix {
  const entries: [string, AArch64OperationSupport][] = [];
  for (const operationKind of REQUIRED_OPERATION_KINDS) {
    entries.push([operationKind, { operationKind, status: "required" }]);
  }
  for (const operationKind of AGGREGATE_OPERATION_KINDS) {
    entries.push([
      operationKind,
      {
        operationKind,
        status: "unsupported-until-layout-lowering",
        diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH",
      },
    ]);
  }
  for (const operationKind of MEMORY_OPERATION_KINDS) {
    entries.push([
      operationKind,
      { operationKind, status: "fact-gated", fallback: "scalar-addressing" },
    ]);
  }
  for (const operationKind of VECTOR_OPERATION_KINDS) {
    entries.push([
      operationKind,
      { operationKind, status: "fact-gated", fallback: "scalar-helper" },
    ]);
  }
  for (const operationKind of FACT_GATED_SEMANTIC_OPERATION_KINDS) {
    entries.push([
      operationKind,
      { operationKind, status: "fact-gated", fallback: "architectural-scalar" },
    ]);
  }
  for (const [operationKind, catalogRequirement] of Object.entries(HELPER_OPERATION_REQUIREMENTS)) {
    entries.push([operationKind, { operationKind, status: "helper-lowered", catalogRequirement }]);
  }
  entries.push([
    "proofErasedMarker",
    {
      operationKind: "proofErasedMarker",
      status: "unreachable-after-optir",
      diagnosticCode: "AARCH64_PROOF_ERASURE_HANDOFF_FAILED",
    },
  ]);

  return Object.freeze(new Map(entries.sort(([left], [right]) => left.localeCompare(right))));
}
