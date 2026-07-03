import { describe, expect, test } from "bun:test";
import {
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineInstructionId,
  aarch64MachineProgramId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64MachineProgram } from "../../../../src/target/aarch64/machine-ir/machine-program";
import { aarch64IntMachineType } from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  branchTarget,
  defVreg,
  immediateOperand,
  implicitDefResource,
  implicitUseResource,
  symbolOperand,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import {
  emptyAArch64ProvenanceMap,
  syntheticAArch64Origin,
} from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import { verifyAArch64MachineProgram } from "../../../../src/target/aarch64/verify/machine-ir-verifier";

describe("AArch64 NZCV verifier", () => {
  test("rejects a conditional branch without an NZCV producer", () => {
    const result = verifyAArch64MachineProgram({
      program: programWithInstructionsForTest([
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(1),
          opcode: aarch64OpcodeFormId("b-cond"),
          operands: [
            implicitUseResource({ kind: "NZCV" }),
            branchTarget(aarch64MachineBlockId(1)),
            immediateOperand(0n, aarch64IntMachineType(64)),
          ],
          flags: { mayTrap: false, isTerminator: true },
          origin: syntheticAArch64Origin("test:b-cond"),
        }),
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "AARCH64_NZCV_USE_WITHOUT_DEF",
    ]);
  });

  test("accepts a cmp producer followed by a conditional branch consumer", () => {
    expect(
      verifyAArch64MachineProgram({
        program: programWithInstructionsForTest([
          movzForTest(10, 1),
          movzForTest(11, 2),
          cmpForTest(1),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(2),
            opcode: aarch64OpcodeFormId("b-cond"),
            operands: [
              implicitUseResource({ kind: "NZCV" }),
              branchTarget(aarch64MachineBlockId(1)),
              immediateOperand(0n, aarch64IntMachineType(64)),
            ],
            flags: { mayTrap: false, isTerminator: true },
            origin: syntheticAArch64Origin("test:b-cond"),
          }),
        ]),
      }),
    ).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("accepts a call clobber before a fresh cmp producer and consumer", () => {
    expect(
      verifyAArch64MachineProgram({
        program: programWithInstructionsForTest([
          callForTest(20),
          movzForTest(10, 1),
          movzForTest(11, 2),
          cmpForTest(1),
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(2),
            opcode: aarch64OpcodeFormId("b-cond"),
            operands: [
              implicitUseResource({ kind: "NZCV" }),
              branchTarget(aarch64MachineBlockId(1)),
              immediateOperand(0n, aarch64IntMachineType(64)),
            ],
            flags: { mayTrap: false, isTerminator: true },
            origin: syntheticAArch64Origin("test:b-cond-after-fresh-cmp"),
          }),
        ]),
      }),
    ).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("accepts an NZCV producer that dominates a successor block consumer", () => {
    const symbol = aarch64SymbolId("test.nzcv.cross.block");
    const program = aarch64MachineProgram({
      programId: aarch64MachineProgramId(1),
      functions: [
        aarch64MachineFunction({
          functionId: aarch64MachineFunctionId(1),
          symbol,
          virtualRegisters: [vregForTest(1), vregForTest(2), vregForTest(3)],
          parameters: [],
          returns: [],
          frameObjects: [],
          blocks: [
            aarch64MachineBlock({
              blockId: aarch64MachineBlockId(0),
              frequency: { kind: "entry" },
              instructions: [movzForTest(10, 1), movzForTest(11, 2), cmpForTest(1)],
              terminator: aarch64MachineInstruction({
                instructionId: aarch64MachineInstructionId(12),
                opcode: aarch64OpcodeFormId("b"),
                operands: [branchTarget(aarch64MachineBlockId(1))],
                flags: { mayTrap: false, isTerminator: true },
                origin: syntheticAArch64Origin("test:b"),
              }),
            }),
            aarch64MachineBlock({
              blockId: aarch64MachineBlockId(1),
              instructions: [
                aarch64MachineInstruction({
                  instructionId: aarch64MachineInstructionId(13),
                  opcode: aarch64OpcodeFormId("cset"),
                  operands: [
                    defVreg(vregForTest(3), aarch64IntMachineType(64)),
                    implicitUseResource({ kind: "NZCV" }),
                    immediateOperand(0n, aarch64IntMachineType(64)),
                  ],
                  flags: { mayTrap: false },
                  origin: syntheticAArch64Origin("test:cset"),
                }),
              ],
              terminator: retForTest(14),
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

    expect(verifyAArch64MachineProgram({ program })).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("rejects an NZCV clobber between producer and consumer", () => {
    const result = verifyAArch64MachineProgram({
      program: programWithInstructionsForTest([
        movzForTest(10, 1),
        movzForTest(11, 2),
        cmpForTest(1),
        cmpForTest(2),
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(3),
          opcode: aarch64OpcodeFormId("csel"),
          operands: [
            defVreg(vregForTest(3), aarch64IntMachineType(64)),
            useVreg(vregForTest(1), aarch64IntMachineType(64)),
            useVreg(vregForTest(2), aarch64IntMachineType(64)),
            implicitUseResource({ kind: "NZCV" }),
            immediateOperand(0n, aarch64IntMachineType(64)),
          ],
          flags: { mayTrap: false },
          origin: syntheticAArch64Origin("test:csel"),
        }),
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "AARCH64_NZCV_CLOBBERED_BEFORE_USE",
    ]);
  });

  test("rejects a call clobber between an NZCV producer and consumer", () => {
    const result = verifyAArch64MachineProgram({
      program: programWithInstructionsForTest([
        movzForTest(10, 1),
        movzForTest(11, 2),
        cmpForTest(1),
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(2),
          opcode: aarch64OpcodeFormId("bl"),
          operands: [
            symbolOperand(aarch64SymbolId("test.nzcv")),
            implicitDefResource({ kind: "NZCV" }),
            implicitDefResource({ kind: "FPCR" }),
            implicitDefResource({ kind: "FPSR" }),
            implicitDefResource({ kind: "vectorState" }),
          ],
          flags: { mayTrap: false },
          origin: syntheticAArch64Origin("test:call-clobber"),
        }),
        aarch64MachineInstruction({
          instructionId: aarch64MachineInstructionId(3),
          opcode: aarch64OpcodeFormId("cset"),
          operands: [
            defVreg(vregForTest(3), aarch64IntMachineType(64)),
            implicitUseResource({ kind: "NZCV" }),
            immediateOperand(0n, aarch64IntMachineType(64)),
          ],
          flags: { mayTrap: false },
          origin: syntheticAArch64Origin("test:cset"),
        }),
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "AARCH64_NZCV_CLOBBERED_BEFORE_USE",
    ]);
  });
});

function programWithInstructionsForTest(
  instructions: readonly ReturnType<typeof aarch64MachineInstruction>[],
) {
  const symbol = aarch64SymbolId("test.nzcv");
  const entryTerminator =
    instructions[instructions.length - 1]?.flags.isTerminator === true
      ? instructions[instructions.length - 1]
      : retForTest(100);
  const entryInstructions =
    instructions[instructions.length - 1]?.flags.isTerminator === true
      ? instructions.slice(0, -1)
      : instructions;
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: [
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(0),
        symbol,
        virtualRegisters: [vregForTest(1), vregForTest(2), vregForTest(3)],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: entryInstructions,
            terminator: entryTerminator,
          }),
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(1),
            instructions: [],
            terminator: retForTest(99),
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

function retForTest(instructionId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("ret"),
    operands: [],
    flags: { mayTrap: false, isTerminator: true },
    origin: syntheticAArch64Origin(`test:ret:${instructionId}`),
  });
}

function cmpForTest(value: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(value),
    opcode: aarch64OpcodeFormId("cmp-shifted-register"),
    operands: [
      useVreg(vregForTest(1), aarch64IntMachineType(64)),
      useVreg(vregForTest(2), aarch64IntMachineType(64)),
      implicitDefResource({ kind: "NZCV" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:cmp:${value}`),
  });
}

function callForTest(instructionId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("bl"),
    operands: [
      symbolOperand(aarch64SymbolId("test.nzcv")),
      implicitDefResource({ kind: "NZCV" }),
      implicitDefResource({ kind: "FPCR" }),
      implicitDefResource({ kind: "FPSR" }),
      implicitDefResource({ kind: "vectorState" }),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:call:${instructionId}`),
  });
}

function movzForTest(instructionId: number, registerId: number) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("movz"),
    operands: [
      defVreg(vregForTest(registerId), aarch64IntMachineType(64)),
      immediateOperand(BigInt(registerId), aarch64IntMachineType(64)),
    ],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:movz:${instructionId}`),
  });
}

function vregForTest(value: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(value),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
  });
}
