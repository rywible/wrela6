import { describe, expect, test } from "bun:test";
import {
  aarch64MachineInstructionId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import {
  aarch64IntMachineType,
  aarch64PointerMachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  aarch64InstructionOperand,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";

describe("AArch64 machine instruction records", () => {
  test("instruction builders validate schema shape and freeze operands", () => {
    const left = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(1),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });
    const right = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(2),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });

    const instruction = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(12),
      opcode: aarch64OpcodeFormId("cmp-shifted-register"),
      operands: [
        useVreg(left, aarch64IntMachineType(64)),
        useVreg(right, aarch64IntMachineType(64)),
        implicitDefResource({ kind: "NZCV" }),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("test:cmp"),
    });

    expect(instruction.operands).toHaveLength(3);
    expect(Object.isFrozen(instruction.operands)).toBe(true);
  });

  test("instruction builders reject missing implicit resources", () => {
    const left = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(3),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });

    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(13),
        opcode: aarch64OpcodeFormId("cmp-shifted-register"),
        operands: [useVreg(left, aarch64IntMachineType(64))],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-cmp"),
      }),
    ).toThrow(RangeError);
  });

  test("instruction builders reject extra operands and wrong role order", () => {
    const value = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(4),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });

    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(14),
        opcode: aarch64OpcodeFormId("ret"),
        operands: [useVreg(value, value.type), branchTarget(1 as never)],
        flags: { mayTrap: false, isTerminator: true },
        origin: syntheticAArch64Origin("test:bad-ret"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(15),
        opcode: aarch64OpcodeFormId("add-shifted-register"),
        operands: [
          useVreg(value, value.type),
          defVreg(value, value.type),
          useVreg(value, value.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-add"),
      }),
    ).toThrow(RangeError);
  });

  test("instruction builders reject invalid immediates and register operand types", () => {
    const value = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(5),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });
    const wordValue = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(6),
      registerClass: "gpr32",
      type: aarch64IntMachineType(32),
    });

    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(16),
        opcode: aarch64OpcodeFormId("movz"),
        operands: [defVreg(value, value.type), immediateOperand(1n << 16n, value.type)],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-movz"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(22),
        opcode: aarch64OpcodeFormId("movk"),
        operands: [
          aarch64InstructionOperand({
            role: "tiedDefUse",
            operand: { kind: "vreg", register: wordValue },
            type: wordValue.type,
          }),
          immediateOperand(1n, wordValue.type),
          immediateOperand(32n, wordValue.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-movk-word-shift"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(21),
        opcode: aarch64OpcodeFormId("movz"),
        operands: [
          defVreg(value, value.type),
          immediateOperand(1n, value.type),
          immediateOperand(3n, value.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-movz-shift"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(18),
        opcode: aarch64OpcodeFormId("cset"),
        operands: [
          defVreg(value, value.type),
          implicitUseResource({ kind: "NZCV" }),
          immediateOperand(16n, value.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-cset-condition"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(23),
        opcode: aarch64OpcodeFormId("csel"),
        operands: [
          defVreg(value, value.type),
          useVreg(value, value.type),
          useVreg(value, value.type),
          implicitUseResource({ kind: "NZCV" }),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-csel-missing-condition"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(24),
        opcode: aarch64OpcodeFormId("csel"),
        operands: [
          defVreg(value, value.type),
          useVreg(value, value.type),
          useVreg(value, value.type),
          implicitUseResource({ kind: "NZCV" }),
          immediateOperand(16n, value.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-csel-condition"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(25),
        opcode: aarch64OpcodeFormId("ccmp"),
        operands: [
          useVreg(value, value.type),
          useVreg(value, value.type),
          immediateOperand(16n, value.type),
          implicitDefResource({ kind: "NZCV" }),
          implicitUseResource({ kind: "NZCV" }),
          immediateOperand(0n, value.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-ccmp-fallback"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(19),
        opcode: aarch64OpcodeFormId("tbz"),
        operands: [
          useVreg(value, value.type),
          immediateOperand(64n, value.type),
          branchTarget(1 as never),
        ],
        flags: { mayTrap: false, isTerminator: true },
        origin: syntheticAArch64Origin("test:bad-tbz-bit"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(20),
        opcode: aarch64OpcodeFormId("ldr-unsigned-immediate"),
        operands: [
          defVreg(value, value.type),
          aarch64InstructionOperand({
            role: "memoryBase",
            operand: { kind: "vreg", register: value },
            type: value.type,
          }),
          immediateOperand(4095n * 16n, value.type),
        ],
        flags: { mayTrap: false, mayLoad: true },
        origin: syntheticAArch64Origin("test:bad-ldr-offset"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(22),
        opcode: aarch64OpcodeFormId("ldar"),
        operands: [
          defVreg(value, value.type),
          aarch64InstructionOperand({
            role: "memoryBase",
            operand: { kind: "vreg", register: value },
            type: value.type,
          }),
          immediateOperand(8n, value.type),
        ],
        flags: { mayTrap: false, mayLoad: true },
        origin: syntheticAArch64Origin("test:bad-ldar-offset"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(23),
        opcode: aarch64OpcodeFormId("b-cond"),
        operands: [implicitUseResource({ kind: "NZCV" }), branchTarget(1 as never)],
        flags: { mayTrap: false, isTerminator: true },
        origin: syntheticAArch64Origin("test:bad-b-cond-missing-condition"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(17),
        opcode: aarch64OpcodeFormId("ret"),
        operands: [useVreg(value, aarch64PointerMachineType("other-address-space"))],
        flags: { mayTrap: false, isTerminator: true },
        origin: syntheticAArch64Origin("test:bad-type"),
      }),
    ).toThrow(RangeError);
  });

  test("instruction builders require immediate operands for immediate opcode forms", () => {
    const output = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(18),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });
    const left = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(19),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });
    const right = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(20),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });

    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(18),
        opcode: aarch64OpcodeFormId("sub-immediate"),
        operands: [
          defVreg(output, output.type),
          useVreg(left, left.type),
          useVreg(right, right.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-sub-immediate"),
      }),
    ).toThrow(RangeError);
    expect(
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(19),
        opcode: aarch64OpcodeFormId("sub-shifted-register"),
        operands: [
          defVreg(output, output.type),
          useVreg(left, left.type),
          useVreg(right, right.type),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:sub-register"),
      }).opcode,
    ).toBe(aarch64OpcodeFormId("sub-shifted-register"));
  });

  test("instruction builders reject immediate operands for register opcode forms", () => {
    const output = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(21),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });
    const left = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(22),
      registerClass: "gpr64",
      type: aarch64IntMachineType(64),
    });

    expect(() =>
      aarch64MachineInstruction({
        instructionId: aarch64MachineInstructionId(20),
        opcode: aarch64OpcodeFormId("add-shifted-register"),
        operands: [
          defVreg(output, output.type),
          useVreg(left, left.type),
          immediateOperand(1n, aarch64IntMachineType(64)),
        ],
        flags: { mayTrap: false },
        origin: syntheticAArch64Origin("test:bad-add-register-immediate"),
      }),
    ).toThrow(RangeError);
  });
});
