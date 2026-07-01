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
import { applyAArch64OutOfProfileAndErrataStageState } from "../../../../src/target/aarch64/select/selection-policy";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 out-of-profile instruction enforcement", () => {
  test("stage rejects forbidden emitted opcode families before machine verification", () => {
    const result = applyOutOfProfileAndErrataStage.run({
      state: stateWithInstructions([
        uncheckedInstructionForTest(1, "sve-ld1b"),
        uncheckedInstructionForTest(2, "sve2-whilelo"),
        uncheckedInstructionForTest(3, "mops-copy"),
        uncheckedInstructionForTest(4, "pauth-auth"),
        uncheckedInstructionForTest(5, "bti"),
        uncheckedInstructionForTest(6, "mte-check"),
      ]),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected out-of-profile diagnostics");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_SVE:sve-ld1b:instruction:1",
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_SVE2:sve2-whilelo:instruction:2",
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_MOPS:mops-copy:instruction:3",
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_PAUTH:pauth-auth:instruction:4",
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_BTI:bti:instruction:5",
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_MTE:mte-check:instruction:6",
    ]);
  });

  test("stage-state helper does not swallow out-of-profile diagnostics", () => {
    expect(() =>
      applyAArch64OutOfProfileAndErrataStageState(
        stateWithInstructions([uncheckedInstructionForTest(1, "sve-ld1b")]),
      ),
    ).toThrow(
      "out-of-profile-instruction:wrela-uefi-aarch64-rpi5-v1:FEAT_SVE:sve-ld1b:instruction:1",
    );
  });

  test("stage records a real planning checkpoint when no machine IR is available yet", () => {
    const result = applyOutOfProfileAndErrataStage.run({
      state: createAArch64LoweringState({
        program: optIrProgramForTest(),
        operations: [],
        facts: emptyOptIrFactSet(),
        target: fakeAArch64TargetSurface(),
        options: {},
        preservedFacts: emptyAArch64PreservedFactSet(),
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected stage success");
    expect(result.output.state.debugOutput.stageTrace).toContain("apply-out-of-profile-and-errata");
    expect(result.output.state.planningRecords.map((record) => record.action)).toContain(
      "profile-and-errata-filtered",
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
  const symbol = aarch64SymbolId("test.out-of-profile");
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
    origin: syntheticAArch64Origin(`test.out-of-profile.${instructionId}`),
    schedule: defaultAArch64ScheduleMetadata("integer"),
  };
}
