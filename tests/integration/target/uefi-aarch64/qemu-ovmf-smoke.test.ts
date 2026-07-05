import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64TargetDriverSurface,
  compileUefiAArch64Image,
  defaultUefiAArch64SourceRoots,
  packageInputFromFixtureProject,
  qemuSmokeConfigFromEnvironment,
  runUefiAArch64QemuSmoke,
  type PackageProofCheckAdapter,
  type PackageProofMirAdapter,
  type PackageRepresentationLayoutFactsAdapter,
} from "../../../../src/target/uefi-aarch64";
import { nodeUefiAArch64QemuHostEffects } from "../../../../src/target/uefi-aarch64/qemu-smoke-host";
import {
  nodeFixtureProjectFilesystem,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";
import { uefiAArch64PackagePipelineDependenciesForOptimizedFixture } from "../../../support/target/uefi-aarch64/package-pipeline-fixtures";
import { unsafePackagePipelineAdapter } from "./package-pipeline-support";

describe("UEFI AArch64 real QEMU smoke", () => {
  test("uses a unit-success image entry for the compiled smoke fixture", () => {
    const target = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(target.kind).toBe("ok");
    if (target.kind !== "ok") return;

    const result = uefiAArch64PackagePipelineDependenciesForOptimizedFixture().buildOptimizedOptIr({
      target: target.value,
      proofCheck: unsafePackagePipelineAdapter<PackageProofCheckAdapter>({ kind: "proof-check" }),
      proofMir: unsafePackagePipelineAdapter<PackageProofMirAdapter>({ kind: "proof-mir" }),
      layoutFacts: unsafePackagePipelineAdapter<PackageRepresentationLayoutFactsAdapter>({
        kind: "layout-facts",
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.program).toBeDefined();
    if (result.value.program === undefined) return;

    const entryFunction = result.value.program.functions
      .entries()
      .find((func) => func.externalRoot?.reason === "imageEntry");
    expect(entryFunction).toBeDefined();
    if (entryFunction === undefined) return;

    const entryBlock = entryFunction.blocks.find(
      (block) => block.blockId === entryFunction.entryBlock,
    );
    expect(entryBlock?.parameters).toEqual([]);
    expect(entryBlock?.terminator?.kind).toBe("return");
    if (entryBlock?.terminator?.kind !== "return") return;
    expect(entryBlock.terminator.values).toEqual([]);
  });

  test("runs smoke-basic when QEMU and AAVMF are configured", async () => {
    const config = qemuSmokeConfigFromEnvironment(process.env);

    if (config.kind === "skipped") {
      expect(config.stableDetail).toStartWith("qemu-smoke:missing-env:");
      return;
    }

    const packageInput = packageInputFromFixtureProject("tests/fixtures/uefi-aarch64/smoke-basic", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }),
      filesystem: nodeFixtureProjectFilesystem,
    });
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;

    const result = compileUefiAArch64Image({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const smoke = await runUefiAArch64QemuSmoke({
      artifact: result.artifact,
      request: {
        kind: "qemu",
        allowSkip: false,
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
        termination: "kill-after-marker",
        timeoutMs: 30000,
      },
      config: config.config,
      hostEffects: nodeUefiAArch64QemuHostEffects(),
    });

    expect(smoke.status).toBe("passed");
  }, 60000);
});
