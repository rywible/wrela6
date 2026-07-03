import { describe, expect, test } from "bun:test";

import { buildAArch64InterferenceGraph } from "../../../../../src/target/aarch64/backend/allocation/interference";
import { buildAArch64LiveIntervals } from "../../../../../src/target/aarch64/backend/allocation/liveness";
import { createAArch64Rpi5PhysicalRegisterModel } from "../../../../../src/target/aarch64/backend/api/physical-register-model";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
} from "../../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  symbolOperand,
  useVreg,
} from "../../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../../src/target/aarch64/machine-ir/provenance";
import {
  aarch64AddForTest,
  aarch64CallForTest,
  aarch64Gpr64ForTest,
  aarch64MovzForTest,
} from "../../../../support/target/aarch64/machine-ir/builders";

describe("AArch64 liveness and interference", () => {
  test("keeps values live across CFG joins", () => {
    const result = buildAArch64LiveIntervals({
      func: aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol: aarch64SymbolId("cfg.join"),
        virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1), aarch64Gpr64ForTest(2)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [aarch64MovzForTest({ instructionId: 0, value: 1n })],
            terminator: aarch64MachineInstruction({
              instructionId: aarch64MachineInstructionId(1),
              opcode: aarch64OpcodeFormId("b-cond"),
              operands: [
                implicitUseResource({ kind: "NZCV" }),
                branchTarget(aarch64MachineBlockId(2)),
                immediateOperand(0n, aarch64IntMachineType(8)),
              ],
              flags: { mayTrap: false, isTerminator: true },
              origin: syntheticAArch64Origin("fixture.bcond"),
            }),
          }),
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(1),
            instructions: [],
            terminator: aarch64MachineInstruction({
              instructionId: aarch64MachineInstructionId(2),
              opcode: aarch64OpcodeFormId("b"),
              operands: [branchTarget(aarch64MachineBlockId(2))],
              flags: { mayTrap: false, isTerminator: true },
              origin: syntheticAArch64Origin("fixture.b"),
            }),
          }),
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(2),
            instructions: [aarch64AddForTest({ instructionId: 3 })],
          }),
        ],
      }),
    });

    expect(result.byVreg(0)?.segments).toEqual([{ startOrder: 0, endOrder: 4, reason: "live" }]);
  });

  test("reports physical alias interferences from call-clobbered intervals", () => {
    const graph = buildAArch64InterferenceGraph({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "gpr64",
          segments: [{ startOrder: 0, endOrder: 4, reason: "live" }],
          cutPoints: [2],
          noSpill: false,
          clobberedPhysicalRegisters: ["x0"],
        },
      ],
      aliases: [{ left: "x0", right: "w0" }],
    });

    expect(graph.physicalInterferencesFor(1)).toEqual(["w0", "x0"]);
  });

  test("preserves call-clobber metadata across split live-through-call intervals", () => {
    const result = buildAArch64LiveIntervals({
      func: aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol: aarch64SymbolId("live.call"),
        virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(1), aarch64Gpr64ForTest(2)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [
              aarch64MovzForTest({ instructionId: 0, value: 1n }),
              aarch64CallForTest({ instructionId: 1, callee: "helper" }),
              aarch64AddForTest({ instructionId: 2 }),
            ],
          }),
        ],
        callClobbers: [
          {
            callKey: "call:live.call:helper:insn:1",
            registers: {
              convention: "aapcs64",
              gpr: ["x0"],
              vector: ["v0"],
            },
            memoryEffects: [],
          },
        ],
      }),
    });

    expect(result.byVreg(0)?.segments).toEqual([
      { startOrder: 0, endOrder: 1, reason: "pre-call" },
      { startOrder: 1, endOrder: 3, reason: "post-call" },
    ]);
    expect(result.byVreg(0)?.cutPoints).toEqual([1]);
    expect(result.byVreg(0)?.clobberedPhysicalRegisters).toEqual(["v0", "x0"]);
  });

  test("omits call-clobber metadata for values that are not live through the call", () => {
    const result = buildAArch64LiveIntervals({
      func: aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol: aarch64SymbolId("dead.before.call"),
        virtualRegisters: [aarch64Gpr64ForTest(0), aarch64Gpr64ForTest(2)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [
              aarch64MovzForTest({ instructionId: 0, value: 1n }),
              aarch64CallForTest({ instructionId: 1, callee: "helper" }),
              aarch64MovzForTest({ instructionId: 2, value: 2n }),
            ],
          }),
        ],
      }),
      callBoundaries: [
        {
          instructionId: 1,
          clobberedPhysicalRegisters: ["x0"],
        },
      ],
    });

    expect(result.byVreg(0)?.cutPoints).toEqual([]);
    expect(result.byVreg(0)?.clobberedPhysicalRegisters).toEqual([]);
    expect(result.byVreg(2)?.cutPoints).toEqual([]);
    expect(result.byVreg(2)?.clobberedPhysicalRegisters).toEqual([]);
  });

  test("omits call-clobber metadata for call arguments consumed by the call", () => {
    const type = aarch64IntMachineType(64);
    const result = buildAArch64LiveIntervals({
      func: aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(1),
        symbol: aarch64SymbolId("call.argument"),
        virtualRegisters: [aarch64Gpr64ForTest(0)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [
              aarch64MovzForTest({ instructionId: 0, value: 1n }),
              aarch64MachineInstruction({
                instructionId: aarch64MachineInstructionId(1),
                opcode: aarch64OpcodeFormId("bl"),
                operands: [
                  symbolOperand(aarch64SymbolId("helper")),
                  implicitDefResource({ kind: "NZCV" }),
                  implicitDefResource({ kind: "FPCR" }),
                  implicitDefResource({ kind: "FPSR" }),
                  implicitDefResource({ kind: "vectorState" }),
                  useVreg(aarch64Gpr64ForTest(0), type),
                ],
                flags: { mayTrap: false },
                origin: syntheticAArch64Origin("fixture.call.argument"),
              }),
            ],
          }),
        ],
      }),
      callBoundaries: [
        {
          instructionId: 1,
          clobberedPhysicalRegisters: ["x0"],
        },
      ],
    });

    expect(result.byVreg(0)?.cutPoints).toEqual([1]);
    expect(result.byVreg(0)?.clobberedPhysicalRegisters).toEqual([]);
  });

  test("real target alias sets expand vector call clobbers to scalar views", () => {
    const registerModel = createAArch64Rpi5PhysicalRegisterModel();
    const graph = buildAArch64InterferenceGraph({
      intervals: [
        {
          liveRangeKey: "live-range:vreg:1",
          vreg: 1,
          registerClass: "fpScalar",
          segments: [{ startOrder: 0, endOrder: 4, reason: "live" }],
          cutPoints: [2],
          noSpill: false,
          clobberedPhysicalRegisters: ["v0"],
        },
      ],
      aliases: registerModel.aliasSets.flatMap((aliasSet) =>
        aliasSet.aliases.flatMap((left, leftIndex) =>
          aliasSet.aliases.slice(leftIndex + 1).map((right) => ({ left, right })),
        ),
      ),
    });

    expect(graph.physicalInterferencesFor(1)).toContain("d0");
  });
});
