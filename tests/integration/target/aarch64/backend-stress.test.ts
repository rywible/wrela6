import { describe, expect, test } from "bun:test";

import { compileAArch64Object } from "../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import { compareOptIrAndAArch64Fragment } from "../../../../src/target/aarch64/interpreter/machine-ir-differential";
import {
  backendInputForTest,
  closedImageBackendPlanForTest,
  machineProgramForTest,
} from "../../../support/target/aarch64/backend/backend-fixtures";
import {
  generateBackendStressCorpus,
  generateStressProgram,
  type BackendStressShape,
} from "../../../support/target/aarch64/stress-program-generator";

describe("AArch64 seeded backend stress lane", () => {
  test("stress programs are deterministic by seed and shape", () => {
    const first = generateStressProgram({ seed: 42, shape: "spill-heavy" });
    const second = generateStressProgram({ seed: 42, shape: "spill-heavy" });
    const differentSeed = generateStressProgram({ seed: 43, shape: "spill-heavy" });

    expect(first.caseKey).toBe("stress:spill-heavy:42");
    expect(second).toEqual(first);
    expect(differentSeed).not.toEqual(first);
  });

  test("two hundred seeded cases cover every backend stress shape", () => {
    const corpus = generateBackendStressCorpus({ seed: 5000, cases: 200 });
    const shapes = new Set(corpus.map((program) => program.shape));

    expect(corpus).toHaveLength(200);
    expect([...shapes].sort()).toEqual([
      "call-heavy",
      "large-frame",
      "parallel-copy",
      "spill-heavy",
      "wide-constant",
    ] satisfies BackendStressShape[]);
  });

  test("seeded stress corpus survives backend pipeline and interpreter differential", () => {
    const corpus = generateBackendStressCorpus({ seed: 8000, cases: 200 });

    for (const program of corpus) {
      const compiled = compileAArch64Object(
        backendInputForTest({
          machineProgram: machineProgramForTest({ functions: [program.machineFunction] }),
          closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
        }),
      );

      expect(compiled.kind, program.caseKey).toBe("ok");
      if (compiled.kind !== "ok")
        throw new Error(`expected backend success for ${program.caseKey}`);
      expect(
        compiled.verification.runs.map((run) => run.status),
        program.caseKey,
      ).not.toContain("failed");

      const differential = compareOptIrAndAArch64Fragment({
        optIr: { kind: "const", value: program.expectedReturnValue },
        machine: program.machineFunction,
        inputs: [{ values: [], expected: program.expectedReturnValue }],
        interpreterOptions: { maxSteps: 256 },
      });

      expect(differential, program.caseKey).toEqual({ kind: "equivalent", cases: 1 });
    }
  });
});
