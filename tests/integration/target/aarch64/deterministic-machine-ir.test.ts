import { describe, expect, test } from "bun:test";
import {
  aarch64MachineBlock,
  aarch64MachineFunction,
  aarch64MachineFunctionId,
  aarch64MachineInstruction,
  aarch64MachineInstructionId,
  aarch64MachineProgram,
  aarch64MachineProgramId,
  aarch64OpcodeFormId,
  aarch64SymbolId,
  emptyAArch64ProvenanceMap,
  syntheticAArch64Origin,
} from "../../../../src/target/aarch64";
import { dumpAArch64MachineProgramDeterministically } from "../../../../src/target/aarch64/debug/deterministic-dump";
import { aarch64MachineBlockId } from "../../../../src/target/aarch64/machine-ir/ids";

describe("AArch64 deterministic machine IR dump", () => {
  test("dump output is stable for differently ordered equivalent machine IR", () => {
    const first = machineProgramWithFunctionOrder([2, 1]);
    const second = machineProgramWithFunctionOrder([1, 2]);

    expect(dumpAArch64MachineProgramDeterministically({ program: first })).toBe(
      dumpAArch64MachineProgramDeterministically({ program: second }),
    );
  });

  test("debug explanations include provenance in deterministic order", () => {
    const program = machineProgramWithFunctionOrder([1]);
    const dump = dumpAArch64MachineProgramDeterministically({
      program,
      includeDebugExplanations: true,
    });

    expect(dump).toContain('origin {"kind":"syntheticLowering","stableKey":"deterministic-test"}');
  });
});

function machineProgramWithFunctionOrder(functionNumbers: readonly number[]) {
  return aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: functionNumbers.map((functionNumber) =>
      aarch64MachineFunction({
        functionId: aarch64MachineFunctionId(functionNumber),
        symbol: aarch64SymbolId(`fn_${functionNumber}`),
        virtualRegisters: [],
        parameters: [],
        returns: [],
        frameObjects: [],
        blocks: [
          aarch64MachineBlock({
            blockId: aarch64MachineBlockId(0),
            frequency: { kind: "entry" },
            instructions: [
              aarch64MachineInstruction({
                instructionId: aarch64MachineInstructionId(0),
                opcode: aarch64OpcodeFormId("ret"),
                operands: [],
                flags: { mayTrap: false, isTerminator: true },
                origin: syntheticAArch64Origin("deterministic-test"),
              }),
            ],
          }),
        ],
      }),
    ),
    globalSymbols: [
      { symbol: aarch64SymbolId("z_symbol"), visibility: "local" },
      { symbol: aarch64SymbolId("a_symbol"), visibility: "global", section: "text" },
    ],
    entrySymbol: aarch64SymbolId("fn_1"),
    targetFingerprint: "test-target",
    consultedSubsurfaceFingerprints: ["selection", "abi"],
    provenance: emptyAArch64ProvenanceMap(),
  });
}
