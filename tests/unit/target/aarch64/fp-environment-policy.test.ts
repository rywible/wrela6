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
import {
  aarch64FloatMachineType,
  aarch64IntMachineType,
  aarch64VectorMachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  defVreg,
  implicitDefResource,
  implicitUseResource,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import {
  emptyAArch64ProvenanceMap,
  syntheticAArch64Origin,
} from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64ScheduleMetadata } from "../../../../src/target/aarch64/machine-ir/schedule";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import { verifyAArch64MachineProgram } from "../../../../src/target/aarch64/verify/machine-ir-verifier";

describe("AArch64 FP environment verifier policy", () => {
  test("rejects forged FP/vector numeric opcodes without authorization metadata", () => {
    const vectorOutput = vectorVreg(1);
    const vectorLeft = vectorVreg(2);
    const vectorRight = vectorVreg(3);
    const vectorAddend = vectorVreg(4);
    const fpOutput = fpVreg(5);
    const fpInput = fpVreg(6);
    const result = verifyAArch64MachineProgram({
      program: programForInstructions(
        [vectorOutput, vectorLeft, vectorRight, vectorAddend, fpOutput, fpInput],
        [
          instruction({
            id: 10,
            opcode: "fmla",
            operands: [
              defVreg(vectorOutput, vectorOutput.type),
              useVreg(vectorLeft, vectorLeft.type),
              useVreg(vectorRight, vectorRight.type),
              useVreg(vectorAddend, vectorAddend.type),
              implicitUseResource({ kind: "FPCR" }),
              implicitDefResource({ kind: "FPSR" }),
            ],
            issueClass: "vector",
          }),
          instruction({
            id: 11,
            opcode: "dotprod",
            operands: [
              defVreg(vectorOutput, vectorOutput.type),
              useVreg(vectorLeft, vectorLeft.type),
              useVreg(vectorRight, vectorRight.type),
            ],
            issueClass: "vector",
          }),
          instruction({
            id: 12,
            opcode: "sqrdmulh",
            operands: [
              defVreg(vectorOutput, vectorOutput.type),
              useVreg(vectorLeft, vectorLeft.type),
              useVreg(vectorRight, vectorRight.type),
            ],
            issueClass: "vector",
          }),
          instruction({
            id: 13,
            opcode: "fcvt-fp16",
            operands: [
              defVreg(fpOutput, fpOutput.type),
              useVreg(fpInput, fpInput.type),
              implicitUseResource({ kind: "FPCR" }),
              implicitDefResource({ kind: "FPSR" }),
            ],
            issueClass: "fp",
          }),
        ],
      ),
    });

    expect(errorDetails(result)).toEqual(
      expect.arrayContaining([
        "fp-numeric-authority-missing:fmla:fp-contraction-authorized",
        "fp-numeric-authority-missing:dotprod:dotprod-authorized",
        "fp-numeric-authority-missing:sqrdmulh:rdm-authorized",
        "fp-numeric-authority-missing:sqrdmulh:saturation-authorized",
        "fp-numeric-authority-missing:sqrdmulh:numeric-error-bound-authorized",
        "fp-numeric-authority-missing:fcvt-fp16:fp16-narrowing-authorized",
      ]),
    );
  });
});

function instruction(input: {
  readonly id: number;
  readonly opcode: string;
  readonly operands: Parameters<typeof aarch64MachineInstruction>[0]["operands"];
  readonly issueClass: "fp" | "vector";
}) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(input.id),
    opcode: aarch64OpcodeFormId(input.opcode),
    operands: input.operands,
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`test:fp-policy:${input.id}`),
    schedule: aarch64ScheduleMetadata({
      issueClass: input.issueClass,
      latencyClass: "singleCycle",
      motion: { kind: "insideEffectIsland" },
      pairability: [],
      pressure: { gpr: 0, vector: input.issueClass === "vector" ? 1 : 0 },
      errataConstraints: [],
    }),
  });
}

function programForInstructions(
  virtualRegisters: readonly ReturnType<typeof vectorVreg | typeof fpVreg>[],
  instructions: readonly ReturnType<typeof aarch64MachineInstruction>[],
) {
  const symbol = aarch64SymbolId("test.fp.policy");
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: [
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(0),
        symbol,
        virtualRegisters,
        parameters: [],
        returns: [],
        frameObjects: [],
        schedulePlan: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions,
            terminator: aarch64MachineInstruction({
              instructionId: aarch64MachineInstructionId(99),
              opcode: aarch64OpcodeFormId("ret"),
              operands: [],
              flags: { mayTrap: false, isTerminator: true },
              origin: syntheticAArch64Origin("test:fp-policy:ret"),
            }),
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

function fpVreg(value: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(value),
    registerClass: "fpScalar",
    type: aarch64FloatMachineType(32),
  });
}

function vectorVreg(value: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(value),
    registerClass: "vector128",
    type: aarch64VectorMachineType({ laneType: aarch64IntMachineType(8), laneCount: 16 }),
  });
}

function errorDetails(result: ReturnType<typeof verifyAArch64MachineProgram>) {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected verifier diagnostics");
  return result.diagnostics.map((diagnostic) => diagnostic.stableDetail);
}
