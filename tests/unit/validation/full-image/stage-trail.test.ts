import { expect, test } from "bun:test";

import {
  FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS,
  verifyFullImageValidationStageTrail,
} from "../../../../src/validation/full-image";
import type { UefiAArch64TargetVerifierRun } from "../../../../src/target/uefi-aarch64";

const verifierKey = "uefi-aarch64-compile";

function passedRun(runKey: string): UefiAArch64TargetVerifierRun {
  return { verifierKey, runKey, status: "passed" };
}

function requiredRuns(): UefiAArch64TargetVerifierRun[] {
  return FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS.map(passedRun);
}

function requiredRunsThrough(runKey: string): UefiAArch64TargetVerifierRun[] {
  const index = FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS.indexOf(runKey as never);
  return FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS.slice(0, index + 1).map(passedRun);
}

test("accepts successful production confidence stage trail", () => {
  const result = verifyFullImageValidationStageTrail({
    runs: requiredRuns(),
    compileStatus: "passed",
    artifactCreated: true,
  });

  expect(result.kind).toBe("ok");
  expect(result.stageRuns.map((run) => run.runKey)).toEqual([
    ...FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS,
  ]);
});

test("requires successful required stages to be passed", () => {
  const runs = requiredRuns();
  runs[2] = { verifierKey, runKey: "semantic", status: "failed", stableDetail: "semantic:nope" };

  const result = verifyFullImageValidationStageTrail({
    runs,
    compileStatus: "passed",
    artifactCreated: true,
  });

  expect(result.kind).toBe("error");
  expect(
    result.kind === "error" ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail) : [],
  ).toContain("stage-trail:required-stage-not-passed:semantic");
});

test("allows artifact-sink only after PE writer", () => {
  const result = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs: [...requiredRunsThrough("pe-coff-writer"), passedRun("artifact-sink")],
  });

  expect(result.kind).toBe("ok");
});

test("rejects artifact-sink before PE writer", () => {
  const runs = requiredRuns();
  runs.splice(1, 0, passedRun("artifact-sink"));
  const result = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs,
  });

  expect(result.kind).toBe("error");
  expect(
    result.kind === "error" ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail) : [],
  ).toContain("stage-trail:artifact-sink-before-pe-coff-writer");
});

test("allows qemu-smoke only after artifact exists", () => {
  const validResult = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs: [...requiredRuns(), passedRun("qemu-smoke")],
  });
  const error = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: false,
    runs: [...requiredRuns(), passedRun("qemu-smoke")],
  });

  expect(validResult.kind).toBe("ok");
  expect(error.kind).toBe("error");
  expect(
    error.kind === "error" ? error.diagnostics.map((diagnostic) => diagnostic.stableDetail) : [],
  ).toContain("stage-trail:qemu-smoke-without-artifact");
});

test("rejects qemu-smoke before the artifact-producing stage even if final artifact exists", () => {
  const runs = requiredRuns();
  runs.splice(1, 0, passedRun("qemu-smoke"));

  const result = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs,
  });

  expect(result.kind).toBe("error");
  expect(
    result.kind === "error" ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail) : [],
  ).toContain("stage-trail:qemu-smoke-without-artifact");
});

test("rejects unknown extra keys unless explicitly allowed", () => {
  const rejected = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs: [...requiredRuns(), passedRun("custom-audit")],
  });
  const accepted = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    allowedExtraStageRunKeys: ["custom-audit"],
    runs: [...requiredRuns(), passedRun("custom-audit")],
  });

  expect(rejected.kind).toBe("error");
  expect(accepted.kind).toBe("ok");
});

test("rejects duplicate required keys", () => {
  const result = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs: [
      ...requiredRunsThrough("semantic"),
      passedRun("semantic"),
      ...FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS.slice(3).map(passedRun),
    ],
  });

  expect(result.kind).toBe("error");
  expect(
    result.kind === "error" ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail) : [],
  ).toEqual(["stage-trail:duplicate-required-stage:semantic"]);
});

test("rejects missing required keys with stable detail naming the missing key", () => {
  const result = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs: requiredRuns().filter((run) => run.runKey !== "semantic"),
  });

  expect(result.kind).toBe("error");
  expect(
    result.kind === "error" ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail) : [],
  ).toContain("stage-trail:missing-required-stage:semantic");
});

test("failed compile records observed trail without inventing later stages", () => {
  const result = verifyFullImageValidationStageTrail({
    compileStatus: "failed",
    artifactCreated: false,
    runs: [
      passedRun("target-driver-authenticate"),
      passedRun("frontend"),
      { verifierKey, runKey: "semantic", status: "failed", stableDetail: "semantic:no-adapter" },
    ],
  });

  expect(result.stageRuns.map((run) => run.runKey)).toEqual([
    "target-driver-authenticate",
    "frontend",
    "semantic",
  ]);
  expect(result.stageRuns[2]?.stableDetail).toBe("semantic:no-adapter");
});
