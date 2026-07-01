import { describe, expect, test } from "bun:test";
import { emptyAArch64PreservedFactSet } from "../../../../src/target/aarch64/machine-ir/fact-set";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import {
  aarch64IntMachineType,
  type AArch64MachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64MemoryOrderingMetadata } from "../../../../src/target/aarch64/machine-ir/memory-order";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  aarch64InstructionOperand,
  defVreg,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64ScheduleMetadata,
  defaultAArch64ScheduleMetadata,
  type AArch64IssueClass,
} from "../../../../src/target/aarch64/machine-ir/schedule";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import { placeAArch64BarriersForPlanningState } from "../../../../src/target/aarch64/plan/barrier-placement";
import { createAArch64MachinePlanningState } from "../../../../src/target/aarch64/plan/machine-planning-state";
import { planAArch64LoadStorePairsForPlanningState } from "../../../../src/target/aarch64/plan/pair-load-store-planning";
import { planAArch64PrefetchesForPlanningState } from "../../../../src/target/aarch64/plan/prefetch-planning";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 planning-state transforms", () => {
  test("load/store pair planning requires adjacent 64-bit footprint evidence", () => {
    const planned = planAArch64LoadStorePairsForPlanningState({
      state: planningStateFor([
        loadForTest({ instructionId: 1, output: 1, base: 10, start: 0n }),
        loadForTest({ instructionId: 2, output: 2, base: 10, start: 8n }),
      ]),
    });

    const instructions = planned.machineFunction.blocks[0]?.instructions ?? [];
    expect(planned.revision).toBe(1);
    expect(instructions.map((instruction) => String(instruction.opcode))).toEqual([
      "ldp-signed-offset",
    ]);
    expect(instructions[0]?.operands.map((operand) => operand.role)).toEqual([
      "def",
      "def",
      "memoryBase",
    ]);
    expect(planned.machineFunction.schedulePlan).toContain(
      "pair-load-store:adjacent-normal-cacheable",
    );
  });

  test("load/store pair planning rejects same-address and narrow candidates", () => {
    const differentBase = planAArch64LoadStorePairsForPlanningState({
      state: planningStateFor([
        loadForTest({ instructionId: 1, output: 1, base: 10, start: 0n }),
        loadForTest({ instructionId: 2, output: 2, base: 11, start: 8n }),
      ]),
    });
    const sameAddress = planAArch64LoadStorePairsForPlanningState({
      state: planningStateFor([
        loadForTest({ instructionId: 1, output: 1, base: 10, start: 0n }),
        loadForTest({ instructionId: 2, output: 2, base: 11, start: 0n }),
      ]),
    });
    const narrow = planAArch64LoadStorePairsForPlanningState({
      state: planningStateFor([
        loadForTest({ instructionId: 1, output: 1, base: 10, start: 0n, widthBits: 32 }),
        loadForTest({ instructionId: 2, output: 2, base: 11, start: 4n, widthBits: 32 }),
      ]),
    });

    expect(opcodes(differentBase)).toEqual(["ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(opcodes(sameAddress)).toEqual(["ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(opcodes(narrow)).toEqual(["ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(differentBase.revision).toBe(0);
    expect(sameAddress.revision).toBe(0);
    expect(narrow.revision).toBe(0);
  });

  test("load/store pair planning rejects mismatched memory order", () => {
    const planned = planAArch64LoadStorePairsForPlanningState({
      state: planningStateFor([
        loadForTest({
          instructionId: 1,
          output: 1,
          base: 10,
          start: 0n,
          order: "relaxed",
        }),
        loadForTest({
          instructionId: 2,
          output: 2,
          base: 10,
          start: 8n,
          order: "compilerOnlyOrdered",
        }),
      ]),
    });

    expect(opcodes(planned)).toEqual(["ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(planned.revision).toBe(0);
  });

  test("prefetch planning inserts one normal-cacheable prefetch before a load stream", () => {
    const planned = planAArch64PrefetchesForPlanningState({
      state: planningStateFor([
        loadForTest({ instructionId: 1, output: 1, base: 10, start: 0n }),
        loadForTest({ instructionId: 2, output: 2, base: 11, start: 8n }),
      ]),
    });

    expect(planned.revision).toBe(1);
    expect(opcodes(planned)).toEqual(["prfm", "ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(planned.machineFunction.schedulePlan).toContain("prefetch:normal-load-stream");
  });

  test("prefetch planning rejects device or hard-boundary load streams", () => {
    const device = planAArch64PrefetchesForPlanningState({
      state: planningStateFor([
        loadForTest({
          instructionId: 1,
          output: 1,
          base: 10,
          start: 0n,
          regionMemoryType: "deviceMmio",
        }),
        loadForTest({
          instructionId: 2,
          output: 2,
          base: 11,
          start: 8n,
          regionMemoryType: "deviceMmio",
        }),
      ]),
    });
    const hardBoundary = planAArch64PrefetchesForPlanningState({
      state: planningStateFor([
        loadForTest({
          instructionId: 1,
          output: 1,
          base: 10,
          start: 0n,
          motion: "hardBoundary",
        }),
        loadForTest({ instructionId: 2, output: 2, base: 11, start: 8n }),
      ]),
    });

    expect(opcodes(device)).toEqual(["ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(opcodes(hardBoundary)).toEqual(["ldr-unsigned-immediate", "ldr-unsigned-immediate"]);
    expect(device.revision).toBe(0);
    expect(hardBoundary.revision).toBe(0);
  });

  test("barrier placement inserts required hard boundaries by access direction", () => {
    const seqCstLoad = placeAArch64BarriersForPlanningState({
      state: planningStateFor([
        loadForTest({
          instructionId: 1,
          output: 1,
          base: 10,
          start: 0n,
          order: "sequentiallyConsistent",
        }),
      ]),
    });
    const seqCstStore = placeAArch64BarriersForPlanningState({
      state: planningStateFor([
        storeForTest({
          instructionId: 2,
          input: 1,
          base: 10,
          start: 0n,
          order: "sequentiallyConsistent",
        }),
      ]),
    });
    const deviceLoad = placeAArch64BarriersForPlanningState({
      state: planningStateFor([
        loadForTest({ instructionId: 3, output: 1, base: 10, start: 0n, order: "deviceOrdered" }),
      ]),
    });

    expect(opcodes(seqCstLoad)).toEqual(["dmb", "ldr-unsigned-immediate"]);
    expect(opcodes(seqCstStore)).toEqual(["str-unsigned-immediate", "dmb"]);
    expect(opcodes(deviceLoad)).toEqual(["dsb", "ldr-unsigned-immediate"]);
    expect(seqCstLoad.machineFunction.blocks[0]?.instructions[0]?.schedule.motion.kind).toBe(
      "hardBoundary",
    );
    expect(seqCstStore.machineFunction.blocks[0]?.instructions[1]?.schedule.motion.kind).toBe(
      "hardBoundary",
    );
  });

  test("barrier placement does not duplicate existing barriers", () => {
    const planned = placeAArch64BarriersForPlanningState({
      state: planningStateFor([
        barrierForTest({ instructionId: 9, opcode: "dmb" }),
        loadForTest({
          instructionId: 1,
          output: 1,
          base: 10,
          start: 0n,
          order: "sequentiallyConsistent",
        }),
        storeForTest({
          instructionId: 2,
          input: 1,
          base: 10,
          start: 8n,
          order: "sequentiallyConsistent",
        }),
        barrierForTest({ instructionId: 10, opcode: "dmb" }),
      ]),
    });

    expect(opcodes(planned)).toEqual([
      "dmb",
      "ldr-unsigned-immediate",
      "str-unsigned-immediate",
      "dmb",
    ]);
  });
});

type MemoryOrderInput = Parameters<typeof aarch64MemoryOrderingMetadata>[0]["order"];
type RegionMemoryTypeInput = Parameters<
  typeof aarch64MemoryOrderingMetadata
>[0]["regionMemoryType"];
type MotionKind = ReturnType<typeof defaultAArch64ScheduleMetadata>["motion"]["kind"];

function planningStateFor(instructions: readonly AArch64MachineInstruction[]) {
  return createAArch64MachinePlanningState({
    machineFunction: aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(1),
      symbol: aarch64SymbolId("planning.fixture"),
      virtualRegisters: registerRange(0, 20),
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
    preservedFacts: emptyAArch64PreservedFactSet(),
    targetPlanning: fakeAArch64TargetSurface().planning,
  });
}

function loadForTest(input: {
  readonly instructionId: number;
  readonly output: number;
  readonly base: number;
  readonly start: bigint;
  readonly widthBits?: 32 | 64;
  readonly order?: MemoryOrderInput;
  readonly regionMemoryType?: RegionMemoryTypeInput;
  readonly motion?: MotionKind;
}) {
  const output = registerForTest(input.output, input.widthBits ?? 64);
  const base = registerForTest(input.base, 64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("ldr-unsigned-immediate"),
    operands: [defVreg(output, output.type), memoryBaseOperand(base)],
    flags: { mayTrap: false, mayLoad: true },
    origin: syntheticAArch64Origin(`planning.load.${input.instructionId}`),
    schedule: memorySchedule({
      issueClass: "load",
      region: "packet",
      start: input.start,
      widthBytes: BigInt((input.widthBits ?? 64) / 8),
      motion: input.motion,
    }),
    memoryOrdering: memoryOrdering({
      order: input.order,
      regionMemoryType: input.regionMemoryType,
      access: "loads",
    }),
  });
}

function storeForTest(input: {
  readonly instructionId: number;
  readonly input: number;
  readonly base: number;
  readonly start: bigint;
  readonly widthBits?: 32 | 64;
  readonly order?: MemoryOrderInput;
  readonly regionMemoryType?: RegionMemoryTypeInput;
}) {
  const stored = registerForTest(input.input, input.widthBits ?? 64);
  const base = registerForTest(input.base, 64);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId("str-unsigned-immediate"),
    operands: [useVreg(stored, stored.type), memoryBaseOperand(base)],
    flags: { mayTrap: false, mayStore: true },
    origin: syntheticAArch64Origin(`planning.store.${input.instructionId}`),
    schedule: memorySchedule({
      issueClass: "store",
      region: "packet",
      start: input.start,
      widthBytes: BigInt((input.widthBits ?? 64) / 8),
    }),
    memoryOrdering: memoryOrdering({
      order: input.order,
      regionMemoryType: input.regionMemoryType,
      access: "stores",
    }),
  });
}

function barrierForTest(input: { readonly instructionId: number; readonly opcode: "dmb" | "dsb" }) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.instructionId),
    opcode: aarch64OpcodeFormId(input.opcode),
    operands: [],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`planning.barrier.${input.instructionId}`),
    schedule: aarch64ScheduleMetadata({
      ...defaultAArch64ScheduleMetadata("barrier"),
      motion: { kind: "hardBoundary" },
    }),
  });
}

function memoryOrdering(input: {
  readonly order?: MemoryOrderInput;
  readonly regionMemoryType?: RegionMemoryTypeInput;
  readonly access: "loads" | "stores";
}) {
  return aarch64MemoryOrderingMetadata({
    order: input.order ?? "relaxed",
    regionMemoryType: input.regionMemoryType ?? "normalCacheable",
    barrierDomain: { domain: "system", access: input.access },
    atomicity: "nonAtomic",
  });
}

function memorySchedule(input: {
  readonly issueClass: AArch64IssueClass;
  readonly region: string;
  readonly start: bigint;
  readonly widthBytes: bigint;
  readonly motion?: MotionKind;
}) {
  return aarch64ScheduleMetadata({
    ...defaultAArch64ScheduleMetadata(input.issueClass),
    motion: { kind: input.motion ?? "insideEffectIsland" },
    pairability: [
      `memory-footprint:${input.region}:${String(input.start)}:${String(input.widthBytes)}`,
    ],
  });
}

function memoryBaseOperand(register: ReturnType<typeof registerForTest>) {
  return aarch64InstructionOperand({
    role: "memoryBase",
    operand: { kind: "vreg", register },
    type: register.type,
  });
}

function registerRange(start: number, endInclusive: number) {
  return Array.from({ length: endInclusive - start + 1 }, (_unused, index) =>
    registerForTest(start + index, 64),
  );
}

function registerForTest(id: number, widthBits: 32 | 64) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: widthBits === 32 ? "gpr32" : "gpr64",
    type: integerType(widthBits),
    origin: { kind: "synthetic", stableKey: `planning.vreg.${id}.${widthBits}` },
  });
}

function integerType(widthBits: 32 | 64): AArch64MachineType {
  return aarch64IntMachineType(widthBits);
}

function opcodes(input: ReturnType<typeof createAArch64MachinePlanningState>) {
  return (input.machineFunction.blocks[0]?.instructions ?? []).map((instruction) =>
    String(instruction.opcode),
  );
}
