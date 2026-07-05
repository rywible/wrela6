import { describe, expect, test } from "bun:test";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  compileUefiAArch64Image,
  compileUefiAArch64ImageWithTraceAsync,
  compileUefiAArch64ImageWithTrace,
  type PackageOptimizedOptIrAdapter,
  type UefiAArch64ImageArtifact,
  type UefiAArch64QemuHostEffects,
  type UefiAArch64QemuSmokeCommandPlan,
} from "../../../../src/target/uefi-aarch64";
import { optimizedOptIrProgramWithEntryParameterForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";
import { uefiAArch64PackagePipelineDependenciesForOptimizedFixture } from "../../../support/target/uefi-aarch64/package-pipeline-fixtures";

describe("compileUefiAArch64Image", () => {
  test("compiles a package through the real binary spine to a deterministic EFI artifact", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;

    const input = {
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "smoke.efi",
      smoke: { kind: "disabled" as const },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
    };

    const first = compileUefiAArch64Image(input);
    const second = compileUefiAArch64Image(input);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;
    expect(first.artifact.artifactName).toBe("smoke.efi");
    expect(first.artifact.peCoffArtifact.bytes).toEqual(second.artifact.peCoffArtifact.bytes);
    expect(first.artifact.targetMetadata).toEqual(second.artifact.targetMetadata);
    expect(first.artifact.targetMetadata.schema).toBe("wrela.uefi-aarch64-image");
    expect(first.artifact.smoke?.targetDriverFingerprint).toBe(
      first.artifact.targetMetadata.targetDriverFingerprint,
    );
    expect(first.verification.runs.map((run) => run.runKey)).toEqual([
      "target-driver-authenticate",
      ...packagePipelineRunKeys,
      ...binarySpineRunKeys,
    ]);
  });

  test("trace API compiles the same package with the same public result and completed phase outputs", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;

    const input = {
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "trace.efi",
      smoke: { kind: "disabled" as const },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
    };

    const legacy = compileUefiAArch64Image(input);
    const traced = compileUefiAArch64ImageWithTrace(input);

    expect(legacy.kind).toBe("ok");
    expect(traced.kind).toBe("ok");
    if (legacy.kind !== "ok" || traced.kind !== "ok") return;

    expect(traced.artifact.peCoffArtifact.bytes).toEqual(legacy.artifact.peCoffArtifact.bytes);
    expect(traced.artifact.targetMetadata).toEqual(legacy.artifact.targetMetadata);
    expect(traced.artifact.artifactName).toBe(legacy.artifact.artifactName);
    expect(traced.diagnostics).toEqual(legacy.diagnostics);
    expect(traced.verification.runs.map((run) => run.runKey)).toEqual(
      legacy.verification.runs.map((run) => run.runKey),
    );
    expect(traced.trace.target.targetDriverFingerprint).toBe(
      traced.artifact.targetMetadata.targetDriverFingerprint,
    );
    expect(traced.trace.target.semanticPlatformCatalogFingerprint).toBe(
      traced.artifact.targetMetadata.semanticPlatformCatalogFingerprint,
    );
    expect(traced.trace.packagePipeline.stages.map((stage) => String(stage.stageKey))).toEqual(
      packagePipelineRunKeys,
    );
    expect(traced.trace.binarySpine.stages.map((stage) => String(stage.stageKey))).toEqual(
      binarySpineRunKeys,
    );
  });

  test("async trace API runs inline QEMU smoke through injected host effects", async () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;
    const host = fakeQemuHostEffects((command) => command.expectedConsoleMarkers.join("\n"));
    const writtenArtifacts: UefiAArch64ImageArtifact[] = [];

    const result = await compileUefiAArch64ImageWithTraceAsync({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "inline-smoke.efi",
      smoke: {
        kind: "run",
        config: qemuConfigForTest(),
        hostEffects: host.effects,
        expectedConsoleMarkers: ["WRELA_COMPILE_SMOKE_OK"],
        timeoutMs: 1234,
      },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
      output: {
        writeArtifact: (artifact) => {
          writtenArtifacts.push(artifact);
          return {
            kind: "ok" as const,
            value: {},
            diagnostics: [],
            verification: { runs: [] },
          };
        },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.artifact.smoke).toMatchObject({
      status: "passed",
      stableDetail: "qemu-smoke:markers-observed",
      observedMarkers: ["WRELA_COMPILE_SMOKE_OK"],
      targetDriverFingerprint: result.artifact.targetMetadata.targetDriverFingerprint,
    });
    expect(result.artifact.smoke?.stableDetail).not.toBe("qemu-smoke:separate-runner-required");
    expect(host.timeouts).toEqual([1234]);
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0]?.artifactName).toBe("inline-smoke.efi");
    expect(host.writes.map((write) => write.path)).toEqual([
      "wrela-uefi-aarch64-compile-test/EFI/BOOT/BOOTAA64.EFI",
    ]);
    expect(host.writes[0]?.bytes).toEqual(result.artifact.peCoffArtifact.bytes);
    expect(writtenArtifacts).toHaveLength(1);
    expect(writtenArtifacts[0]?.smoke).toEqual(result.artifact.smoke);
    expect(result.verification.runs.at(-2)).toEqual({
      verifierKey: "uefi-aarch64-compile",
      runKey: "qemu-smoke",
      status: "passed",
    });
    expect(result.verification.runs.at(-1)).toEqual({
      verifierKey: "uefi-aarch64-compile",
      runKey: "artifact-sink",
      status: "passed",
    });
  });

  test("async compile reports missing inline QEMU marker without failing artifact creation", async () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;
    const host = fakeQemuHostEffects(() => "");

    const result = await compileUefiAArch64ImageWithTraceAsync({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "inline-smoke-missing-marker.efi",
      smoke: {
        kind: "run",
        config: qemuConfigForTest(),
        hostEffects: host.effects,
        expectedConsoleMarkers: ["WRELA_COMPILE_SMOKE_OK"],
      },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.artifact.smoke).toMatchObject({
      status: "failed",
      stableDetail: "qemu-smoke:missing-markers:WRELA_COMPILE_SMOKE_OK",
      observedMarkers: [],
    });
    expect(result.verification.runs.at(-1)).toEqual({
      verifierKey: "uefi-aarch64-compile",
      runKey: "qemu-smoke",
      status: "failed",
    });
  });

  test("fails before package pipeline stages when target authentication fails", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;

    const result = compileUefiAArch64Image({
      packageInput: packageInput.value,
      target: { ...uefiTargetSurfaceFixture(), targetKey: "wrong" as never },
      smoke: { kind: "disabled" },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe("UEFI_AARCH64_TARGET_AUTH_FAILED");
    expect(result.verification.runs).toEqual([
      {
        verifierKey: "uefi-aarch64-compile",
        runKey: "target-driver-authenticate",
        status: "failed",
      },
    ]);
  });

  test("expands package pipeline failure trails into compile verification stages", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;

    const packagePipelineDependencies = {
      ...uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
      buildOptimizedOptIr: () => ({
        kind: "error" as const,
        diagnostics: [
          {
            code: "UEFI_AARCH64_PIPELINE_FAILED" as const,
            ownerKey: "fake-opt-ir",
            stableDetail: "fake-opt-ir:failed",
          },
        ],
      }),
    };

    const result = compileUefiAArch64Image({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
      packagePipelineDependencies,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "target-driver-authenticate",
      ...packagePipelineRunKeys,
    ]);
    expect(result.verification.runs.slice(0, -1).every((run) => run.status === "passed")).toBe(
      true,
    );
    expect(result.verification.runs.at(-1)).toEqual({
      verifierKey: "uefi-aarch64-compile",
      runKey: "opt-ir",
      status: "failed",
    });
  });

  test("expands binary spine failure trails into compile verification stages", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;
    const optIrFixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();

    const packagePipelineDependencies = {
      ...uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
      buildOptimizedOptIr: () => ({
        kind: "ok" as const,
        value: unsafePackagePipelineAdapter<PackageOptimizedOptIrAdapter>({
          program: optIrFixture.program,
          operations: Object.freeze([...optIrFixture.operations]),
          unoptimizedOperations: Object.freeze([...optIrFixture.operations]),
          facts: emptyOptIrFactSet(),
          staticChar16Strings: Object.freeze([]),
          staticChar16Pointers: Object.freeze([]),
        }),
        diagnostics: [],
      }),
    };

    const result = compileUefiAArch64Image({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "bad-entry.efi",
      smoke: { kind: "disabled" },
      packagePipelineDependencies,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.verification.runs.map((run) => run.runKey)).toEqual([
      "target-driver-authenticate",
      ...packagePipelineRunKeys,
      "aarch64-lowering",
    ]);
    expect(result.verification.runs.slice(0, -1).every((run) => run.status === "passed")).toBe(
      true,
    );
    expect(result.verification.runs.at(-1)).toEqual({
      verifierKey: "uefi-aarch64-compile",
      runKey: "aarch64-lowering",
      status: "failed",
    });
  });

  test("trace API returns partial trace only for completed phases when later phases fail", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;

    const targetFailure = compileUefiAArch64ImageWithTrace({
      packageInput: packageInput.value,
      target: { ...uefiTargetSurfaceFixture(), targetKey: "wrong" as never },
      smoke: { kind: "disabled" },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
    });
    expect(targetFailure.kind).toBe("error");
    if (targetFailure.kind !== "error") return;
    expect(targetFailure.partialTrace).toEqual({});

    const packagePipelineDependencies = {
      ...uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
      buildOptimizedOptIr: () => ({
        kind: "error" as const,
        diagnostics: [
          {
            code: "UEFI_AARCH64_PIPELINE_FAILED" as const,
            ownerKey: "fake-opt-ir",
            stableDetail: "fake-opt-ir:failed",
          },
        ],
      }),
    };

    const pipelineFailure = compileUefiAArch64ImageWithTrace({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
      packagePipelineDependencies,
    });
    expect(pipelineFailure.kind).toBe("error");
    if (pipelineFailure.kind !== "error") return;
    expect(pipelineFailure.partialTrace.target?.targetKey).toBe(
      uefiTargetSurfaceFixture().targetKey,
    );
    expect(pipelineFailure.partialTrace.packagePipeline).toBeUndefined();
    expect(pipelineFailure.partialTrace.binarySpine).toBeUndefined();

    const sinkFailure = compileUefiAArch64ImageWithTrace({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "sink-trace.efi",
      smoke: { kind: "disabled" },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
      output: {
        writeArtifact: () => ({
          kind: "error" as const,
          diagnostics: [
            {
              code: "UEFI_AARCH64_PIPELINE_FAILED" as const,
              ownerKey: "fake-sink",
              stableDetail: "fake-sink:write-failed",
            },
          ],
          verification: { runs: [] },
        }),
      },
    });
    expect(sinkFailure.kind).toBe("error");
    if (sinkFailure.kind !== "error") return;
    expect(sinkFailure.partialTrace.target?.targetKey).toBe(uefiTargetSurfaceFixture().targetKey);
    expect(
      sinkFailure.partialTrace.packagePipeline?.stages.map((stage) => String(stage.stageKey)),
    ).toEqual(packagePipelineRunKeys);
    expect(
      sinkFailure.partialTrace.binarySpine?.stages.map((stage) => String(stage.stageKey)),
    ).toEqual(binarySpineRunKeys);
    expect(sinkFailure.partialTrace.binarySpine?.peCoffArtifact.artifactName).toBe(
      "sink-trace.efi",
    );
  });

  test("returns artifact sink errors without throwing", () => {
    const packageInput = uefiCompilePackageInputFixture("success");
    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;
    const writtenArtifacts: UefiAArch64ImageArtifact[] = [];

    const result = compileUefiAArch64Image({
      packageInput: packageInput.value,
      target: uefiTargetSurfaceFixture(),
      artifactName: "sink.efi",
      smoke: { kind: "disabled" },
      packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
      output: {
        writeArtifact: (artifact) => {
          writtenArtifacts.push(artifact);
          return {
            kind: "error" as const,
            diagnostics: [
              {
                code: "UEFI_AARCH64_PIPELINE_FAILED" as const,
                ownerKey: "fake-sink",
                stableDetail: "fake-sink:write-failed",
              },
            ],
            verification: { runs: [] },
          };
        },
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(writtenArtifacts).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      {
        code: "UEFI_AARCH64_ARTIFACT_SINK_FAILED",
        ownerKey: "artifact-sink",
        stableDetail: "fake-sink:write-failed",
      },
    ]);
    expect(result.verification.runs.at(-1)).toEqual({
      verifierKey: "uefi-aarch64-compile",
      runKey: "artifact-sink",
      status: "failed",
    });
  });
});

const packagePipelineRunKeys = [
  "frontend",
  "semantic",
  "monomorphization",
  "layout-facts",
  "proof-mir",
  "proof-check",
  "opt-ir",
];

const binarySpineRunKeys = [
  "aarch64-lowering",
  "aarch64-backend",
  "static-char16-objects",
  "validation-fixture-objects",
  "runtime-helper-objects",
  "synthetic-entry-object",
  "linker",
  "pe-coff-writer",
];

function unsafePackagePipelineAdapter<Adapter>(value: unknown): Adapter {
  return Object.freeze(value as object) as Adapter;
}

function qemuConfigForTest() {
  return Object.freeze({
    qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
    firmwareCodePath: "/tmp/AAVMF_CODE.fd",
    machine: "virt" as const,
    cpu: "cortex-a76" as const,
    memoryMiB: 512,
    accel: "tcg" as const,
  });
}

function fakeQemuHostEffects(
  stdoutForCommand: (command: UefiAArch64QemuSmokeCommandPlan) => string,
) {
  const commands: UefiAArch64QemuSmokeCommandPlan[] = [];
  const timeouts: number[] = [];
  const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];
  const effects: UefiAArch64QemuHostEffects = Object.freeze({
    createTempDirectory: async (prefix: string) => `${prefix}compile-test`,
    writeFile: async (path: string, bytes: Uint8Array | readonly number[]) => {
      writes.push(Object.freeze({ path, bytes: Uint8Array.from(bytes) }));
    },
    copyFile: async () => {},
    runProcess: async (command: UefiAArch64QemuSmokeCommandPlan, timeoutMs: number) => {
      commands.push(command);
      timeouts.push(timeoutMs);
      return Object.freeze({
        stdout: stdoutForCommand(command),
        stderr: "",
        timedOut: false,
        cleanupFailed: false,
        missingTools: false,
        terminatedByHarness: true,
      });
    },
    removeDirectory: async () => {},
  });
  return Object.freeze({ effects, commands, timeouts, writes });
}
