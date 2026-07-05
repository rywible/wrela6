import { describe, expect, test } from "bun:test";

import {
  authenticateUefiAArch64TargetDriverSurface,
  compilerPackageInput,
  productionPackagePipelineDependencies,
  runUefiAArch64PackagePipelineToOptIr,
  uefiAArch64TargetDiagnostic,
} from "../../../../src/target/uefi-aarch64";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI AArch64 status ABI bridge", () => {
  test("does not treat any enum named UefiStatus as target status ABI", () => {
    const result = runStatusBridgeFixture({
      packageKey: "bogus-source-status",
      sourceFiles: [
        {
          sourceKey: "src/image.wr",
          moduleName: "image",
          text: [
            "enum UefiStatus:",
            "    bogus",
            "platform fn output_string(message: Utf16Static) -> UefiStatus",
            "uefi image BogusSourceStatus:",
            "    fn boot() -> UefiStatus:",
            "        return UefiStatus.bogus",
            "",
          ].join("\n"),
        },
      ],
    });

    expectSemanticFailure(result);
  });

  test("rejects local UefiStatus even when its shape matches the ABI bridge", () => {
    const result = runStatusBridgeFixture({
      packageKey: "local-source-status",
      sourceFiles: [
        {
          sourceKey: "src/image.wr",
          moduleName: "image",
          text: [
            canonicalUefiStatusSourceForTest("enum"),
            "platform fn output_string(message: Utf16Static) -> UefiStatus",
            "uefi image LocalSourceStatus:",
            "    fn boot() -> UefiStatus:",
            '        output_string(utf16_static("WRELA_UEFI_SMOKE_OK\\r\\n"))',
            "",
          ].join("\n"),
        },
      ],
    });

    expectSemanticFailure(result);
  });

  test("accepts the canonical stdlib UefiStatus ABI bridge", () => {
    const result = runStatusBridgeFixture({
      packageKey: "canonical-source-status",
      sourceFiles: canonicalBridgeSourceFiles({
        moduleName: "wrela_std.target.uefi.status",
        sourceKey: "src/wrela_std/target/uefi/status.wr",
      }),
    });

    expectSemanticPassThenStop(result);
  });

  test("accepts the explicit direct-platform UefiStatus ABI bridge", () => {
    const result = runStatusBridgeFixture({
      packageKey: "direct-abi-source-status",
      sourceFiles: canonicalBridgeSourceFiles({
        moduleName: "wrela_abi.target.uefi.status",
        sourceKey: "src/wrela_abi/target/uefi/status.wr",
      }),
    });

    expectSemanticPassThenStop(result);
  });
});

function runStatusBridgeFixture(input: {
  readonly packageKey: string;
  readonly sourceFiles: readonly {
    readonly sourceKey: string;
    readonly moduleName: string;
    readonly text: string;
  }[];
}) {
  const packageInputResult = compilerPackageInput({
    packageKey: input.packageKey,
    entryModuleName: "image",
    sourceRoots: [
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
    ],
    sourceFiles: input.sourceFiles,
  });
  expect(packageInputResult.kind).toBe("ok");
  if (packageInputResult.kind !== "ok") throw new Error("expected package input");

  return runUefiAArch64PackagePipelineToOptIr(
    {
      packageInput: packageInputResult.value,
      target: targetSurfaceForTest(),
    },
    {
      ...productionPackagePipelineDependencies(),
      monomorphizeWholeImage: () => ({
        kind: "error" as const,
        diagnostics: [
          uefiAArch64TargetDiagnostic({
            code: "UEFI_AARCH64_PIPELINE_FAILED",
            ownerKey: "test-stop",
            stableDetail: "stop-after-semantic",
          }),
        ],
      }),
    },
  );
}

function canonicalBridgeSourceFiles(input: {
  readonly moduleName: string;
  readonly sourceKey: string;
}) {
  return [
    {
      sourceKey: "src/image.wr",
      moduleName: "image",
      text: [
        `use UefiStatus from ${input.moduleName}`,
        "platform fn output_string(message: Utf16Static) -> UefiStatus",
        "uefi image CanonicalSourceStatus:",
        "    fn boot() -> UefiStatus:",
        '        output_string(utf16_static("WRELA_UEFI_SMOKE_OK\\r\\n"))',
        "",
      ].join("\n"),
    },
    {
      sourceKey: input.sourceKey,
      moduleName: input.moduleName,
      text: canonicalUefiStatusSourceForTest("enum"),
    },
  ];
}

function expectSemanticFailure(
  result: ReturnType<typeof runUefiAArch64PackagePipelineToOptIr>,
): void {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.verification.runs.map((run) => run.runKey)).toEqual(["frontend", "semantic"]);
  expect(result.verification.runs.at(-1)?.status).toBe("failed");
  expect(result.diagnostics.map((diagnostic) => diagnostic.ownerKey)).not.toContain("test-stop");
}

function expectSemanticPassThenStop(
  result: ReturnType<typeof runUefiAArch64PackagePipelineToOptIr>,
): void {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.verification.runs.map((run) => run.runKey)).toEqual([
    "frontend",
    "semantic",
    "monomorphization",
  ]);
  expect(result.verification.runs[1]?.status).toBe("passed");
  expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
}

function targetSurfaceForTest() {
  const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  expect(targetResult.kind).toBe("ok");
  if (targetResult.kind !== "ok") throw new Error("expected authenticated UEFI target");
  return targetResult.value;
}

function canonicalUefiStatusSourceForTest(enumHeader: "enum"): string {
  return [
    `${enumHeader} UefiStatus:`,
    "    success",
    "    load_error",
    "    invalid_parameter",
    "    unsupported",
    "    bad_buffer_size",
    "    buffer_too_small",
    "    device_error",
    "    not_found",
    "    aborted",
    "    security_violation",
  ].join("\n");
}
