import { aarch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import { aarch64MachineTypeStableKey } from "../machine-ir/machine-types";
import {
  updateAArch64MachinePlanningState,
  type AArch64MachinePlanningState,
} from "./machine-planning-state";

export interface AArch64LiteralPoolEntryInput {
  readonly bytes: readonly number[];
  readonly typeKey: string;
  readonly relocationKey: string;
  readonly poolScope: string;
  readonly sectionKey: string;
  readonly reachabilityGroup: string;
}

export interface AArch64LiteralPoolEntry extends AArch64LiteralPoolEntryInput {
  readonly stableKey: string;
}

export function planAArch64LiteralPool(input: {
  readonly literals: readonly AArch64LiteralPoolEntryInput[];
}) {
  const byStableKey = new Map<string, AArch64LiteralPoolEntry>();
  for (const literal of input.literals) {
    const entry = literalPoolEntry(literal);
    byStableKey.set(entry.stableKey, entry);
  }
  return Object.freeze({
    entries: Object.freeze(
      [...byStableKey.values()].sort((left, right) =>
        left.stableKey.localeCompare(right.stableKey),
      ),
    ),
  });
}

export function planAArch64LiteralPoolsForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
}): AArch64MachinePlanningState {
  const literals = input.state.machineFunction.blocks.flatMap((block) =>
    block.instructions.flatMap((instruction) =>
      literalsForInstruction({
        instruction,
        functionId: Number(input.state.machineFunction.functionId),
        blockId: Number(block.blockId),
      }),
    ),
  );
  const planned = planAArch64LiteralPool({ literals });
  const literalPoolPlan = planned.entries.map((entry) => entry.stableKey);
  if (sameStrings(literalPoolPlan, input.state.machineFunction.literalPoolPlan)) {
    return Object.freeze({
      ...input.state,
      explanations: Object.freeze([
        ...input.state.explanations,
        { key: "literal-pool-planning", detail: "checked-literal-pool-identity" },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "literal-pool-planning",
    graphUpdate: { kind: "recompute" },
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      literalPoolPlan,
      schedulePlan: [...input.state.machineFunction.schedulePlan, "literal-pool:deduped"],
    }),
    explanation: {
      key: "literal-pool-planning",
      detail: `literal-pool-entries:${literalPoolPlan.length}`,
    },
  });
}

function literalPoolEntry(input: AArch64LiteralPoolEntryInput): AArch64LiteralPoolEntry {
  const bytes = Object.freeze(input.bytes.map(byte));
  return Object.freeze({
    ...input,
    bytes,
    stableKey: [
      `bytes:${bytes.map((value) => value.toString(16).padStart(2, "0")).join("")}`,
      `type:${input.typeKey}`,
      `reloc:${input.relocationKey}`,
      `scope:${input.poolScope}`,
      `section:${input.sectionKey}`,
      `reach:${input.reachabilityGroup}`,
    ].join("|"),
  });
}

function literalsForInstruction(input: {
  readonly instruction: AArch64MachineInstruction;
  readonly functionId: number;
  readonly blockId: number;
}): readonly AArch64LiteralPoolEntryInput[] {
  return input.instruction.operands.flatMap((operand) => {
    if (operand.operand.kind !== "immediate") return [];
    const typeKey = aarch64MachineTypeStableKey(operand.type);
    return [
      {
        bytes: littleEndianBytes(operand.operand.value, literalWidthBytes(operand.type)),
        typeKey,
        relocationKey: "none",
        poolScope: `function:${input.functionId}`,
        sectionKey: "rodata",
        reachabilityGroup: `block:${input.blockId}`,
      },
    ];
  });
}

function literalWidthBytes(type: AArch64MachineInstruction["operands"][number]["type"]): number {
  if (type.kind === "integer") return Math.max(1, Math.ceil(type.width / 8));
  if (type.kind === "pointer") return 8;
  if (type.kind === "float") return Math.ceil(type.width / 8);
  if (type.kind === "vector") return 16;
  return 1;
}

function littleEndianBytes(value: bigint, widthBytes: number): readonly number[] {
  const normalized = BigInt.asUintN(widthBytes * 8, value);
  return Object.freeze(
    Array.from({ length: widthBytes }, (_unused, index) =>
      Number((normalized >> BigInt(index * 8)) & 0xffn),
    ),
  );
}

function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`literal byte must be in 0..255, got ${value}.`);
  }
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
