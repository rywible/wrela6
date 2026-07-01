import { describe, expect, test } from "bun:test";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import { optIrProgramForTest } from "../../../support/opt-ir/cfg-fakes";
import { emptyAArch64PreservedFactSet } from "../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64MachineProgramId,
  aarch64SymbolId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64MachineProgram } from "../../../../src/target/aarch64/machine-ir/machine-program";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  emptyAArch64ProvenanceMap,
  syntheticAArch64Origin,
} from "../../../../src/target/aarch64/machine-ir/provenance";
import { defaultAArch64ScheduleMetadata } from "../../../../src/target/aarch64/machine-ir/schedule";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import { createAArch64LoweringState } from "../../../../src/target/aarch64/lower/lowering-context";
import { applyOutOfProfileAndErrataStage } from "../../../../src/target/aarch64/lower/stages/apply-out-of-profile-and-errata";
import {
  aarch64ErrataScheduleConstraintsForOpcode,
  applyAArch64Errata,
  errataForAArch64Implementation,
} from "../../../../src/target/aarch64/target-surface/errata-catalog";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("aarch64 errata catalog", () => {
  test("maps declared implementations to deterministic substitutions and schedule constraints", () => {
    expect(errataForAArch64Implementation("cortex-a76-rpi5-like")).toEqual([
      {
        kind: "substitution",
        erratumId: "A76_1286807",
        matchOpcode: "STP_PRE_INDEX",
        replacementOpcode: "SUB_ADD_STP_OFFSET",
        stableDetail: "erratum:A76_1286807:substitute:STP_PRE_INDEX:SUB_ADD_STP_OFFSET",
      },
      {
        kind: "schedule-constraint",
        erratumId: "A76_1463225",
        requiredSpacing: 1,
        sourceOpcode: "MRS_CNTVCT_EL0",
        blockedFollowerOpcode: "ISB",
        stableDetail: "erratum:A76_1463225:schedule-spacing:MRS_CNTVCT_EL0:ISB:1",
      },
    ]);
  });

  test("applies compile-time errata decisions without runtime probing", () => {
    const decision = applyAArch64Errata({
      implementationId: "cortex-a76-rpi5-like",
      opcode: "STP_PRE_INDEX",
    });

    expect(decision).toEqual({
      kind: "substitute",
      erratumId: "A76_1286807",
      opcode: "SUB_ADD_STP_OFFSET",
      stableDetail: "erratum:A76_1286807:substitute:STP_PRE_INDEX:SUB_ADD_STP_OFFSET",
    });
  });

  test("reports schedule constraints from the declared errata catalog", () => {
    expect(
      aarch64ErrataScheduleConstraintsForOpcode({
        implementationId: "cortex-a76-rpi5-like",
        opcode: "MRS_CNTVCT_EL0",
      }),
    ).toEqual(["erratum:A76_1463225:schedule-spacing:MRS_CNTVCT_EL0:ISB:1"]);
  });

  test("pipeline stage applies errata substitutions and records schedule constraints", () => {
    const result = applyOutOfProfileAndErrataStage.run({
      state: stateWithInstructions([
        uncheckedInstructionForTest(1, "STP_PRE_INDEX"),
        uncheckedInstructionForTest(2, "MRS_CNTVCT_EL0"),
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected errata stage success");
    const instructions =
      result.output.state.machineProgram?.functions.entries()[0]?.blocks[0]?.instructions;
    expect(instructions?.map((instruction) => String(instruction.opcode))).toEqual([
      "SUB_ADD_STP_OFFSET",
      "MRS_CNTVCT_EL0",
    ]);
    expect(instructions?.[1]?.schedule.errataConstraints).toContain(
      "erratum:A76_1463225:schedule-spacing:MRS_CNTVCT_EL0:ISB:1",
    );
    expect(result.output.state.planningRecords.flatMap((record) => record.explanation)).toEqual(
      expect.arrayContaining([
        "profile-and-errata:erratum:A76_1286807:substitute:STP_PRE_INDEX:SUB_ADD_STP_OFFSET",
        "profile-and-errata:erratum:A76_1463225:schedule-spacing:MRS_CNTVCT_EL0:ISB:1",
      ]),
    );
  });
});

function stateWithInstructions(instructions: readonly AArch64MachineInstruction[]) {
  return Object.freeze({
    ...createAArch64LoweringState({
      program: optIrProgramForTest(),
      operations: [],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      options: {},
      preservedFacts: emptyAArch64PreservedFactSet(),
    }),
    machineProgram: machineProgramForTest(instructions),
  });
}

function machineProgramForTest(instructions: readonly AArch64MachineInstruction[]) {
  const symbol = aarch64SymbolId("test.errata");
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(1),
    functions: [
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol,
        virtualRegisters: [],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions,
          }),
        ],
      }),
    ],
    globalSymbols: [aarch64SymbolReference({ symbol, visibility: "global", section: "text" })],
    entrySymbol: symbol,
    targetFingerprint: "target:test",
    consultedSubsurfaceFingerprints: [],
    provenance: emptyAArch64ProvenanceMap(),
  });
}

function uncheckedInstructionForTest(
  instructionId: number,
  opcode: string,
): AArch64MachineInstruction {
  return {
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId(opcode),
    operands: [],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test.errata.${instructionId}`),
    schedule: defaultAArch64ScheduleMetadata("integer"),
  };
}
