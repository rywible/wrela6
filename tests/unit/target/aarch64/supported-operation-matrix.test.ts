import { describe, expect, test } from "bun:test";
import { OPT_IR_OPERATION_KINDS } from "../../../../src/opt-ir/operation-kinds";
import {
  WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX,
  aarch64OperationSupportForKind,
  verifyAArch64OperationMatrixCoverage,
} from "../../../../src/target/aarch64/target-surface/operation-matrix";

describe("aarch64 supported operation matrix", () => {
  test("covers every current OptIR operation kind", () => {
    const coverage = verifyAArch64OperationMatrixCoverage({
      operationKinds: OPT_IR_OPERATION_KINDS,
      matrix: WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX,
    });

    expect(coverage).toEqual({ kind: "ok", missing: [] });
  });

  test("classifies required, fact-gated, helper-lowered, and proof-erased operations", () => {
    expect(aarch64OperationSupportForKind("constant").status).toBe("required");
    expect(aarch64OperationSupportForKind("aggregateConstruct")).toEqual({
      operationKind: "aggregateConstruct",
      status: "unsupported-until-layout-lowering",
      diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH",
    });
    expect(aarch64OperationSupportForKind("aggregateExtract")).toEqual({
      operationKind: "aggregateExtract",
      status: "unsupported-until-layout-lowering",
      diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH",
    });
    expect(aarch64OperationSupportForKind("aggregateInsert")).toEqual({
      operationKind: "aggregateInsert",
      status: "unsupported-until-layout-lowering",
      diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH",
    });
    expect(aarch64OperationSupportForKind("memoryLoad")).toMatchObject({
      status: "fact-gated",
      fallback: "scalar-addressing",
    });
    expect(aarch64OperationSupportForKind("vectorShuffle")).toMatchObject({
      status: "fact-gated",
      fallback: "scalar-helper",
    });
    expect(aarch64OperationSupportForKind("runtimeCall")).toMatchObject({
      status: "helper-lowered",
      catalogRequirement: "runtime-helper-symbol",
    });
    expect(aarch64OperationSupportForKind("proofErasedMarker")).toEqual({
      operationKind: "proofErasedMarker",
      status: "unreachable-after-optir",
      diagnosticCode: "AARCH64_PROOF_ERASURE_HANDOFF_FAILED",
    });
  });

  test("reports a missing future OptIR operation kind deterministically", () => {
    const coverage = verifyAArch64OperationMatrixCoverage({
      operationKinds: [...OPT_IR_OPERATION_KINDS, "futureSemanticOperation"],
      matrix: WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX,
    });

    expect(coverage).toEqual({
      kind: "error",
      missing: ["futureSemanticOperation"],
      diagnostics: [
        {
          code: "AARCH64_OPERATION_MATRIX_MISSING_KIND",
          stableDetail:
            "operation-matrix:wrela-uefi-aarch64-rpi5-v1:missing-kind:futureSemanticOperation",
        },
      ],
    });
    expect(aarch64OperationSupportForKind("futureSemanticOperation")).toEqual({
      operationKind: "futureSemanticOperation",
      status: "profile-rejected",
      diagnosticCode: "AARCH64_OPERATION_TARGET_MISMATCH",
    });
  });
});
