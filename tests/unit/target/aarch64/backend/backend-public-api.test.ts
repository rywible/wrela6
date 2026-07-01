import { describe, expect, test } from "bun:test";

import {
  AARCH64_BACKEND_STAGE_KEYS,
  compileAArch64Object,
  defaultAArch64BackendPipeline,
} from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import { compileAArch64Object as compileFromAarch64Root } from "../../../../../src/target/aarch64";
import {
  backendInputForTest,
  machineProgramForTest,
  staleBackendTargetSurfaceForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 backend public API", () => {
  test("exports compileAArch64Object and canonical stage order", () => {
    expect(compileFromAarch64Root).toBe(compileAArch64Object);
    expect(defaultAArch64BackendPipeline.map((stage) => stage.stageKey)).toEqual([
      ...AARCH64_BACKEND_STAGE_KEYS,
    ]);
  });

  test("empty valid input emits empty object after verifier stages run", () => {
    const result = compileAArch64Object(backendInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected empty object module");
    expect(result.objectModule.sections).toEqual([]);
    expect(result.verification.runs.map((run) => run.verifierKey)).toContain("input-contract");
    expect(result.verification.runs.map((run) => run.verifierKey)).toContain("object-module");
  });

  test("stale backend target stops at input contract", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest(),
        target: staleBackendTargetSurfaceForTest(),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected input contract error");
    expect(result.verification.runs.map((run) => run.verifierKey)).toEqual(["input-contract"]);
  });

  test("debug artifact collection remains a real successful stage", () => {
    const result = compileAArch64Object(
      backendInputForTest({ debugArtifacts: { verifierTrace: true } }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected successful debug artifact collection");
    expect(result.debugArtifacts?.verifierTrace).toContain("debug-artifact-collection");
    expect(result.verification.runs.map((run) => run.verifierKey)).toContain(
      "end-to-end-stage-wiring",
    );
  });
});
