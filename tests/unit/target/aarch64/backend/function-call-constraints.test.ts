import { describe, expect, test } from "bun:test";

import {
  callLocationConstraintsForFunction,
  loweringCallBoundaries,
} from "../../../../../src/target/aarch64/backend/api/function-call-constraints";
import type { AArch64ReconciledCallBoundary } from "../../../../../src/target/aarch64/backend/abi/call-boundary-reconciliation";
import {
  aarch64MachineInstructionId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  defVreg,
  immediateOperand,
  implicitDefResource,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../../src/target/aarch64/machine-ir/virtual-register";
import {
  aarch64Gpr64ForTest,
  aarch64MachineFunctionForTest,
} from "../../../../support/target/aarch64/machine-ir/builders";

const U64 = aarch64IntMachineType(64);

describe("AArch64 function call constraints", () => {
  test("indirect-call targets do not consume ABI argument locations", () => {
    const call = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(42),
      opcode: aarch64OpcodeFormId("blr"),
      operands: [
        useVreg(aarch64Gpr64ForTest(9), U64),
        ...callClobberOperandsForTest(),
        useVreg(aarch64Gpr64ForTest(10), U64),
        useVreg(aarch64Gpr64ForTest(11), U64),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("fixture.blr.with-arguments"),
    });

    expect(
      callLocationConstraintsForFunction(aarch64MachineFunctionForTest({ instructions: [call] }), [
        boundaryForInstruction(42),
      ]),
    ).toEqual([
      { vreg: 9, instructionOrder: 0, register: "x16" },
      { vreg: 10, instructionOrder: 0, register: "x0" },
      { vreg: 11, instructionOrder: 0, register: "x1" },
    ]);
  });

  test("lowering call boundaries retain argument and result registers for indirect calls", () => {
    const call = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(43),
      opcode: aarch64OpcodeFormId("blr"),
      operands: [useVreg(aarch64Gpr64ForTest(9), U64), ...callClobberOperandsForTest()],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("fixture.blr.boundary"),
    });

    expect(
      loweringCallBoundaries(aarch64MachineFunctionForTest({ instructions: [call] }), [
        boundaryForInstruction(43),
      ]),
    ).toEqual([
      {
        instructionId: 43,
        argumentRegisters: ["x0", "x1"],
        resultRegisters: ["x0"],
      },
    ]);
  });

  test("infers fixed ABI registers from materialized indirect-call argument and return vregs", () => {
    const call = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(44),
      opcode: aarch64OpcodeFormId("blr"),
      operands: [
        useVreg(aarch64Gpr64ForTest(9), U64),
        ...callClobberOperandsForTest(),
        useVreg(abiGpr64ForTest(10, "opt-ir:44:abi-arg:intReg:0:0"), U64),
        useVreg(abiGpr64ForTest(11, "opt-ir:44:abi-arg:intReg:1:1"), U64),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("fixture.blr.materialized-abi"),
    });
    const resultCopy = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(45),
      opcode: aarch64OpcodeFormId("add-immediate"),
      operands: [
        defVreg(aarch64Gpr64ForTest(12), U64),
        useVreg(abiGpr64ForTest(13, "opt-ir:44:abi-return:intReg:0:0"), U64),
        immediateOperand(0n, U64),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("fixture.blr.materialized-result"),
    });

    expect(
      callLocationConstraintsForFunction(
        aarch64MachineFunctionForTest({ instructions: [call, resultCopy] }),
        [boundaryForInstruction(44, { argumentLocations: [], resultLocations: [] })],
      ),
    ).toEqual([
      { vreg: 9, instructionOrder: 0, register: "x16" },
      { vreg: 10, instructionOrder: 0, register: "x0" },
      { vreg: 11, instructionOrder: 0, register: "x1" },
      { vreg: 13, instructionOrder: 0, register: "x0" },
    ]);
  });
});

function boundaryForInstruction(
  instructionId: number,
  options: {
    readonly argumentLocations?: AArch64ReconciledCallBoundary["argumentLocations"];
    readonly resultLocations?: AArch64ReconciledCallBoundary["resultLocations"];
  } = {},
): AArch64ReconciledCallBoundary {
  return {
    callKey: `call:fixture.function:indirect:${instructionId}:insn:${instructionId}`,
    callerKey: "fixture.function",
    calleeKey: "indirect",
    boundaryKind: "public",
    argumentLocations: options.argumentLocations ?? [
      { valueKey: "self", location: { kind: "gpr", register: "x0" } },
      { valueKey: "text", location: { kind: "gpr", register: "x1" } },
    ],
    resultLocations: options.resultLocations ?? [
      { valueKey: "status", location: { kind: "gpr", register: "x0" } },
    ],
    clobberedGprs: [],
    clobberedVectorRegisters: [],
    pinnedLiveThroughGprs: [],
    potentialVeneerClobberGprs: [],
    tailCallEligible: false,
  };
}

function abiGpr64ForTest(id: number, stableKey: string) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: U64,
    origin: { kind: "synthetic", stableKey },
  });
}

function callClobberOperandsForTest() {
  return [
    implicitDefResource({ kind: "NZCV" }),
    implicitDefResource({ kind: "FPCR" }),
    implicitDefResource({ kind: "FPSR" }),
    implicitDefResource({ kind: "vectorState" }),
  ];
}
