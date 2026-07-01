import { aarch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import {
  aarch64RematerializationRecord,
  type AArch64RematerializationRecord,
  type AArch64RematerializationProducerKind,
} from "../machine-ir/rematerialization";
import {
  updateAArch64MachinePlanningState,
  type AArch64MachinePlanningState,
} from "./machine-planning-state";

const REMATERIALIZABLE_OPCODES = new Set(["movz", "movn", "adrp"]);

export function markAArch64Rematerializable(
  input: Parameters<typeof aarch64RematerializationRecord>[0],
) {
  return aarch64RematerializationRecord(input);
}

export function markAArch64RematerializationForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
  readonly pressureThreshold?: number;
}): AArch64MachinePlanningState {
  const pressureThreshold = input.pressureThreshold ?? 6;
  const records = input.state.machineFunction.blocks.flatMap((block) =>
    block.instructions.flatMap((instruction) =>
      rematerializationRecordForInstruction({
        instruction,
        state: input.state,
        pressureThreshold,
      }),
    ),
  );
  if (sameRematerializationPlan(records, input.state.machineFunction.rematerializationPlan)) {
    return Object.freeze({
      ...input.state,
      explanations: Object.freeze([
        ...input.state.explanations,
        { key: "rematerialization-marking", detail: "checked-rematerializable-producers" },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "rematerialization-marking",
    graphUpdate: { kind: "recompute" },
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      rematerializationPlan: records,
      schedulePlan: [
        ...input.state.machineFunction.schedulePlan,
        `rematerialization:records:${records.length}`,
      ],
    }),
    explanation: {
      key: "rematerialization-marking",
      detail: `rematerializable-producers:${records.length}`,
    },
  });
}

function rematerializationRecordForInstruction(input: {
  readonly instruction: AArch64MachineInstruction;
  readonly state: AArch64MachinePlanningState;
  readonly pressureThreshold: number;
}): readonly AArch64RematerializationRecord[] {
  const opcode = String(input.instruction.opcode);
  if (!REMATERIALIZABLE_OPCODES.has(opcode)) return [];
  if (
    input.instruction.flags.mayTrap ||
    input.instruction.flags.mayLoad === true ||
    input.instruction.flags.mayStore === true ||
    input.instruction.flags.isTerminator === true ||
    input.instruction.schedule.motion.kind !== "insideEffectIsland" ||
    input.instruction.schedule.pressure.gpr > input.pressureThreshold ||
    input.instruction.schedule.pressure.vector > input.pressureThreshold ||
    hasSensitiveSecurity(input.instruction) ||
    input.instruction.operands.some((operand) => operand.role === "implicitDef")
  ) {
    return [];
  }
  return [
    aarch64RematerializationRecord({
      producer: input.instruction.instructionId,
      kind: rematerializationKind(opcode),
      cost: opcode === "add-pageoff" ? 2 : 1,
      requiredFacts: requiredFactKeysForInstruction(input),
      requiredSymbols: symbolOperands(input.instruction),
      relocationReferences: relocationReferencesForInstruction(input.instruction),
      implicitResources: input.instruction.operands.flatMap((operand) =>
        operand.operand.kind === "resource" ? [operand.operand.resource] : [],
      ),
    }),
  ];
}

function rematerializationKind(opcode: string): AArch64RematerializationProducerKind {
  if (opcode === "adrp") return "symbolPageBase";
  return "constant";
}

function requiredFactKeysForInstruction(input: {
  readonly instruction: AArch64MachineInstruction;
  readonly state: AArch64MachinePlanningState;
}): readonly string[] {
  const instructionId = Number(input.instruction.instructionId);
  return Object.freeze(
    input.state.preservedFacts.records
      .filter((record) => {
        if (record.subject.kind === "machineInstruction") {
          return record.subject.instructionId === instructionId;
        }
        if (record.subject.kind === "machineEdge") {
          return (
            record.subject.edgeKey.includes(`${instructionId}->`) ||
            record.subject.edgeKey.includes(`->${instructionId}:`)
          );
        }
        return false;
      })
      .map((record) => record.stableKey),
  );
}

function symbolOperands(instruction: AArch64MachineInstruction): readonly string[] {
  return Object.freeze(
    instruction.operands.flatMap((operand) =>
      operand.operand.kind === "symbol" ? [String(operand.operand.symbol)] : [],
    ),
  );
}

function relocationReferencesForInstruction(
  instruction: AArch64MachineInstruction,
): readonly string[] {
  const symbols = symbolOperands(instruction);
  const opcode = String(instruction.opcode);
  if (opcode === "adrp") return Object.freeze(symbols.map((symbol) => `PAGE:${symbol}`));
  if (opcode === "add-pageoff") {
    return Object.freeze(symbols.map((symbol) => `PAGEOFF12:${symbol}`));
  }
  return Object.freeze([]);
}

function hasSensitiveSecurity(instruction: AArch64MachineInstruction): boolean {
  const security = instruction.security;
  return (
    security !== undefined &&
    (security.spillPolicy !== "ordinary" ||
      security.zeroization?.required === true ||
      security.labels.some(
        (label) =>
          label.kind === "secret" ||
          label.kind === "keyLifetime" ||
          label.kind === "noSpill" ||
          label.kind === "wipeOnSpill" ||
          label.kind === "zeroization",
      ))
  );
}

function sameRematerializationPlan(
  left: readonly AArch64RematerializationRecord[],
  right: readonly AArch64RematerializationRecord[],
): boolean {
  return (
    left.length === right.length &&
    left.every((record, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        record.producer === other.producer &&
        record.kind === other.kind &&
        record.cost === other.cost &&
        sameStrings(record.requiredFacts, other.requiredFacts) &&
        sameStrings(record.requiredSymbols, other.requiredSymbols) &&
        sameStrings(record.relocationReferences, other.relocationReferences)
      );
    })
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
