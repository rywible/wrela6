import { aarch64MachineBlock } from "../machine-ir/machine-block";
import { aarch64MachineFunction } from "../machine-ir/machine-function";
import {
  aarch64MachineInstruction,
  type AArch64MachineInstruction,
} from "../machine-ir/machine-instruction";
import { aarch64OpcodeFormId } from "../machine-ir/opcode-catalog";
import { aarch64InstructionOperand, type AArch64InstructionOperand } from "../machine-ir/operands";
import { syntheticAArch64Origin } from "../machine-ir/provenance";
import { defaultAArch64ScheduleMetadata } from "../machine-ir/schedule";
import type { AArch64MachinePlanningState } from "./machine-planning-state";
import { updateAArch64MachinePlanningState } from "./machine-planning-state";

export function planAArch64LoadStorePairs(input: {
  readonly accesses: readonly {
    readonly offset: bigint;
    readonly volatile?: boolean;
    readonly memoryType: string;
  }[];
  readonly completeFootprint: boolean;
}) {
  if (!input.completeFootprint)
    return Object.freeze({
      pairs: Object.freeze([]),
      rejections: Object.freeze(["missingCompleteFootprint"]),
    });
  const normalAccesses = input.accesses.filter(
    (access) => !access.volatile && access.memoryType === "normalCacheable",
  );
  const pairs: readonly [bigint, bigint][] =
    normalAccesses.length >= 2
      ? [[normalAccesses[0]?.offset ?? 0n, normalAccesses[1]?.offset ?? 0n]]
      : [];
  return Object.freeze({ pairs: Object.freeze(pairs), rejections: Object.freeze([]) });
}

export function planAArch64LoadStorePairsForPlanningState(input: {
  readonly state: AArch64MachinePlanningState;
}): AArch64MachinePlanningState {
  const rewrittenBlocks = input.state.machineFunction.blocks.map((block) =>
    aarch64MachineBlock({
      ...block,
      instructions: pairInstructions(block.instructions),
    }),
  );
  const changed = rewrittenBlocks.some(
    (block, index) =>
      block.instructions.length !== input.state.machineFunction.blocks[index]?.instructions.length,
  );
  if (!changed) {
    return Object.freeze({
      ...input.state,
      explanations: Object.freeze([
        ...input.state.explanations,
        { key: "pair-load-store-planning", detail: "checked-effect-island-pair-eligibility" },
      ]),
    });
  }
  return updateAArch64MachinePlanningState({
    state: input.state,
    reason: "pair-load-store-planning",
    machineFunction: aarch64MachineFunction({
      ...input.state.machineFunction,
      blocks: rewrittenBlocks,
      schedulePlan: [
        ...input.state.machineFunction.schedulePlan,
        "pair-load-store:adjacent-normal-cacheable",
      ],
    }),
    explanation: {
      key: "pair-load-store-planning",
      detail: "formed-adjacent-normal-cacheable-pairs",
    },
  });
}

function pairInstructions(
  instructions: readonly AArch64MachineInstruction[],
): readonly AArch64MachineInstruction[] {
  const rewritten: AArch64MachineInstruction[] = [];
  for (let index = 0; index < instructions.length; index += 1) {
    const addressed = addressedPairInstruction(instructions, index);
    if (addressed !== undefined) {
      rewritten.push(addressed.address, addressed.paired);
      index += 3;
      continue;
    }
    const current = instructions[index];
    const next = instructions[index + 1];
    const paired =
      current === undefined || next === undefined ? undefined : pairedInstruction(current, next);
    if (paired !== undefined) {
      rewritten.push(paired);
      index += 1;
      continue;
    }
    if (current !== undefined) {
      rewritten.push(current);
    }
  }
  return Object.freeze(rewritten);
}

function addressedPairInstruction(
  instructions: readonly AArch64MachineInstruction[],
  index: number,
):
  | { readonly address: AArch64MachineInstruction; readonly paired: AArch64MachineInstruction }
  | undefined {
  const firstAddress = instructions[index];
  const firstAccess = instructions[index + 1];
  const secondAddress = instructions[index + 2];
  const secondAccess = instructions[index + 3];
  if (
    firstAddress === undefined ||
    firstAccess === undefined ||
    secondAddress === undefined ||
    secondAccess === undefined ||
    !isPureAddressProducer(firstAddress) ||
    !isPureAddressProducer(secondAddress)
  ) {
    return undefined;
  }
  const firstAddressDef = defOperand(firstAddress, 0);
  const secondAddressDef = defOperand(secondAddress, 0);
  if (
    firstAddressDef?.operand.kind !== "vreg" ||
    secondAddressDef?.operand.kind !== "vreg" ||
    !sameVregOperand(memoryBaseOperand(firstAccess), firstAddressDef) ||
    !sameVregOperand(memoryBaseOperand(secondAccess), secondAddressDef) ||
    isVregUsedAfter(instructions, index + 4, Number(secondAddressDef.operand.register.vreg))
  ) {
    return undefined;
  }
  const paired = pairedInstruction(
    firstAccess,
    secondAccess,
    aarch64InstructionOperand({
      role: "memoryBase",
      operand: firstAddressDef.operand,
      type: firstAddressDef.type,
    }),
  );
  return paired === undefined ? undefined : { address: firstAddress, paired };
}

function pairedInstruction(
  first: AArch64MachineInstruction,
  second: AArch64MachineInstruction,
  memoryBaseOverride?: AArch64InstructionOperand,
): AArch64MachineInstruction | undefined {
  const firstOpcode = String(first.opcode);
  const secondOpcode = String(second.opcode);
  if (firstOpcode !== secondOpcode) return undefined;
  if (firstOpcode !== "ldr-unsigned-immediate" && firstOpcode !== "str-unsigned-immediate") {
    return undefined;
  }
  if (!isPairableMemory(first) || !isPairableMemory(second)) return undefined;
  if (first.memoryOrdering?.order !== second.memoryOrdering?.order) return undefined;
  const firstMemoryBase = memoryBaseOverride ?? memoryBaseOperand(first);
  const secondMemoryBase = memoryBaseOperand(second);
  if (firstMemoryBase === undefined || secondMemoryBase === undefined) {
    return undefined;
  }
  if (!sameAddressOperand(firstMemoryBase, secondMemoryBase)) {
    return undefined;
  }
  const pairOffset = pairSignedOffsetOperand(first);
  if (pairOffset.kind === "unencodable") {
    return undefined;
  }
  const secondPairOffset = pairSignedOffsetOperand(second);
  if (secondPairOffset.kind === "unencodable") {
    return undefined;
  }
  const firstOffset = memoryImmediateOffsetValue(first) ?? 0n;
  const secondOffset = memoryImmediateOffsetValue(second) ?? 0n;
  if (secondOffset !== firstOffset + 8n && (firstOffset !== 0n || secondOffset !== 0n)) {
    return undefined;
  }
  const firstData =
    firstOpcode === "ldr-unsigned-immediate" ? defOperand(first, 0) : useOperand(first, 0);
  const secondData =
    firstOpcode === "ldr-unsigned-immediate" ? defOperand(second, 0) : useOperand(second, 0);
  if (firstData === undefined || secondData === undefined) return undefined;
  if (!isPairableDataOperand(firstData) || !isPairableDataOperand(secondData)) return undefined;
  if (!hasAdjacentFootprints(first, second)) return undefined;
  return aarch64MachineInstruction({
    instructionId: first.instructionId,
    opcode: aarch64OpcodeFormId(
      firstOpcode === "ldr-unsigned-immediate" ? "ldp-signed-offset" : "stp-signed-offset",
    ),
    operands:
      pairOffset.operand === undefined
        ? [firstData, secondData, firstMemoryBase]
        : [firstData, secondData, firstMemoryBase, pairOffset.operand],
    flags:
      firstOpcode === "ldr-unsigned-immediate"
        ? { mayTrap: false, mayLoad: true }
        : { mayTrap: false, mayStore: true },
    origin: syntheticAArch64Origin(
      `pair-load-store:${String(first.instructionId)}:${String(second.instructionId)}`,
    ),
    schedule: defaultAArch64ScheduleMetadata(
      firstOpcode === "ldr-unsigned-immediate" ? "load" : "store",
    ),
    ...(first.memoryOrdering === undefined ? {} : { memoryOrdering: first.memoryOrdering }),
    ...(first.security === undefined ? {} : { security: first.security }),
  });
}

function isPairableMemory(instruction: AArch64MachineInstruction): boolean {
  return (
    instruction.flags.mayTrap === false &&
    (instruction.memoryOrdering?.regionMemoryType === "normalCacheable" ||
      instruction.memoryOrdering?.regionMemoryType === "validatedPayload") &&
    instruction.memoryOrdering.atomicity === "nonAtomic" &&
    instruction.operands.filter((operand) => operand.operand.kind === "immediate").length <= 1
  );
}

function pairSignedOffsetOperand(
  instruction: AArch64MachineInstruction,
):
  | { readonly kind: "ok"; readonly operand?: AArch64InstructionOperand }
  | { readonly kind: "unencodable" } {
  const offsetOperand = memoryOffsetOperand(instruction);
  if (offsetOperand === undefined) {
    return { kind: "ok" };
  }
  if (offsetOperand.operand.kind !== "immediate") {
    return { kind: "unencodable" };
  }
  const offset = offsetOperand.operand.value;
  if (offset % 8n !== 0n || offset < -512n || offset > 504n) {
    return { kind: "unencodable" };
  }
  return { kind: "ok", operand: offset === 0n ? undefined : offsetOperand };
}

function sameVregOperand(
  left: AArch64InstructionOperand | undefined,
  right: AArch64InstructionOperand | undefined,
): boolean {
  return (
    left?.operand.kind === "vreg" &&
    right?.operand.kind === "vreg" &&
    left.operand.register.vreg === right.operand.register.vreg
  );
}

function sameAddressOperand(
  left: AArch64InstructionOperand,
  right: AArch64InstructionOperand,
): boolean {
  if (left.operand.kind === "vreg" && right.operand.kind === "vreg") {
    return left.operand.register.vreg === right.operand.register.vreg;
  }
  if (left.operand.kind === "frameObject" && right.operand.kind === "frameObject") {
    return left.operand.frameObject === right.operand.frameObject;
  }
  return false;
}

function isPureAddressProducer(instruction: AArch64MachineInstruction): boolean {
  return (
    (String(instruction.opcode) === "movz" || String(instruction.opcode) === "add-immediate") &&
    instruction.flags.mayTrap === false &&
    instruction.flags.mayLoad !== true &&
    instruction.flags.mayStore !== true &&
    instruction.security === undefined
  );
}

function isVregUsedAfter(
  instructions: readonly AArch64MachineInstruction[],
  startIndex: number,
  registerId: number,
): boolean {
  return instructions
    .slice(startIndex)
    .some((instruction) =>
      instruction.operands.some(
        (operand) =>
          operand.operand.kind === "vreg" &&
          Number(operand.operand.register.vreg) === registerId &&
          operand.role !== "def",
      ),
    );
}

interface PairableFootprint {
  readonly regionKey: string;
  readonly start: bigint;
  readonly widthBytes: number;
}

function hasAdjacentFootprints(
  first: AArch64MachineInstruction,
  second: AArch64MachineInstruction,
): boolean {
  const firstFootprint = pairableFootprint(first);
  const secondFootprint = pairableFootprint(second);
  return (
    firstFootprint !== undefined &&
    secondFootprint !== undefined &&
    firstFootprint.widthBytes === 8 &&
    secondFootprint.widthBytes === 8 &&
    firstFootprint.regionKey === secondFootprint.regionKey &&
    secondFootprint.start === firstFootprint.start + BigInt(firstFootprint.widthBytes)
  );
}

function pairableFootprint(instruction: AArch64MachineInstruction): PairableFootprint | undefined {
  return instruction.schedule.pairability
    .map(parsePairabilityFootprint)
    .find((footprint) => footprint !== undefined);
}

function parsePairabilityFootprint(tag: string): PairableFootprint | undefined {
  const match = /^memory-footprint:([^:]+):(-?\d+):(\d+)$/.exec(tag);
  if (match === null) return undefined;
  const widthBytes = Number(match[3]);
  if (!Number.isInteger(widthBytes) || widthBytes <= 0) return undefined;
  return {
    regionKey: match[1] ?? "",
    start: BigInt(match[2] ?? "0"),
    widthBytes,
  };
}

function isPairableDataOperand(operand: AArch64InstructionOperand): boolean {
  return (
    operand.operand.kind === "vreg" &&
    (operand.type.kind === "pointer" ||
      (operand.type.kind === "integer" && operand.type.width === 64))
  );
}

function memoryBaseOperand(
  instruction: AArch64MachineInstruction,
): AArch64InstructionOperand | undefined {
  return instruction.operands.find((operand) => operand.role === "memoryBase");
}

function memoryOffsetOperand(
  instruction: AArch64MachineInstruction,
): AArch64InstructionOperand | undefined {
  return instruction.operands.find(
    (operand) => operand.role === "use" && operand.operand.kind === "immediate",
  );
}

function memoryImmediateOffsetValue(instruction: AArch64MachineInstruction): bigint | undefined {
  const offset = memoryOffsetOperand(instruction);
  return offset?.operand.kind === "immediate" ? offset.operand.value : undefined;
}

function defOperand(
  instruction: AArch64MachineInstruction,
  index: number,
): AArch64InstructionOperand | undefined {
  return instruction.operands.filter((operand) => operand.role === "def")[index];
}

function useOperand(
  instruction: AArch64MachineInstruction,
  index: number,
): AArch64InstructionOperand | undefined {
  return instruction.operands.filter((operand) => operand.role === "use")[index];
}
