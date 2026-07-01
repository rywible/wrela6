import { describe, expect, test } from "bun:test";

import { compileAArch64Object } from "../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import {
  aarch64MachineFunctionForTest,
  aarch64MovzForTest,
} from "../../../../tests/support/target/aarch64/machine-ir/builders";
import {
  backendInputForTest,
  closedImageBackendPlanForTest,
  machineProgramForTest,
} from "../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 backend object integration", () => {
  test("public API emits representative object bytes, provenance, and verification", () => {
    const result = compileAArch64Object(
      backendInputForTest({
        machineProgram: machineProgramForTest({
          functions: [
            aarch64MachineFunctionForTest({
              instructions: [aarch64MovzForTest({ instructionId: 4, value: 42n })],
            }),
          ],
        }),
        closedImagePlan: closedImageBackendPlanForTest({ privateConventions: [] }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected object module");
    expect(result.objectModule.sections[0]?.bytes).toEqual([
      0x40, 0x05, 0x80, 0xd2, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
    expect(result.objectModule.relocations).toEqual([]);
    expect(result.objectModule.byteProvenance.map((record) => record.source)).toEqual([
      "fixture.movz.42",
      "fixture.function:return",
    ]);
    expect(result.verification.runs.map((run) => run.status)).not.toContain("failed");
  });
});
