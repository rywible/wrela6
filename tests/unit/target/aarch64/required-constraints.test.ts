import { describe, expect, test } from "bun:test";
import { optIrFactId } from "../../../../src/opt-ir/ids";
import {
  aarch64MachineFactId,
  aarch64MachineInstructionId,
  aarch64SymbolId,
  aarch64VirtualRegisterId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../../../../src/target/aarch64/machine-ir/opcode-catalog";
import {
  aarch64InstructionOperand,
  defVreg,
  immediateOperand,
  implicitDefResource,
  symbolOperand,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { syntheticAArch64Origin } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";
import {
  buildAArch64MachineDependencyGraph,
  requiredConstraintsForAArch64Function,
} from "../../../../src/target/aarch64/plan/machine-dependency-graph";
import {
  dependencyEdgeKey,
  verifyRequiredEdgesComplete,
  type AArch64DependencyEdge,
} from "../../../../src/target/aarch64/plan/required-constraints";
import {
  aarch64Gpr64ForTest,
  aarch64MachineFunctionForTest,
  aarch64MovzForTest,
} from "../../../support/target/aarch64/machine-ir/builders";

describe("AArch64 required constraints", () => {
  test("preserved machine-edge facts become provider-named required edges", () => {
    const machineFunction = aarch64MachineFunctionForTest({
      instructions: [
        aarch64MovzForTest({ instructionId: 1, value: 1n }),
        aarch64MovzForTest({ instructionId: 2, value: 2n }),
      ],
    });
    const factEdge: AArch64DependencyEdge = {
      fromInstruction: 1,
      toInstruction: 2,
      kind: "security",
      resource: "constant-time",
      requiredBy: ["security-motion"],
    };
    const preservedFacts = aarch64PreservedFactSet({
      records: [
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(1),
          subject: { kind: "machineEdge", edgeKey: dependencyEdgeKey(factEdge) },
          lineage: { optIrFactIds: [optIrFactId(1)] },
        }),
      ],
    });

    const required = requiredConstraintsForAArch64Function(machineFunction, { preservedFacts });
    const requiredFactEdge = required.edges.find(
      (edge) => edge.fromInstruction === 1 && edge.toInstruction === 2 && edge.kind === "security",
    );

    expect(requiredFactEdge?.requiredBy).toEqual([
      "preserved-facts",
      "subject:1->2:security:constant-time:security-motion",
      "security-motion",
    ]);
    if (requiredFactEdge === undefined) throw new Error("expected preserved fact edge");
    expect(
      buildAArch64MachineDependencyGraph({
        machineFunction,
        requiredConstraints: required,
      }).edges,
    ).toContainEqual(requiredFactEdge);

    const completeness = verifyRequiredEdgesComplete({
      graphEdges: [],
      requiredEdges: required.edges,
    });
    expect(completeness.kind).toBe("error");
    if (completeness.kind !== "error") throw new Error("expected missing edge diagnostic");
    expect(completeness.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "required-edge-missing:preserved-facts+subject:1->2:security:constant-time:security-motion+security-motion:1:2",
    );
  });

  test("preserved machine-edge parser keeps resources that contain colons", () => {
    const machineFunction = aarch64MachineFunctionForTest({
      instructions: [
        aarch64MovzForTest({ instructionId: 1, value: 1n }),
        aarch64MovzForTest({ instructionId: 2, value: 2n }),
      ],
    });
    const factEdge: AArch64DependencyEdge = {
      fromInstruction: 1,
      toInstruction: 2,
      kind: "call",
      resource: "abi-return:x0",
      requiredBy: ["call-result"],
    };
    const preservedFacts = aarch64PreservedFactSet({
      records: [
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(2),
          subject: { kind: "machineEdge", edgeKey: dependencyEdgeKey(factEdge) },
          lineage: { optIrFactIds: [optIrFactId(2)] },
        }),
      ],
    });

    const required = requiredConstraintsForAArch64Function(machineFunction, { preservedFacts });
    const requiredFactEdge = required.edges.find(
      (edge) => edge.fromInstruction === 1 && edge.toInstruction === 2 && edge.kind === "call",
    );

    expect(requiredFactEdge).toEqual({
      fromInstruction: 1,
      toInstruction: 2,
      kind: "call",
      resource: "abi-return:x0",
      requiredBy: ["preserved-facts", "subject:1->2:call:abi-return:x0:call-result", "call-result"],
    });
  });

  test("dependency graph preserves outgoing stack argument stores before calls", () => {
    const value = aarch64Gpr64ForTest(0);
    const stackBase = aarch64Gpr64ForTest(1);
    const type = aarch64IntMachineType(64);
    const store = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(10),
      opcode: aarch64OpcodeFormId("str-unsigned-immediate"),
      operands: [
        useVreg(value, type),
        aarch64InstructionOperand({
          role: "memoryBase",
          operand: { kind: "vreg", register: stackBase },
          type,
        }),
        immediateOperand(0n, type),
      ],
      flags: { mayTrap: false, mayStore: true },
      origin: syntheticAArch64Origin("fixture.stack-arg-store"),
    });
    const call = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(11),
      opcode: aarch64OpcodeFormId("bl"),
      operands: [symbolOperand(aarch64SymbolId("callee")), ...callClobberOperandsForTest()],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("fixture.call"),
    });
    const graph = buildAArch64MachineDependencyGraph({
      machineFunction: aarch64MachineFunctionForTest({ instructions: [store, call] }),
    });

    expect(graph.edges).toContainEqual({
      fromInstruction: 10,
      toInstruction: 11,
      kind: "memory",
      resource: "effect",
      requiredBy: ["effect"],
    });
  });

  test("required constraints preserve call-result copies after direct and indirect calls", () => {
    const directCall = callForTest(20, "bl");
    const directCopy = callResultCopyForTest(21, "x0");
    const indirectTarget = aarch64Gpr64ForTest(9);
    const indirectCall = callForTest(30, "blr", indirectTarget);
    const indirectCopy = callResultCopyForTest(31, "x1");

    const directRequired = requiredConstraintsForAArch64Function(
      aarch64MachineFunctionForTest({ instructions: [directCall, directCopy] }),
    );
    const indirectRequired = requiredConstraintsForAArch64Function(
      aarch64MachineFunctionForTest({ instructions: [indirectCall, indirectCopy] }),
    );

    expect(directRequired.edges).toContainEqual({
      fromInstruction: 20,
      toInstruction: 21,
      kind: "call",
      resource: "abi-return:x0",
      requiredBy: ["call-result", "abi-return:x0"],
    });
    expect(indirectRequired.edges).toContainEqual({
      fromInstruction: 30,
      toInstruction: 31,
      kind: "call",
      resource: "abi-return:x1",
      requiredBy: ["call-result", "abi-return:x1"],
    });
    expect(
      buildAArch64MachineDependencyGraph({
        machineFunction: aarch64MachineFunctionForTest({ instructions: [directCall, directCopy] }),
        requiredConstraints: directRequired,
      }).edges,
    ).toContainEqual({
      fromInstruction: 20,
      toInstruction: 21,
      kind: "call",
      resource: "abi-return:x0",
      requiredBy: ["call-result", "abi-return:x0"],
    });
  });

  test("required constraints do not treat ordinary synthetic register uses as call results", () => {
    const type = aarch64IntMachineType(64);
    const ordinarySynthetic = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(80),
      registerClass: "gpr64",
      type,
      origin: { kind: "synthetic", stableKey: "fixture.synthetic.temp" },
    });
    const output = aarch64Gpr64ForTest(81);
    const copy = aarch64MachineInstruction({
      instructionId: aarch64MachineInstructionId(41),
      opcode: aarch64OpcodeFormId("add-immediate"),
      operands: [
        defVreg(output, type),
        useVreg(ordinarySynthetic, type),
        immediateOperand(0n, type),
      ],
      flags: { mayTrap: false },
      origin: syntheticAArch64Origin("fixture.synthetic-copy"),
    });
    const required = requiredConstraintsForAArch64Function(
      aarch64MachineFunctionForTest({ instructions: [callForTest(40, "bl"), copy] }),
    );

    expect(
      required.edges.some(
        (edge) =>
          edge.fromInstruction === 40 &&
          edge.toInstruction === 41 &&
          edge.kind === "call" &&
          edge.requiredBy.includes("call-result"),
      ),
    ).toBe(false);
  });
});

function callForTest(instructionId: number, opcode: "bl" | "blr", target = aarch64Gpr64ForTest(8)) {
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId(opcode),
    operands:
      opcode === "bl"
        ? [symbolOperand(aarch64SymbolId("callee")), ...callClobberOperandsForTest()]
        : [useVreg(target, target.type), ...callClobberOperandsForTest()],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.${opcode}.${instructionId}`),
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

function callResultCopyForTest(instructionId: number, abiReturnRegisterName: "x0" | "x1") {
  const type = aarch64IntMachineType(64);
  const abiReturn = aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(60 + instructionId),
    registerClass: "gpr64",
    type,
    origin: {
      kind: "synthetic",
      stableKey: `opt-ir:${instructionId}:abi-return:${abiReturnRegisterName}:0`,
    },
  });
  const output = aarch64Gpr64ForTest(70 + instructionId);
  return aarch64MachineInstruction({
    instructionId: aarch64MachineInstructionId(instructionId),
    opcode: aarch64OpcodeFormId("add-immediate"),
    operands: [defVreg(output, type), useVreg(abiReturn, type), immediateOperand(0n, type)],
    flags: { mayTrap: false },
    origin: syntheticAArch64Origin(`fixture.call-result.${instructionId}`),
  });
}
