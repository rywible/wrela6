import { describe, expect, test } from "bun:test";
import {
  failedVerification,
  passedVerification,
  sortUefiAArch64TargetDiagnostics,
  uefiAArch64Error,
  uefiAArch64Ok,
  uefiAArch64TargetDiagnostic,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI AArch64 diagnostics", () => {
  test("sorts diagnostics deterministically by code, owner key, and stable detail", () => {
    const diagnostics = [
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "pipeline",
        stableDetail: "stage:linker",
      }),
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PRIMITIVE_COVERAGE_MISMATCH",
        ownerKey: "runtime-helper-objects",
        stableDetail: "missing:[a];extra:[]",
      }),
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey: "z-target",
        stableDetail: "targetKey:wrong",
      }),
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey: "a-target",
        stableDetail: "targetKey:wrong",
      }),
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey: "a-target",
        stableDetail: "targetKey:right-code-wrong-surface",
      }),
    ];

    expect(
      sortUefiAArch64TargetDiagnostics(diagnostics).map((diagnostic) => [
        diagnostic.code,
        diagnostic.ownerKey,
        diagnostic.stableDetail,
      ]),
    ).toEqual([
      ["UEFI_AARCH64_TARGET_AUTH_FAILED", "a-target", "targetKey:right-code-wrong-surface"],
      ["UEFI_AARCH64_TARGET_AUTH_FAILED", "a-target", "targetKey:wrong"],
      ["UEFI_AARCH64_TARGET_AUTH_FAILED", "z-target", "targetKey:wrong"],
      ["UEFI_AARCH64_PIPELINE_FAILED", "pipeline", "stage:linker"],
      [
        "UEFI_AARCH64_PRIMITIVE_COVERAGE_MISMATCH",
        "runtime-helper-objects",
        "missing:[a];extra:[]",
      ],
    ]);
  });

  test("preserves verification summaries on success and error results", () => {
    const successVerification = passedVerification("catalog", "runtime");
    const errorVerification = failedVerification("catalog", "semantic", "fingerprint mismatch");
    const diagnostic = uefiAArch64TargetDiagnostic({
      code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
      ownerKey: "semantic",
      stableDetail: "fingerprint mismatch",
    });

    const success = uefiAArch64Ok({
      value: "authenticated",
      verification: successVerification,
    });
    const error = uefiAArch64Error({
      diagnostics: [diagnostic],
      verification: errorVerification,
    });

    expect(success.verification).toBe(successVerification);
    expect(error.verification).toBe(errorVerification);
  });
});
