import { aarch64MachineInstructionId } from "../machine-ir/ids";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64IntMachineType } from "../machine-ir/machine-types";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import { defVreg, immediateOperand, implicitDefResource, useVreg } from "../machine-ir/operands";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import { opcodeForAArch64IntegerBinary } from "./scalar-opcode-policy";
import { scratchGpr64ForAArch64Selection } from "./selection-context";

export type AArch64ScalarOperationShape =
  | { readonly kind: "constant"; readonly value: bigint }
  | {
      readonly kind: "integerBinary";
      readonly operator:
        | "add"
        | "subtract"
        | "and"
        | "or"
        | "xor"
        | "multiply"
        | "unsignedDivide"
        | "signedDivide";
    }
  | { readonly kind: "integerCompare"; readonly operator: string }
  | { readonly kind: "booleanBinary"; readonly operator: string }
  | { readonly kind: "select" };

export type AArch64ScalarSelectionResult =
  | {
      readonly kind: "ok";
      readonly instructions: readonly AArch64MachineInstruction[];
      readonly patternId: string;
      readonly rejectedAlternatives: readonly {
        readonly patternId: string;
        readonly reason: string;
      }[];
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectAArch64ScalarOperation(
  operation: AArch64ScalarOperationShape,
): AArch64ScalarSelectionResult {
  const type = aarch64IntMachineType(64);
  const output = scratchGpr64ForAArch64Selection(10);
  const left = scratchGpr64ForAArch64Selection(11);
  const right = scratchGpr64ForAArch64Selection(12);
  switch (operation.kind) {
    case "constant":
      return {
        kind: "ok",
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(0),
            opcode: aarch64OpcodeFormId("movz"),
            operands: [defVreg(output, type), immediateOperand(operation.value & 0xffffn, type)],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("scalar.constant"),
          }),
        ],
        patternId: "scalar.constant.mov",
        rejectedAlternatives: [],
      };
    case "integerCompare":
      return {
        kind: "ok",
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(0),
            opcode: aarch64OpcodeFormId("cmp-shifted-register"),
            operands: [
              useVreg(left, type),
              useVreg(right, type),
              implicitDefResource({ kind: "NZCV" }),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin(`scalar.compare.${operation.operator}`),
          }),
        ],
        patternId: "scalar.compare.nzcv",
        rejectedAlternatives: [],
      };
    case "integerBinary": {
      const opcode = opcodeForAArch64IntegerBinary(operation.operator);
      return {
        kind: "ok",
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(0),
            opcode: aarch64OpcodeFormId(opcode),
            operands: [defVreg(output, type), useVreg(left, type), useVreg(right, type)],
            flags: { mayTrap: operation.operator.includes("Divide") },
            origin: syntheticAArch64Origin(`scalar.binary.${operation.operator}`),
          }),
        ],
        patternId: "scalar.local",
        rejectedAlternatives: operation.operator.includes("Divide")
          ? [{ patternId: "scalar.magic-divide", reason: "missing-numeric-range-authority" }]
          : [],
      };
    }
    case "booleanBinary":
      return selectAArch64ScalarOperation({ kind: "integerBinary", operator: "and" });
    case "select":
      return {
        kind: "ok",
        instructions: [
          aarch64MachineInstruction({
            instructionId: aarch64MachineInstructionId(0),
            opcode: aarch64OpcodeFormId("csel"),
            operands: [
              defVreg(output, type),
              useVreg(left, type),
              useVreg(right, type),
              { ...implicitDefResource({ kind: "NZCV" }), role: "implicitUse" as const },
              immediateOperand(0n, type),
            ],
            flags: { mayTrap: false },
            origin: syntheticAArch64Origin("scalar.select"),
          }),
        ],
        patternId: "scalar.select.csel",
        rejectedAlternatives: [],
      };
  }
}
