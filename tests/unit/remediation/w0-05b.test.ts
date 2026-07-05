import { describe, expect, test } from "bun:test";
import { buildAArch64LayoutFragmentsForProgram } from "../../../src/target/aarch64/backend/api/function-pipeline";
import { aarch64MovzForTest } from "../../support/target/aarch64/machine-ir/builders";
import {
  authenticatedBackendTargetSurfaceForTest,
  closedImageBackendPlanForTest,
  machineProgramForTest,
} from "../../support/target/aarch64/backend/backend-fixtures";
import { aarch64MachineFunctionForTest } from "../../support/target/aarch64/machine-ir/builders";
import { emptyAArch64PreservedFactSet } from "../../../src/target/aarch64/machine-ir/fact-set";
import { importAArch64BackendFacts } from "../../../src/target/aarch64/backend/facts/backend-fact-import";

describe("W0-05b function pipeline allocation/frame seams", () => {
  test("public function-pipeline import still builds deterministic simple function fragments", () => {
    const target = authenticatedBackendTargetSurfaceForTest();
    const machineProgram = machineProgramForTest({
      targetFingerprint: target.sourceSurfaceFingerprint,
      functions: [
        aarch64MachineFunctionForTest({
          instructions: [aarch64MovzForTest({ instructionId: 1, value: 7n })],
        }),
      ],
    });
    const factImport = importAArch64BackendFacts({
      preservedFacts: emptyAArch64PreservedFactSet(),
    });
    if (factImport.kind !== "ok") throw new Error("expected backend fact fixture import");

    const result = buildAArch64LayoutFragmentsForProgram(
      machineProgram,
      closedImageBackendPlanForTest({ privateConventions: [] }),
      factImport.factIndex,
      target,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout fragments");
    expect(result.fragments).toEqual([
      {
        stableKey: "text.fixture.function",
        sectionKey: ".text",
        instructions: [
          {
            stableKey: "insn:fixture.function:1",
            opcode: "movz",
            operands: [
              { kind: "register", register: "x0" },
              { kind: "immediate", value: 7n },
            ],
            provenanceSource: "fixture.movz.7",
          },
          { stableKey: "fixture.function:return", opcode: "ret", operands: [] },
        ],
      },
    ]);
    expect(result.functionArtifacts[0]?.allocationPlan).toEqual(["vreg:1:x0:0-1"]);
    expect(result.functionArtifacts[0]?.frameShape).toBe("frameless-leaf");
  });
});
