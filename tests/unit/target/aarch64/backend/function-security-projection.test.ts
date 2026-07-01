import { describe, expect, test } from "bun:test";

import { observableExitsForFunction } from "../../../../../src/target/aarch64/backend/api/function-security-projection";
import { aarch64MachineInstructionId } from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import { useVreg } from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64Gpr64ForTest,
  aarch64MachineFunctionForTest,
  aarch64TrapForTest,
} from "../../../../../tests/support/target/aarch64/machine-ir/builders";

describe("AArch64 function security projection", () => {
  test("projects traps and register branches as observable exits", () => {
    const type = aarch64IntMachineType(64);
    const machineFunction = aarch64MachineFunctionForTest({
      symbol: "secure.exit",
      instructions: [
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(41),
          opcode: aarch64OpcodeFormId("br"),
          operands: [useVreg(aarch64Gpr64ForTest(0), type)],
          flags: { mayTrap: false, isTerminator: true },
          origin: syntheticAArch64Origin("fixture.tail"),
        }),
      ],
      terminator: aarch64TrapForTest({ instructionId: 42 }),
    });

    expect(observableExitsForFunction("secure.exit", machineFunction)).toEqual([
      { exitKey: "secure.exit:tail-call:41", exitKind: "tail-call" },
      { exitKey: "secure.exit:trap:42", exitKind: "trap" },
    ]);
  });
});
