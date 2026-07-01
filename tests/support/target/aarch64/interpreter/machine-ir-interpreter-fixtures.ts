import { aarch64MachineBlock } from "../../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import {
  aarch64IntMachineType,
  aarch64PointerMachineType,
  aarch64VectorMachineType,
} from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../../../../../src/target/aarch64/machine-ir/virtual-register";
import type { AArch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";

const i64 = aarch64IntMachineType(64);
const pointer = aarch64PointerMachineType("test");
const vector128 = aarch64VectorMachineType({ laneType: aarch64IntMachineType(8), laneCount: 16 });

export function gpr64ForTest(id: number): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: i64,
    origin: { kind: "synthetic", stableKey: `test.v${id}` },
  });
}

function pointerForTest(id: number): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: pointer,
    origin: { kind: "synthetic", stableKey: `test.ptr${id}` },
  });
}

function vector128ForTest(id: number): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "vector128",
    type: vector128,
    origin: { kind: "synthetic", stableKey: `test.v${id}` },
  });
}

export function instructionForTest(
  id: number,
  opcode: string,
  operands: Parameters<typeof aarch64MachineInstruction>[0]["operands"],
): AArch64MachineInstruction {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(id),
    opcode: aarch64OpcodeFormId(opcode),
    operands,
    flags: {
      mayTrap: opcode === "trap",
      mayLoad: opcode.startsWith("ldr") || opcode === "ldar" || opcode === "ld1",
      mayStore: opcode.startsWith("str") || opcode === "stlr" || opcode === "st1",
      isTerminator:
        opcode === "b" ||
        opcode === "b-cond" ||
        opcode === "br" ||
        opcode === "cbz" ||
        opcode === "cbnz" ||
        opcode === "ret" ||
        opcode === "trap",
    },
    origin: syntheticAArch64Origin(`test.${id}.${opcode}`),
  });
}

export function functionWithCmpBranchForTest(input: {
  readonly left: bigint;
  readonly right: bigint;
  readonly condition: "eq" | "ne" | "lo" | "hs" | "lt";
}): AArch64MachineFunction {
  const left = gpr64ForTest(0);
  const right = gpr64ForTest(1);
  const result = gpr64ForTest(2);
  const registers = [left, right, result];
  const entry = aarch64MachineBlockId(0);
  const taken = aarch64MachineBlockId(1);
  const fallthrough = aarch64MachineBlockId(2);

  return functionForTest(registers, [
    {
      blockId: entry,
      instructions: [
        instructionForTest(0, "movz", [defVreg(left, i64), immediateOperand(input.left, i64)]),
        instructionForTest(1, "movz", [defVreg(right, i64), immediateOperand(input.right, i64)]),
        instructionForTest(2, "cmp-shifted-register", [
          useVreg(left, i64),
          useVreg(right, i64),
          implicitDefResource({ kind: "NZCV" }),
        ]),
      ],
      terminator: instructionForTest(3, "b-cond", [
        implicitUseResource({ kind: "NZCV" }),
        branchTarget(taken),
        immediateOperand(BigInt(conditionCodeForTest(input.condition)), i64),
      ]),
    },
    {
      blockId: taken,
      instructions: [
        instructionForTest(4, "movz", [defVreg(result, i64), immediateOperand(11n, i64)]),
      ],
      terminator: instructionForTest(5, "ret", [useVreg(result, i64)]),
    },
    {
      blockId: fallthrough,
      instructions: [
        instructionForTest(6, "movz", [defVreg(result, i64), immediateOperand(22n, i64)]),
      ],
      terminator: instructionForTest(7, "ret", [useVreg(result, i64)]),
    },
  ]);
}

export function memoryRoundTripFunctionForTest(): AArch64MachineFunction {
  const address = pointerForTest(0);
  const stored = gpr64ForTest(1);
  const loaded = gpr64ForTest(2);
  return functionForTest(
    [address, stored, loaded],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [
          instructionForTest(0, "movz", [
            defVreg(address, pointer),
            immediateOperand(32n, pointer),
          ]),
          instructionForTest(1, "movz", [defVreg(stored, i64), immediateOperand(0x1234n, i64)]),
          instructionForTest(2, "str-unsigned-immediate", [
            useVreg(stored, i64),
            {
              role: "memoryBase",
              operand: { kind: "vreg", register: address },
              type: pointer,
              stableKey: "memoryBase:v0",
            },
            immediateOperand(8n, i64),
          ]),
          instructionForTest(3, "ldr-unsigned-immediate", [
            defVreg(loaded, i64),
            {
              role: "memoryBase",
              operand: { kind: "vreg", register: address },
              type: pointer,
              stableKey: "memoryBase:v0",
            },
            immediateOperand(8n, i64),
          ]),
        ],
        terminator: instructionForTest(4, "ret", [useVreg(loaded, i64)]),
      },
    ],
  );
}

export function orderedStoreLoadFunctionForTest(): AArch64MachineFunction {
  const address = pointerForTest(0);
  const stored = gpr64ForTest(1);
  const loaded = gpr64ForTest(2);
  return functionForTest(
    [address, stored, loaded],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [
          instructionForTest(0, "movz", [
            defVreg(address, pointer),
            immediateOperand(16n, pointer),
          ]),
          instructionForTest(1, "movz", [defVreg(stored, i64), immediateOperand(0x55aan, i64)]),
          instructionForTest(2, "stlr", [
            useVreg(stored, i64),
            {
              role: "memoryBase",
              operand: { kind: "vreg", register: address },
              type: pointer,
              stableKey: "memoryBase:v0",
            },
          ]),
          instructionForTest(3, "dmb", []),
          instructionForTest(4, "ldar", [
            defVreg(loaded, i64),
            {
              role: "memoryBase",
              operand: { kind: "vreg", register: address },
              type: pointer,
              stableKey: "memoryBase:v0",
            },
          ]),
        ],
        terminator: instructionForTest(5, "ret", [useVreg(loaded, i64)]),
      },
    ],
  );
}

export function vectorLoadStoreFunctionForTest(): AArch64MachineFunction {
  const address = pointerForTest(0);
  const stored = vector128ForTest(1);
  const loaded = vector128ForTest(2);
  return functionForTest(
    [address, stored, loaded],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [
          instructionForTest(0, "movz", [
            defVreg(address, pointer),
            immediateOperand(24n, pointer),
          ]),
          instructionForTest(1, "movi", [
            defVreg(stored, vector128),
            immediateOperand(0xaa55n, vector128),
          ]),
          instructionForTest(2, "st1", [
            useVreg(stored, vector128),
            {
              role: "memoryBase",
              operand: { kind: "vreg", register: address },
              type: pointer,
              stableKey: "memoryBase:v0",
            },
          ]),
          instructionForTest(3, "ld1", [
            defVreg(loaded, vector128),
            {
              role: "memoryBase",
              operand: { kind: "vreg", register: address },
              type: pointer,
              stableKey: "memoryBase:v0",
            },
          ]),
        ],
        terminator: instructionForTest(4, "ret", [useVreg(loaded, vector128)]),
      },
    ],
  );
}

export function semanticBinaryFunctionForTest(
  opcode: "crc32" | "pmull" | "dotprod",
): AArch64MachineFunction {
  const left = gpr64ForTest(0);
  const right = gpr64ForTest(1);
  const result = gpr64ForTest(2);
  return functionForTest(
    [left, right, result],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [
          instructionForTest(0, opcode, [
            defVreg(result, i64),
            useVreg(left, i64),
            useVreg(right, i64),
          ]),
        ],
        terminator: instructionForTest(1, "ret", [useVreg(result, i64)]),
      },
    ],
  );
}

export function trapFunctionForTest(): AArch64MachineFunction {
  return functionForTest(
    [],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [],
        terminator: instructionForTest(0, "trap", []),
      },
    ],
  );
}

export function aarch64AddFragmentForTest(): AArch64MachineFunction {
  const left = gpr64ForTest(0);
  const right = gpr64ForTest(1);
  const result = gpr64ForTest(2);
  return functionForTest(
    [left, right, result],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [
          instructionForTest(0, "add-shifted-register", [
            defVreg(result, i64),
            useVreg(left, i64),
            useVreg(right, i64),
          ]),
        ],
        terminator: instructionForTest(1, "ret", [useVreg(result, i64)]),
      },
    ],
  );
}

export function unsupportedMachineFragmentForTest(): AArch64MachineFunction {
  const value = gpr64ForTest(0);
  return functionForTest(
    [value],
    [
      {
        blockId: aarch64MachineBlockId(0),
        instructions: [
          instructionForTest(0, "movn", [defVreg(value, i64), immediateOperand(1n, i64)]),
        ],
        terminator: instructionForTest(1, "ret", [useVreg(value, i64)]),
      },
    ],
  );
}

export function optIrAddFragmentForTest() {
  return { kind: "add" as const };
}

function functionForTest(
  virtualRegisters: readonly AArch64VirtualRegister[],
  blocks: readonly {
    readonly blockId: ReturnType<typeof aarch64MachineBlockId>;
    readonly instructions: readonly AArch64MachineInstruction[];
    readonly terminator: AArch64MachineInstruction;
  }[],
): AArch64MachineFunction {
  return aarch64MachineFunction({
    functionId: aarch64MachineFunctionId(0),
    symbol: aarch64SymbolId("test_function"),
    virtualRegisters,
    parameters: [],
    returns: [],
    frameObjects: [],
    blocks: blocks.map((block, index) =>
      aarch64MachineBlock({
        blockId: block.blockId,
        frequency: index === 0 ? { kind: "entry" } : { kind: "warm" },
        instructions: block.instructions,
        terminator: block.terminator,
      }),
    ),
  });
}

function conditionCodeForTest(condition: "eq" | "ne" | "lo" | "hs" | "lt"): number {
  switch (condition) {
    case "eq":
      return 0;
    case "ne":
      return 1;
    case "hs":
      return 2;
    case "lo":
      return 3;
    case "lt":
      return 5;
  }
}
