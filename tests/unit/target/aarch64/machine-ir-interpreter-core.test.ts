import { describe, expect, test } from "bun:test";
import { optIrValueId } from "../../../../src/opt-ir/ids";
import { runAArch64MachineIrInterpreter } from "../../../../src/target/aarch64/interpreter/machine-ir-interpreter";
import { aarch64MachineMemoryState } from "../../../../src/target/aarch64/interpreter/machine-memory-state";
import { materializeAArch64Constant } from "../../../../src/target/aarch64/lower/constant-materialization";
import { aarch64AbiBinding } from "../../../../src/target/aarch64/machine-ir/abi-location";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64IntMachineType,
  aarch64PointerMachineType,
  aarch64VectorMachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import { defaultAArch64ScheduleMetadata } from "../../../../src/target/aarch64/machine-ir/schedule";
import {
  aarch64InstructionOperand,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import {
  functionWithCmpBranchForTest,
  instructionForTest,
  memoryRoundTripFunctionForTest,
  trapFunctionForTest,
} from "../../../support/target/aarch64/interpreter/machine-ir-interpreter-fixtures";

describe("AArch64 machine IR core interpreter", () => {
  test("move-wide constant chunks preserve their shift", () => {
    const result = runAArch64MachineIrInterpreter({
      function: singleBlockFunctionForTest([
        ...materializeAArch64Constant({ value: 0x12340000n }).instructions,
      ]),
      inputs: [],
      maxSteps: 16,
    });

    expect(result).toMatchObject({ kind: "returned", returnValue: 0x12340000n });
  });

  test("vector byte reversal preserves all 128 bits", () => {
    const result = runAArch64MachineIrInterpreter({
      function: vectorReverseFunctionForTest(),
      inputs: [],
      maxSteps: 16,
    });

    expect(result).toMatchObject({
      kind: "returned",
      returnValue: 0xffeeddccbbaa99887766554433221100n,
      trace: ["movi", "vector-rev", "ret"],
    });
  });

  test("signed less-than compare uses NZCV signed predicates", () => {
    const result = runAArch64MachineIrInterpreter({
      function: functionWithCmpBranchForTest({ left: 1n, right: 2n, condition: "lt" }),
      inputs: [],
      maxSteps: 32,
    });

    expect(result).toMatchObject({ kind: "returned", returnValue: 11n });
  });

  test("threads NZCV from cmp into conditional branch", () => {
    const result = runAArch64MachineIrInterpreter({
      function: functionWithCmpBranchForTest({ left: 3n, right: 5n, condition: "lo" }),
      inputs: [],
      maxSteps: 32,
    });

    expect(result).toMatchObject({
      kind: "returned",
      returnValue: 11n,
      trace: ["movz", "movz", "cmp-shifted-register", "b-cond", "movz", "ret"],
      nzcv: { negative: true, zero: false, carry: false, overflow: false },
    });
  });

  test("csel reads its explicit condition immediate", () => {
    const equalResult = runAArch64MachineIrInterpreter({
      function: cselFunctionForTest({ condition: 0n }),
      inputs: [],
      maxSteps: 32,
    });
    const notEqualResult = runAArch64MachineIrInterpreter({
      function: cselFunctionForTest({ condition: 1n }),
      inputs: [],
      maxSteps: 32,
    });

    expect(equalResult).toMatchObject({ kind: "returned", returnValue: 9n });
    expect(notEqualResult).toMatchObject({ kind: "returned", returnValue: 7n });
  });

  test("ccmp applies fallback NZCV only when its condition fails", () => {
    const fallbackResult = runAArch64MachineIrInterpreter({
      function: ccmpFunctionForTest({ guardEqual: false }),
      inputs: [],
      maxSteps: 32,
    });
    const comparedResult = runAArch64MachineIrInterpreter({
      function: ccmpFunctionForTest({ guardEqual: true }),
      inputs: [],
      maxSteps: 32,
    });

    expect(fallbackResult).toMatchObject({ kind: "returned", returnValue: 1n });
    expect(comparedResult).toMatchObject({ kind: "returned", returnValue: 0n });
  });

  test("conditional interpreter forms reject missing condition immediates", () => {
    expect(() =>
      runAArch64MachineIrInterpreter({
        function: malformedCselFunctionForTest(),
        inputs: [],
        maxSteps: 8,
      }),
    ).toThrow(RangeError);
  });

  test("loads and stores little-endian integer bytes", () => {
    const result = runAArch64MachineIrInterpreter({
      function: memoryRoundTripFunctionForTest(),
      inputs: [],
      maxSteps: 32,
    });

    expect(result).toMatchObject({
      kind: "returned",
      returnValue: 0x1234n,
      effects: { nextToken: 2 },
    });
    expect(result.memoryBytes.slice(40, 48)).toEqual([0x34, 0x12, 0, 0, 0, 0, 0, 0]);
  });

  test("loads and stores use machine type byte width", () => {
    const result = runAArch64MachineIrInterpreter({
      function: narrowMemoryStoreFunctionForTest(),
      inputs: [],
      memory: aarch64MachineMemoryState([0, 0, 0, 0, 0, 0, 0, 0, 0xee, 0xee, 0xee, 0xee]),
      maxSteps: 32,
    });

    expect(result).toMatchObject({ kind: "returned", returnValue: 0xaan });
    expect(result.memoryBytes.slice(8, 12)).toEqual([0xaa, 0xee, 0xee, 0xee]);
  });

  test("starts at the explicit entry block instead of the first sorted block", () => {
    const result = runAArch64MachineIrInterpreter({
      function: nonFirstEntryFunctionForTest(),
      inputs: [],
      maxSteps: 16,
    });

    expect(result).toMatchObject({
      kind: "returned",
      returnValue: 7n,
      trace: ["movz", "ret"],
    });
  });

  test("binds interpreter inputs through ABI parameter value keys", () => {
    const result = runAArch64MachineIrInterpreter({
      function: abiParameterInputFunctionForTest(),
      inputs: [10n, 3n],
      maxSteps: 16,
    });

    expect(result).toMatchObject({
      kind: "returned",
      returnValue: 7n,
      trace: ["sub-shifted-register", "ret"],
    });
  });

  test("branches through indirect br target registers", () => {
    const result = runAArch64MachineIrInterpreter({
      function: indirectBranchFunctionForTest(),
      inputs: [],
      maxSteps: 16,
    });

    expect(result).toMatchObject({
      kind: "returned",
      returnValue: 123n,
      trace: ["movz", "br", "movz", "ret"],
    });
  });

  test("stops on trap terminator", () => {
    const result = runAArch64MachineIrInterpreter({
      function: trapFunctionForTest(),
      inputs: [],
      maxSteps: 8,
    });

    expect(result).toMatchObject({
      kind: "trapped",
      trap: { reason: "trap-instruction" },
      trace: ["trap"],
    });
  });
});

function singleBlockFunctionForTest(
  instructions: readonly ReturnType<typeof aarch64MachineInstruction>[],
) {
  const returnRegister = aarch64VirtualRegister({
    vreg: 0 as never,
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(0),
    symbol: aarch64SymbolId("test_constant"),
    virtualRegisters: [returnRegister],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions,
        terminator: aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(99),
          opcode: aarch64OpcodeFormId("ret"),
          operands: [useVreg(returnRegister, returnRegister.type)],
          flags: { mayTrap: false, isTerminator: true },
          origin: syntheticAArch64Origin("test:return-constant"),
        }),
      }),
    ],
  });
}

function vectorReverseFunctionForTest() {
  const vectorType = aarch64VectorMachineType({
    laneType: aarch64IntMachineType(8),
    laneCount: 16,
  });
  const source = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(150),
    registerClass: "vector128",
    type: vectorType,
  });
  const result = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(151),
    registerClass: "vector128",
    type: vectorType,
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(150),
    symbol: aarch64SymbolId("test_vector_rev"),
    virtualRegisters: [source, result],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(150),
            opcode: aarch64OpcodeFormId("movi"),
            operands: [
              defVreg(source, vectorType),
              immediateOperand(0x00112233445566778899aabbccddeeffn, vectorType),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:vector-rev:movi"),
          }),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(151),
            opcode: aarch64OpcodeFormId("vector-rev"),
            operands: [defVreg(result, vectorType), useVreg(source, vectorType)],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:vector-rev"),
          }),
        ],
        terminator: aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(152),
          opcode: aarch64OpcodeFormId("ret"),
          operands: [useVreg(result, vectorType)],
          flags: { mayTrap: false, isTerminator: true },
          origin: syntheticAArch64Origin("test:vector-rev:ret"),
        }),
      }),
    ],
  });
}

function cselFunctionForTest(input: { readonly condition: bigint }) {
  const i64 = aarch64IntMachineType(64);
  const left = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(70),
    registerClass: "gpr64",
    type: i64,
  });
  const right = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(71),
    registerClass: "gpr64",
    type: i64,
  });
  const trueValue = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(72),
    registerClass: "gpr64",
    type: i64,
  });
  const falseValue = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(73),
    registerClass: "gpr64",
    type: i64,
  });
  const result = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(74),
    registerClass: "gpr64",
    type: i64,
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(7),
    symbol: aarch64SymbolId("test_csel_condition"),
    virtualRegisters: [left, right, trueValue, falseValue, result],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          instructionForTest(70, "movz", [defVreg(left, i64), immediateOperand(1n, i64)]),
          instructionForTest(71, "movz", [defVreg(right, i64), immediateOperand(2n, i64)]),
          instructionForTest(72, "cmp-shifted-register", [
            useVreg(left, i64),
            useVreg(right, i64),
            implicitDefResource({ kind: "NZCV" }),
          ]),
          instructionForTest(73, "movz", [defVreg(trueValue, i64), immediateOperand(7n, i64)]),
          instructionForTest(74, "movz", [defVreg(falseValue, i64), immediateOperand(9n, i64)]),
          instructionForTest(75, "csel", [
            defVreg(result, i64),
            useVreg(trueValue, i64),
            useVreg(falseValue, i64),
            implicitUseResource({ kind: "NZCV" }),
            immediateOperand(input.condition, i64),
          ]),
        ],
        terminator: instructionForTest(76, "ret", [useVreg(result, i64)]),
      }),
    ],
  });
}

function ccmpFunctionForTest(input: { readonly guardEqual: boolean }) {
  const i64 = aarch64IntMachineType(64);
  const guardLeft = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(80),
    registerClass: "gpr64",
    type: i64,
  });
  const guardRight = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(81),
    registerClass: "gpr64",
    type: i64,
  });
  const compareLeft = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(82),
    registerClass: "gpr64",
    type: i64,
  });
  const compareRight = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(83),
    registerClass: "gpr64",
    type: i64,
  });
  const result = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(84),
    registerClass: "gpr64",
    type: i64,
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(8),
    symbol: aarch64SymbolId("test_ccmp_condition"),
    virtualRegisters: [guardLeft, guardRight, compareLeft, compareRight, result],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          instructionForTest(80, "movz", [defVreg(guardLeft, i64), immediateOperand(1n, i64)]),
          instructionForTest(81, "movz", [
            defVreg(guardRight, i64),
            immediateOperand(input.guardEqual ? 1n : 2n, i64),
          ]),
          instructionForTest(82, "cmp-shifted-register", [
            useVreg(guardLeft, i64),
            useVreg(guardRight, i64),
            implicitDefResource({ kind: "NZCV" }),
          ]),
          instructionForTest(83, "movz", [defVreg(compareLeft, i64), immediateOperand(5n, i64)]),
          instructionForTest(84, "movz", [defVreg(compareRight, i64), immediateOperand(6n, i64)]),
          instructionForTest(85, "ccmp", [
            useVreg(compareLeft, i64),
            useVreg(compareRight, i64),
            immediateOperand(0b0100n, i64),
            implicitDefResource({ kind: "NZCV" }),
            implicitUseResource({ kind: "NZCV" }),
            immediateOperand(0n, i64),
          ]),
          instructionForTest(86, "cset", [
            defVreg(result, i64),
            implicitUseResource({ kind: "NZCV" }),
            immediateOperand(0n, i64),
          ]),
        ],
        terminator: instructionForTest(87, "ret", [useVreg(result, i64)]),
      }),
    ],
  });
}

function malformedCselFunctionForTest() {
  const i64 = aarch64IntMachineType(64);
  const result = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(90),
    registerClass: "gpr64",
    type: i64,
  });
  const left = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(91),
    registerClass: "gpr64",
    type: i64,
  });
  const right = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(92),
    registerClass: "gpr64",
    type: i64,
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(9),
    symbol: aarch64SymbolId("test_bad_csel_condition"),
    virtualRegisters: [result, left, right],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          {
            instructionId: aarch64MachineInstructionId(90),
            opcode: aarch64OpcodeFormId("csel"),
            operands: [
              defVreg(result, i64),
              useVreg(left, i64),
              useVreg(right, i64),
              implicitUseResource({ kind: "NZCV" }),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:bad-csel-condition"),
            schedule: defaultAArch64ScheduleMetadata("integer"),
          },
        ],
        terminator: instructionForTest(91, "ret", [useVreg(result, i64)]),
      }),
    ],
  });
}

function nonFirstEntryFunctionForTest() {
  const coldResult = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(20),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
  const entryResult = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(21),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(2),
    symbol: aarch64SymbolId("test_non_first_entry"),
    virtualRegisters: [coldResult, entryResult],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      immediateReturnBlockForTest({
        blockId: 0,
        frequency: "cold",
        register: coldResult,
        value: 99n,
        instructionBase: 20,
      }),
      immediateReturnBlockForTest({
        blockId: 7,
        frequency: "entry",
        register: entryResult,
        value: 7n,
        instructionBase: 30,
      }),
    ],
  });
}

function abiParameterInputFunctionForTest() {
  const first = optIrValueRegisterForTest({ vreg: 20, valueId: 1 });
  const second = optIrValueRegisterForTest({ vreg: 1, valueId: 2 });
  const result = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(30),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
  const i64 = aarch64IntMachineType(64);
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(3),
    symbol: aarch64SymbolId("test_abi_parameter_inputs"),
    virtualRegisters: [second, first, result],
    parameters: [
      aarch64AbiBinding({ valueKey: "optir.value:1", location: { kind: "intReg", index: 0 } }),
      aarch64AbiBinding({ valueKey: "optir.value:2", location: { kind: "intReg", index: 1 } }),
    ],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          instructionForTest(40, "sub-shifted-register", [
            defVreg(result, i64),
            useVreg(first, i64),
            useVreg(second, i64),
          ]),
        ],
        terminator: instructionForTest(41, "ret", [useVreg(result, i64)]),
      }),
    ],
  });
}

function indirectBranchFunctionForTest() {
  const target = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(40),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
  const result = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(41),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
  const i64 = aarch64IntMachineType(64);
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(4),
    symbol: aarch64SymbolId("test_indirect_branch"),
    virtualRegisters: [target, result],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          instructionForTest(50, "movz", [defVreg(target, i64), immediateOperand(7n, i64)]),
        ],
        terminator: instructionForTest(51, "br", [useVreg(target, i64)]),
      }),
      immediateReturnBlockForTest({
        blockId: 7,
        frequency: "warm",
        register: result,
        value: 123n,
        instructionBase: 52,
      }),
    ],
  });
}

function immediateReturnBlockForTest(input: {
  readonly blockId: number;
  readonly frequency: "entry" | "hot" | "warm" | "cold" | "terminalCold";
  readonly register: ReturnType<typeof aarch64VirtualRegister>;
  readonly value: bigint;
  readonly instructionBase: number;
}) {
  const i64 = aarch64IntMachineType(64);
  return aarch64MachineBlock({
    blockId: aarch64MachineBlockId(input.blockId),
    frequency: { kind: input.frequency },
    instructions: [
      instructionForTest(input.instructionBase, "movz", [
        defVreg(input.register, i64),
        immediateOperand(input.value, i64),
      ]),
    ],
    terminator: instructionForTest(input.instructionBase + 1, "ret", [
      useVreg(input.register, i64),
    ]),
  });
}

function optIrValueRegisterForTest(input: {
  readonly vreg: number;
  readonly valueId: number;
}): ReturnType<typeof aarch64VirtualRegister> {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(input.vreg),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
    origin: { kind: "optIrValue", valueId: optIrValueId(input.valueId) },
  });
}

function narrowMemoryStoreFunctionForTest() {
  const byteType = aarch64IntMachineType(8);
  const pointer = aarch64PointerMachineType("test");
  const address = aarch64VirtualRegister({
    vreg: 10 as never,
    registerClass: "gpr64",
    type: pointer,
  });
  const stored = aarch64VirtualRegister({
    vreg: 11 as never,
    registerClass: "gpr64",
    type: byteType,
  });
  const loaded = aarch64VirtualRegister({
    vreg: 12 as never,
    registerClass: "gpr64",
    type: byteType,
  });
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(1),
    symbol: aarch64SymbolId("test_narrow_memory"),
    virtualRegisters: [address, stored, loaded],
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: [
      aarch64MachineBlock({
        blockId: aarch64MachineBlockId(0),
        frequency: { kind: "entry" },
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(1),
            opcode: aarch64OpcodeFormId("movz"),
            operands: [defVreg(address, pointer), immediateOperand(8n, pointer)],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:narrow-address"),
          }),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(2),
            opcode: aarch64OpcodeFormId("movz"),
            operands: [defVreg(stored, byteType), immediateOperand(0xaan, byteType)],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("test:narrow-value"),
          }),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(3),
            opcode: aarch64OpcodeFormId("str-unsigned-immediate"),
            operands: [
              useVreg(stored, byteType),
              aarch64InstructionOperand({
                role: "memoryBase",
                operand: { kind: "vreg", register: address },
                type: pointer,
              }),
            ],
            flags: { mayTrap: false, mayStore: true },
            origin: syntheticAArch64Origin("test:narrow-store"),
          }),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(4),
            opcode: aarch64OpcodeFormId("ldr-unsigned-immediate"),
            operands: [
              defVreg(loaded, byteType),
              aarch64InstructionOperand({
                role: "memoryBase",
                operand: { kind: "vreg", register: address },
                type: pointer,
              }),
            ],
            flags: { mayTrap: false, mayLoad: true },
            origin: syntheticAArch64Origin("test:narrow-load"),
          }),
        ],
        terminator: aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(5),
          opcode: aarch64OpcodeFormId("ret"),
          operands: [useVreg(loaded, byteType)],
          flags: { mayTrap: false, isTerminator: true },
          origin: syntheticAArch64Origin("test:narrow-ret"),
        }),
      }),
    ],
  });
}
