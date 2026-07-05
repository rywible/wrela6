import { describe, expect, test } from "bun:test";

import {
  compilerMetadataValue,
  createCompilerStageResult,
  runPackageStage,
  runTargetStage,
  runValidationStage,
} from "../../../src/pipeline";

describe("target, package, and validation pipeline stages", () => {
  test("target errors stop package and validation", async () => {
    let packageRuns = 0;
    let validationRuns = 0;
    const target = runTargetStage({
      input: {} as never,
      lowerTarget: () => ({ kind: "error", diagnostics: [diagnostic("TARGET_BAD")] }) as never,
    });

    const packaged = runPackageStage({
      target: target as never,
      input: {} as never,
      packageTarget: () => {
        packageRuns += 1;
        return targetOkResult() as never;
      },
    });
    const validated = await runValidationStage({
      packageResult: packaged as never,
      request: { targetKey: "wrela-uefi-aarch64-rpi5-v1" },
      dependencies: {} as never,
      validate: async () => {
        validationRuns += 1;
        return validationReport("passed");
      },
    });

    expect(target.kind).toBe("error");
    expect(packaged.kind).toBe("error");
    expect(validated.kind).toBe("error");
    expect(packageRuns).toBe(0);
    expect(validationRuns).toBe(0);
  });

  test("package stage attaches release evidence metadata", () => {
    const target = createCompilerStageResult({
      stage: "target",
      value: {
        kind: "ok",
        machineProgram: {},
        preservedFacts: {},
        provenance: {},
        diagnostics: [],
      },
      diagnostics: [],
    });

    const packaged = runPackageStage({
      target: target as never,
      input: {} as never,
      packageTarget: () => targetOkResult() as never,
    });

    expect(packaged.kind).toBe("ok");
    expect(compilerMetadataValue(packaged.metadata, "releaseEvidence")).toEqual({
      evidenceIds: ["package:to-opt-ir:passed"],
    });
  });

  test("validation stage returns release evidence metadata", async () => {
    const packageResult = createCompilerStageResult({
      stage: "package",
      value: targetOkResult(),
      diagnostics: [],
    });

    const validation = await runValidationStage({
      packageResult: packageResult as never,
      request: { targetKey: "wrela-uefi-aarch64-rpi5-v1" },
      dependencies: {} as never,
      validate: async () => validationReport("passed"),
    });

    expect(validation.kind).toBe("ok");
    expect(compilerMetadataValue(validation.metadata, "releaseEvidence")).toEqual({
      evidenceIds: ["case:smoke:passed"],
    });
  });
});

function targetOkResult() {
  return {
    kind: "ok" as const,
    value: {},
    diagnostics: [],
    verification: {
      runs: [{ verifierKey: "package", runKey: "to-opt-ir", status: "passed" as const }],
    },
  };
}

function validationReport(status: "passed" | "failed") {
  return {
    schema: "wrela.full-image-validation",
    schemaVersion: 1,
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    status,
    diagnostics: [],
    cases: [
      {
        caseKey: "smoke",
        compileStatus: "passed",
        binaryChecks: [],
        referenceChecks: [],
        equivalenceEvidence: [],
        scenario: "minimal",
        stdlibMode: "project-only",
        packageKey: "smoke",
        sourceRoots: [],
        sourceFileCount: 0,
        moduleCount: 0,
        stageRuns: [],
        compilerDiagnostics: [],
        diagnostics: [],
      },
    ],
  } as never;
}

function diagnostic(code: string) {
  return { code, severity: "error", message: code };
}
