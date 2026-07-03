import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64TargetDriverSurface,
  compilerPackageInput,
  productionPackagePipelineDependencies,
  runUefiAArch64PackagePipelineToOptIr,
  uefiAArch64TargetDiagnostic,
  type PackageRepresentationLayoutFactsAdapter,
  type UefiAArch64TargetDriverSurface,
} from "../../../../src/target/uefi-aarch64";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI package pipeline source-visible entry capabilities", () => {
  test("production semantic adapter accepts source-visible UefiFirmware entry capability", () => {
    const packageInputResult = sourceFirmwareEntryPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();

    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
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

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
    ]);
    expect(result.verification.runs[1]?.status).toBe("passed");
    expect(result.diagnostics[0]?.ownerKey).toBe("test-stop");
  });

  test("production layout-facts adapter classifies source Result boot entries as status codes", () => {
    const packageInputResult = sourceFirmwareEntryPackageInputForTest();
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;
    const target = targetSurfaceWithUefiImageProfileForTest();
    let layoutFacts: PackageRepresentationLayoutFactsAdapter | undefined;

    const productionDependencies = productionPackagePipelineDependencies();
    const result = runUefiAArch64PackagePipelineToOptIr(
      {
        packageInput: packageInputResult.value,
        target,
      },
      {
        ...productionDependencies,
        computeRepresentationLayoutFacts(input) {
          const computed = productionDependencies.computeRepresentationLayoutFacts(input);
          if (computed.kind === "ok") layoutFacts = computed.value;
          return computed;
        },
        buildProofMir: () => ({
          kind: "error" as const,
          diagnostics: [
            uefiAArch64TargetDiagnostic({
              code: "UEFI_AARCH64_PIPELINE_FAILED",
              ownerKey: "test-stop",
              stableDetail: "stop-after-layout-facts",
            }),
          ],
        }),
      },
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "frontend",
      "semantic",
      "monomorphization",
      "layout-facts",
      "proof-mir",
    ]);
    expect(result.verification.runs[3]?.status).toBe("passed");
    const sourceEntryReturn =
      layoutFacts?.computeRepresentationLayoutFactsResult?.facts.imageEntry.sourceEntryReturn;
    expect(sourceEntryReturn?.kind).toBe("direct");
    if (sourceEntryReturn?.kind !== "direct") return;
    expect(sourceEntryReturn.lanes[0]).toMatchObject({ kind: "integer", sizeBytes: 8n });
  });
});

function sourceFirmwareEntryPackageInputForTest() {
  return compilerPackageInput({
    packageKey: "smoke-source-firmware-entry",
    entryModuleName: "image",
    sourceRoots: [
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
    ],
    sourceFiles: [
      {
        sourceKey: "src/image.wr",
        moduleName: "image",
        text: [
          "use Result from wrela_std.core.result",
          "use UefiFirmware, BootError from wrela_std.target.uefi.firmware",
          "uefi image SourceFirmwareEntry:",
          "    fn boot(firmware: UefiFirmware) -> Result[Never, BootError]:",
          "        return {}",
          "",
        ].join("\n"),
      },
      {
        sourceKey: "src/wrela_std/core/result.wr",
        moduleName: "wrela_std.core.result",
        text: ["class Result[Ok, Err]:", ""].join("\n"),
      },
      {
        sourceKey: "src/wrela_std/target/uefi/firmware.wr",
        moduleName: "wrela_std.target.uefi.firmware",
        text: [
          "edge class UefiFirmware:",
          "",
          "enum BootError:",
          "    Memory",
          "    DeviceDiscovery",
          "    DeviceUnavailable",
          "    MachinePlanFailed",
          "    ExitFailed",
          "",
        ].join("\n"),
      },
    ],
  });
}

function targetSurfaceWithUefiImageProfileForTest(): UefiAArch64TargetDriverSurface {
  const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  expect(targetResult.kind).toBe("ok");
  if (targetResult.kind !== "ok") throw new Error("expected authenticated UEFI target");
  return targetResult.value;
}
